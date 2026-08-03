import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.core.config import settings
from app.api.auth.router import router as auth_router
from app.api.gateway.router import router as gateway_router
from app.api.upload.router import router as upload_router
from app.api.projects.router import router as projects_router
from app.api.assets.router import router as assets_router
from app.api.samples.router import router as samples_router
from app.api.admin.router import router as admin_router
from app.api.agent.router import router as agent_router

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
app.include_router(assets_router, prefix=settings.API_V1_PREFIX)
app.include_router(samples_router, prefix=settings.API_V1_PREFIX)
app.include_router(admin_router, prefix=settings.API_V1_PREFIX)
app.include_router(agent_router, prefix=settings.API_V1_PREFIX)


# Ensure upload directory exists (no public static mount; files served via /api/v1/upload)
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)


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
