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


# Ensure upload directory exists (no public static mount; files served via /api/v1/upload)
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)


@app.on_event("startup")
def _init_schema() -> None:
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
