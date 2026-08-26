import asyncio
import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.core.config import settings
from app.db.session import Base, engine
from app.api.auth.router import router as auth_router
from app.api.gateway.router import router as gateway_router
from app.api.upload.router import router as upload_router
from app.api.projects.router import router as projects_router
from app.api.admin.router import router as admin_router
from app.api.agent.router import router as agent_router
from app.api.skills.router import router as skills_router, admin_router as admin_skills_router
from app.api.admin.model_pricing import router as admin_model_pricing_router
from app.api.admin.audit_logs import router as audit_logs_router
from app.api.drama.router import router as drama_router

# P1/P2 新模块（路由前缀已含 /api/v1 的，include 时不叠加前缀；前缀为 /drama 的叠加）
try:
    from app.api.billing.router import router as billing_router
except ImportError:
    billing_router = None
try:
    from app.api.diagnostics.router import router as diagnostics_router
except ImportError:
    diagnostics_router = None
try:
    from app.api.qa.router import router as qa_router
except ImportError:
    qa_router = None
try:
    from app.api.drama.export_import import router as export_import_router
except ImportError:
    export_import_router = None
try:
    from app.api.drama.creative_tools import router as creative_tools_router
except ImportError:
    creative_tools_router = None

# Optional modules (may not exist in all deployments)
try:
    from app.api.assets.router import router as assets_router
except ImportError:
    assets_router = None
try:
    from app.api.samples.router import router as samples_router
except ImportError:
    samples_router = None

app = FastAPI(
    title="Infinite Canvas Backend",
    description="Backend for infinite-canvas-main: multi-user, variable model gateway, admin",
    version="0.1.0",
    debug=settings.DEBUG,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "X-Agent-Tool-Secret"],
)

app.include_router(auth_router, prefix=settings.API_V1_PREFIX)
app.include_router(gateway_router, prefix=settings.API_V1_PREFIX)
app.include_router(upload_router, prefix=settings.API_V1_PREFIX)
app.include_router(projects_router, prefix=settings.API_V1_PREFIX)
if assets_router:
    app.include_router(assets_router, prefix=settings.API_V1_PREFIX)
if samples_router:
    app.include_router(samples_router, prefix=settings.API_V1_PREFIX)
app.include_router(admin_router, prefix=settings.API_V1_PREFIX)
app.include_router(agent_router, prefix=settings.API_V1_PREFIX)
app.include_router(skills_router, prefix=settings.API_V1_PREFIX)
app.include_router(admin_skills_router, prefix=settings.API_V1_PREFIX)
app.include_router(admin_model_pricing_router, prefix=settings.API_V1_PREFIX)
app.include_router(audit_logs_router, prefix=settings.API_V1_PREFIX)
app.include_router(drama_router, prefix=settings.API_V1_PREFIX)

# P1/P2 新模块注册（前缀统一不带 /api/v1，此处叠加 API_V1_PREFIX）
if billing_router:
    app.include_router(billing_router, prefix=settings.API_V1_PREFIX)
if diagnostics_router:
    app.include_router(diagnostics_router, prefix=settings.API_V1_PREFIX)
if qa_router:
    app.include_router(qa_router, prefix=settings.API_V1_PREFIX)
if export_import_router:
    app.include_router(export_import_router, prefix=settings.API_V1_PREFIX)  # 前缀为 /drama
if creative_tools_router:
    app.include_router(creative_tools_router, prefix=settings.API_V1_PREFIX)  # 前缀为 /drama


# Ensure upload directory exists (no public static mount; files served via /api/v1/upload)
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)


@app.on_event("startup")
async def _init_schema() -> None:
    """Lightweight schema bootstrap.

    Creates any missing tables (for P0 additions like `agent_audit_logs` and
    extended `assets` columns). Idempotent — alembic remains the source of
    truth for production migrations.
    """
    # Import models so their tables register on Base.metadata.
    from app.models import agent_audit_log  # noqa: F401  (side-effect import)
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:  # pragma: no cover
        import logging
        logging.getLogger(__name__).warning("create_all failed: %s", exc)

    # 幂等补列：为已存在的 users 表补 frozen_balance（create_all 不会 ALTER 已有表）。
    try:
        from sqlalchemy import text
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS frozen_balance INTEGER NOT NULL DEFAULT 0"
            ))
    except Exception as exc:  # pragma: no cover
        import logging
        logging.getLogger(__name__).warning("add frozen_balance column failed: %s", exc)

    # R3-3: 锁定卡唯一约束迁移 —— 物理 UNIQUE 改「活跃行部分唯一索引」，
    # 兼容软删除（旧表存在 drama_lock_card_project_id_key 时先删再建）。
    try:
        import logging
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE drama_lock_card DROP CONSTRAINT IF EXISTS drama_lock_card_project_id_key"
            ))
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_drama_lock_card_active "
                "ON drama_lock_card (project_id) WHERE is_deleted = 'N'"
            ))
    except Exception as exc:  # pragma: no cover
        import logging
        logging.getLogger(__name__).warning("lock_card unique index migration failed: %s", exc)

    # R2-#2-B: 重启对账 —— 任务队列在内存字典中，进程重启即丢；
    # 遗留的冻结余额必然是孤儿冻结（无对应 settle/release），全额释放回可用余额。
    # 幂等：仅处理 frozen_balance <> 0 的行。必须在任务恢复（re-freeze）之前执行。
    try:
        import logging
        with engine.begin() as conn:
            result = conn.execute(text(
                "UPDATE users SET credits = credits + frozen_balance, frozen_balance = 0 "
                "WHERE frozen_balance <> 0"
            ))
        if result.rowcount:
            logging.getLogger(__name__).info(
                "reconciled %d user(s): released orphan frozen credits on startup", result.rowcount
            )
    except Exception as exc:  # pragma: no cover
        import logging
        logging.getLogger(__name__).warning("frozen_balance reconciliation failed: %s", exc)

    # P1: 恢复进程重启前未完成的视频生成任务（asyncio.create_task 易失，重启后继续）。
    await _recover_pending_video_jobs()


async def _recover_pending_video_jobs() -> None:
    """Scan ``drama_video`` rows stuck in '生成中' and resume their generation."""
    import logging
    from app.db.session import SessionLocal
    from app.models.drama import DramaVideo
    from app.api.drama.router import _run_video_generation

    log = logging.getLogger(__name__)
    db = SessionLocal()
    try:
        pending = db.query(DramaVideo).filter(
            DramaVideo.state == "生成中",
            DramaVideo.is_deleted == "N",
        ).all()
        for v in pending:
            asyncio.create_task(_run_video_generation(str(v.id), str(v.user_id)))
        if pending:
            log.info("recovered %d pending video job(s)", len(pending))
    except Exception as exc:  # pragma: no cover
        log.warning("recover pending video jobs failed: %s", exc)
    finally:
        db.close()


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Never leak internal exception details to clients."""
    if settings.DEBUG:
        raise exc
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
