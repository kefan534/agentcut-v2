"""P2-10 多供应商格式适配器注册表。

乐凡 Film OS 的价值之一是一套前端适配 8+ 供应商（openai/deepseek/minimax_h3/
vidu/nvidia/stable diffusion/...），靠 ``adapterFormat`` / ``inferApiFormat`` /
``resolveConnection`` 统一连接解析层。

AgentCut 的 gateway 已经抽象出 ``ApiSource``（厂商/版本/源）+ ``VariableMapping``，
``model_service.resolve_source_for_variable`` 负责按 variable 解析上游。这里把"各供应商
的请求/响应格式、支持模态、对接注意事项"沉淀为一个**只读注册表**，供模型控制台展示与
将来低成本接入更多视频/图片模型使用——属于"能力登记 + 文档化"，不改动既有调用链路，
因此不会影响线上稳定性。

后续若要真正抽象 ``resolveConnection``，可在此注册表基础上扩展，而非推倒重来。
"""

from typing import Dict, List


class ProviderAdapter:
    def __init__(
        self,
        key: str,
        display_name: str,
        supported_types: List[str],
        request_format: str,
        response_format: str,
        notes: str = "",
    ) -> None:
        self.key = key
        self.display_name = display_name
        self.supported_types = supported_types
        self.request_format = request_format
        self.response_format = response_format
        self.notes = notes

    def to_dict(self) -> Dict[str, object]:
        return {
            "key": self.key,
            "display_name": self.display_name,
            "supported_types": self.supported_types,
            "request_format": self.request_format,
            "response_format": self.response_format,
            "notes": self.notes,
        }


PROVIDER_ADAPTERS: Dict[str, ProviderAdapter] = {
    "openai_chat": ProviderAdapter(
        key="openai_chat",
        display_name="OpenAI Chat",
        supported_types=["text"],
        request_format="OpenAI chat/completions（messages + stream）",
        response_format="SSE / JSON choices[0].message.content",
        notes="GPT 系文本生成；gateway 直连 messages。",
    ),
    "openai_image": ProviderAdapter(
        key="openai_image",
        display_name="OpenAI Image",
        supported_types=["image"],
        request_format="images/generations（prompt + size + n）",
        response_format="JSON data[].url / b64_json",
        notes="GPT 系文生图。",
    ),
    "deepseek": ProviderAdapter(
        key="deepseek",
        display_name="DeepSeek",
        supported_types=["text"],
        request_format="OpenAI 兼容 chat/completions",
        response_format="SSE / JSON",
        notes="剧作工坊编剧链路默认供应商。",
    ),
    "minimax_h3": ProviderAdapter(
        key="minimax_h3",
        display_name="MiniMax H3（海螺）",
        supported_types=["video", "audio", "text"],
        request_format="MiniMax 自有 API（video_generation / chat）",
        response_format="task_id + 轮询 URL",
        notes="视频生成需异步轮询；Compshare GPU 以 API 方式接入。",
    ),
    "vidu": ProviderAdapter(
        key="vidu",
        display_name="Vidu",
        supported_types=["video"],
        request_format="Vidu API（prompt + image_ref + duration）",
        response_format="task_id + 轮询 URL",
        notes="支持参考图/首帧生视频。",
    ),
    "nvidia": ProviderAdapter(
        key="nvidia",
        display_name="NVIDIA NVCF",
        supported_types=["video", "image"],
        request_format="NVCF function invoke（cosmos3 等）",
        response_format="invocation + 轮询",
        notes="云端推理函数，需 function id。",
    ),
    "stable_diffusion": ProviderAdapter(
        key="stable_diffusion",
        display_name="Stable Diffusion",
        supported_types=["image"],
        request_format="txt2img（prompt + steps + cfg）",
        response_format="base64 PNG",
        notes="已弃用，AgentCut 暂以 EdgeOne / Agnes 为主。",
        # 标记弃用
    ),
    "agnes_video": ProviderAdapter(
        key="agnes_video",
        display_name="Agnes Video v2.0",
        supported_types=["video", "image"],
        request_format="video_mode{duration,ratio,resolution,input_reference}",
        response_format="任务 + 结果 URL",
        notes="视频生成主线路（替代 MiniMax H3），与 @N input_reference 天然契合。",
    ),
    "edgeone_makers": ProviderAdapter(
        key="edgeone_makers",
        display_name="EdgeOne Makers Agent",
        supported_types=["image", "video", "text"],
        request_format="Makers Agent 对话/工具调用",
        response_format="流式消息 + 媒体 URL",
        notes="canvas 协作工作台集成。",
    ),
    "ssry": ProviderAdapter(
        key="ssry",
        display_name="SSRY（¥ 单价计费）",
        supported_types=["text", "image", "video"],
        request_format="厂商原生 API",
        response_format="厂商原生",
        notes="按 ¥ 单价计费示例。",
    ),
    "inroi": ProviderAdapter(
        key="inroi",
        display_name="InROI（USD 预算计费）",
        supported_types=["text", "image", "video"],
        request_format="厂商原生 API",
        response_format="厂商原生",
        notes="按 USD 预算计费示例。",
    ),
}


def list_provider_adapters() -> List[Dict[str, object]]:
    return [adapter.to_dict() for adapter in PROVIDER_ADAPTERS.values()]


def get_provider_adapter(key: str):
    return PROVIDER_ADAPTERS.get(key)
