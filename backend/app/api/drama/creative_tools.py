# Based on Toonflow by HBAI-Ltd, licensed under Apache-2.0 + Supplemental License.
"""制片工坊 · 创作工具：多模态实验室 + 分段视频提示词（对标乐凡 Skill 工作台）。

- POST /drama/media/analyze  上传图片/视频/音频，用视觉类文本模型分析，返回可复刻提示词
- POST /drama/prompts/split  输入一句话创意，按"单段 ≤15s"规格拆成多段视频生成提示词

复用 AgentCut 模型路由（ApiSource + call_upstream），统一鉴权/积分/计费。
"""
import asyncio
import base64
import json
import tempfile
import uuid
from pathlib import Path
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/drama", tags=["drama"])

MAX_MEDIA_BYTES = 20 * 1024 * 1024  # 单文件上限 20MB（图片/首帧分析足够）


# ---------------------------------------------------------------------------
# 多模态实验室
# ---------------------------------------------------------------------------

MEDIA_ANALYSIS_PROMPTS = {
    "image": (
        "请专业分析这张图片：主体、构图、景别、机位、光线、色彩、空间关系、可见文字、"
        "人物/场景/道具/特效资产、连续性风险，并给出可复刻的 AI 图像/视频提示词。"
    ),
    "video": (
        "请逐段分析这个视频：时间码、镜头、动作、构图、运镜、节奏、人物/场景/道具/特效资产、"
        "光线、剪辑、音画关系、连续性，并给出可复刻的视频提示词。"
    ),
    "audio": (
        "请完整拆解这段音乐/音频：BPM 与拍号估计、Intro/Verse/Chorus/Bridge/Outro 时间段、"
        "人声/歌词、主要乐器、鼓点、低频、旋律、动态、强拍、转折、高潮、情绪曲线，"
        "并给出 AI MV 资产与逐段画面规划。"
    ),
}


async def _extract_video_first_frame(data: bytes) -> str:
    """用 ffmpeg 抽视频首帧为 JPEG，返回 base64 data URL。失败时抛 HTTPException。"""
    suffix = ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_in:
        tmp_in.write(data)
        in_path = Path(tmp_in.name)
    out_path = in_path.with_suffix(".jpg")
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", str(in_path), "-frames:v", "1", "-q:v", "2", str(out_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=30)
        if out_path.exists() and out_path.stat().st_size > 0:
            return "data:image/jpeg;base64," + base64.b64encode(out_path.read_bytes()).decode()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"视频首帧抽取失败：{exc}") from exc
    finally:
        in_path.unlink(missing_ok=True)
        out_path.unlink(missing_ok=True)
    raise HTTPException(status_code=422, detail="视频首帧抽取失败：ffmpeg 未返回有效帧")


def _resolve_vision_source(db: Session, user: User):
    """解析文本源（OpenAI 兼容 + 视觉能力），作为多模态分析的默认执行模型。"""
    from app.services.agent_loop import _resolve_text_source
    source = _resolve_text_source(db, user)
    if not source:
        raise HTTPException(status_code=400, detail="未配置文本模型（TEXT_MODEL），请先在管理后台配置模型路由")
    return source


def _resolve_text_variable(db: Session, user: User):
    """解析文本模型变量名（用于计费定价规则匹配）。

    与 ``_resolve_text_source`` 同序（TEXT_MODEL 优先 → 任意 text 映射 → 首个启用源），
    额外返回 variable_name，供 compute_cost 查定价规则；无映射时返回 None（走 COST_MAP 兜底）。
    """
    from app.models.model import VariableMapping
    from app.services.model_service import resolve_source_for_variable, first_active_source_by_category

    for mapping in db.query(VariableMapping).filter(VariableMapping.modal_category == "text").all():
        if mapping.variable_name == "TEXT_MODEL":
            source = resolve_source_for_variable(db, mapping.variable_name, user)
            if source:
                return mapping.variable_name, source
    for mapping in db.query(VariableMapping).filter(VariableMapping.modal_category == "text").all():
        if mapping.variable_name == "TEXT_MODEL":
            continue
        source = resolve_source_for_variable(db, mapping.variable_name, user)
        if source:
            return mapping.variable_name, source
    source = first_active_source_by_category(db, "text", user)
    return None, source


async def _run_paid_analysis(
    db: Session,
    user: User,
    variable_name: str,
    source,
    body: dict,
    reference_id: str,
):
    """统一「计费 + 上游调用 + 结算/释放」流程（R3-2）。

    - 冻结积分 → 调上游 → 成功结算 / 失败释放（含模型未返回内容的情况）。
    - 余额不足返回 402；上游异常重新抛出（由全局异常处理器转 5xx）。
    """
    from app.services.gateway_service import call_upstream, compute_cost
    from app.services.credit_service import freeze_credits, settle_frozen_credits, release_frozen_credits

    cost = compute_cost(db, variable_name, body, "text")
    billed = cost > 0  # 免费档（cost=0）跳过冻结/结算，避免 amount<=0 报错
    if billed:
        try:
            freeze_credits(db=db, user_id=user.id, amount=cost, reference_id=reference_id)
        except ValueError as exc:
            raise HTTPException(status_code=402, detail=str(exc))

    try:
        resp = await call_upstream(source, body, user_id=str(user.id))
    except Exception:
        # 上游失败：释放冻结积分
        if billed:
            try:
                release_frozen_credits(db=db, user_id=user.id, amount=cost, reference_id=reference_id)
            except ValueError:
                pass
        raise

    text = ""
    if isinstance(resp, dict):
        choices = resp.get("choices") or []
        if choices:
            text = (choices[0].get("message") or {}).get("content") or ""
    if not text:
        # 模型未返回可用内容：视为失败，释放冻结
        if billed:
            try:
                release_frozen_credits(db=db, user_id=user.id, amount=cost, reference_id=reference_id)
            except ValueError:
                pass
        return None, cost

    if billed:
        try:
            settle_frozen_credits(db=db, user_id=user.id, amount=cost, reference_id=reference_id)
        except ValueError:
            try:
                release_frozen_credits(db=db, user_id=user.id, amount=cost, reference_id=reference_id)
            except ValueError:
                pass
    return text, cost


@router.post("/media/analyze")
async def analyze_media(
    file: UploadFile = File(...),
    kind: str = Form(...),  # image | video | audio
    prompt: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """多模态实验室：上传媒体文件，视觉文本模型分析并返回可复刻提示词。

    图片直接内联分析；视频自动抽首帧后分析；音频需音频类模型（当前提示未配置）。
    """
    if kind not in MEDIA_ANALYSIS_PROMPTS:
        raise HTTPException(status_code=422, detail="kind 必须为 image/video/audio")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="文件为空")
    if len(data) > MAX_MEDIA_BYTES:
        raise HTTPException(status_code=422, detail=f"文件过大：{len(data) / 1024 / 1024:.1f}MB，上限 {MAX_MEDIA_BYTES / 1024 / 1024:.0f}MB")

    source = None
    model_name = ""

    if kind == "image":
        source = _resolve_vision_source(db, current_user)
        model_name = (source.extra_body or {}).get("model") or source.model_version
        mime = file.content_type or "image/png"
        if not mime.startswith("image/"):
            mime = "image/png"
        data_url = f"data:{mime};base64," + base64.b64encode(data).decode()
    elif kind == "video":
        source = _resolve_vision_source(db, current_user)
        model_name = (source.extra_body or {}).get("model") or source.model_version
        data_url = await _extract_video_first_frame(data)
    else:  # audio
        # TTS/音频模态当前仅留接口（见需求：配音留调用模型变量），分析需 Omni 类音频模型。
        from app.services.agent_loop import _resolve_audio_source
        audio_source = _resolve_audio_source(db, current_user)
        if audio_source:
            model_name = (audio_source.extra_body or {}).get("model") or audio_source.model_version
        # 音频分析执行器尚未接通供应商（接口已预留，见 AUDIO_MODEL 变量）。图片/视频分析可用。
        raise HTTPException(
            status_code=501,
            detail=f"音频模态执行器尚未接通供应商（AUDIO_MODEL={'已配置:' + model_name if model_name else '未配置'}）。图片/视频分析可用。",
        )

    # R3-2: 计费变量名解析 —— 显式 model 参数优先，否则跟随文本模型解析结果
    if model and model.strip():
        from app.services.model_service import resolve_source_for_variable
        variable_name = model.strip()
        explicit_source = resolve_source_for_variable(db, variable_name, current_user)
        if explicit_source:
            source = explicit_source
    else:
        from app.services.agent_loop import _resolve_text_source
        variable_name, _ = _resolve_text_variable(db, current_user)
        if source is None:
            source = _resolve_text_source(db, current_user)
    if not source:
        raise HTTPException(status_code=400, detail="未配置文本模型（TEXT_MODEL），请先在管理后台配置模型路由")

    final_prompt = (prompt or "").strip() or MEDIA_ANALYSIS_PROMPTS[kind]

    body = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": "你是一名专业的影视/音乐分析专家，输出中文，结构化分点。"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": final_prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
    }

    # R3-2: 冻结 → 分析 → 结算/释放（余额不足 402）
    reference_id = f"media-analyze-{uuid.uuid4()}"
    text, _cost = await _run_paid_analysis(db, current_user, variable_name, source, body, reference_id)
    if not text:
        raise HTTPException(status_code=502, detail="模型未返回分析结果")

    return {"kind": kind, "model": model_name, "analysis": text}


# ---------------------------------------------------------------------------
# 一句话 → 分段视频提示词
# ---------------------------------------------------------------------------

SEGMENT_PROMPT_TEMPLATE = (
    "你是一名专业的 AI 视频导演。请把下面这句创意（一句话）展开成 {segments} 段连续的视频生成提示词。\n"
    "要求：\n"
    "1. 每段对应一个独立镜头，单段时长不超过 {segment_seconds} 秒（适合主流视频模型单次生成）。\n"
    "2. 每段包含：画面主体、动作、运镜、景别、光线、氛围；相邻段落保持主体与风格连贯。\n"
    "3. 如果原始创意涉及产品/广告（如把商品卖出高价），要体现营销叙事逻辑：悬念→展示→价值→行动。\n"
    "4. 输出格式，每段以「段落 N（X 秒）」开头，后跟中文提示词正文。\n\n"
    "创意：{prompt}\n\n"
    "附加要求（如有）：{custom}"
)


class _SplitPromptsBody(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=500)
    segments: int = Field(3, ge=1, le=12)          # 默认 3 段
    segment_seconds: int = Field(15, ge=5, le=30)  # 单段秒数，默认 15
    custom: str = Field("", max_length=2000)


@router.post("/prompts/split")
async def split_video_prompts(
    payload: _SplitPromptsBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """把一句话创意拆成多段（≤15s/段）视频生成提示词，对标乐凡「导演自动规划」。"""
    variable_name, source = _resolve_text_variable(db, current_user)
    if not source:
        raise HTTPException(status_code=400, detail="未配置文本模型（TEXT_MODEL），请先在管理后台配置模型路由")
    model_name = (source.extra_body or {}).get("model") or source.model_version
    system = SEGMENT_PROMPT_TEMPLATE.format(
        segments=payload.segments,
        segment_seconds=payload.segment_seconds,
        prompt=payload.prompt,
        custom=payload.custom,
    )

    body = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": payload.prompt},
        ],
    }

    # R3-2: 冻结 → 分段 → 结算/释放（余额不足 402）
    reference_id = f"prompts-split-{uuid.uuid4()}"
    text, _cost = await _run_paid_analysis(db, current_user, variable_name, source, body, reference_id)
    if not text:
        raise HTTPException(status_code=502, detail="模型未返回分段提示词")

    return {"model": model_name, "segments": payload.segments, "segment_seconds": payload.segment_seconds, "content": text}


# ---------------------------------------------------------------------------
# TTS 配音（仅保留调用接口 / 变量占位，供应商未接通）
# ---------------------------------------------------------------------------

class _TtsBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    voice: str = Field("", max_length=100)  # 音色变量（供应商支持时透传）
    lang: str = Field("zh", max_length=16)


@router.post("/tts/generate")
async def generate_tts(
    payload: _TtsBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """TTS 配音生成（接口预留）。

    当前仅保留模型调用接口：通过 AUDIO_MODEL 变量解析 audio 模态 ApiSource，
    供应商执行器尚未接通。配置好 audio 源后在此处接入 call_upstream 的 audio
    模态调用（参考 gateway_service 的 reference_audios 处理）。
    """
    from app.services.agent_loop import _resolve_audio_source

    audio_source = _resolve_audio_source(db, current_user)
    if not audio_source:
        raise HTTPException(
            status_code=400,
            detail="未配置音频模型（AUDIO_MODEL / audio 模态 ApiSource）。配音接口已预留，配置后即可启用。",
        )
    model_name = (audio_source.extra_body or {}).get("model") or audio_source.model_version
    # TODO(P6+): 在此调用 call_upstream 的 audio 模态执行器（如 FishAudio / ElevenLabs / 阿里云 TTS），
    # 返回音频 URL 并写入 drama_assets(type=audio)。当前供应商执行器未接通，仅返回配置状态。
    return {
        "ok": False,
        "code": "audio_provider_not_implemented",
        "model": model_name,
        "message": f"音频模型已解析（{model_name}），但 TTS 供应商执行器尚未接通，请等待后续版本。",
    }
