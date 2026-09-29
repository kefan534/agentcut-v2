from typing import List, Optional, Union
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator


class Settings(BaseSettings):
    ENV: str = "development"
    DEBUG: bool = False

    HOST: str = "0.0.0.0"
    PORT: int = 8081
    API_V1_PREFIX: str = "/api/v1"

    SECURE_COOKIE: bool = False

    # 前置反向代理是否可信（生产 nginx：置 1 以采信 X-Forwarded-For）
    TRUST_PROXY_HEADERS: bool = False

    CORS_ORIGINS: Union[str, List[str]] = "http://localhost:5173,http://localhost:3000"

    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/infinite_canvas"

    JWT_SECRET: str = "change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    KEY_ENCRYPTION_KEY: str = Field(default="change-me-32bytes-long-key!!!")

    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE_MB: int = 500

    DEFAULT_SIGNUP_CREDITS: int = 100

    REDIS_URL: Optional[str] = None

    # EdgeOne Makers Agent integration
    EDGEONE_MAKERS_AGENT_URL: Optional[str] = None
    EDGEONE_MAKERS_API_KEY: Optional[str] = None
    AGENT_TOOL_SECRET: Optional[str] = None

    # Tencent Cloud COS
    COS_SECRET_ID: Optional[str] = None
    COS_SECRET_KEY: Optional[str] = None
    COS_REGION: str = "ap-guangzhou"
    COS_BUCKET: Optional[str] = None

    # P1: IMA knowledge base
    IMA_API_KEY: Optional[str] = None
    IMA_CLIENT_ID: Optional[str] = None

    # P1: 腾讯云 OCR (智能结构化识别)
    TENCENT_OCR_SECRET_ID: Optional[str] = None
    TENCENT_OCR_SECRET_KEY: Optional[str] = None
    TENCENT_OCR_REGION: str = "ap-guangzhou"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()

# ---------------------------------------------------------------------------
# 生产环境安全底线（fail-fast：配置不合规直接拒绝启动）
# ---------------------------------------------------------------------------
_WEAK_KNOWN_SECRETS = {
    "change-me",
    "change-me-32bytes-long-key!!!",
    "ic-dev-encryption-key-change-in-production-32bytes",
}


def validate_production_settings() -> None:
    if settings.ENV != "production":
        return
    # 1. JWT_SECRET 必须是强随机值
    if settings.JWT_SECRET in _WEAK_KNOWN_SECRETS or len(settings.JWT_SECRET) < 32:
        raise RuntimeError(
            "production 环境必须配置强 JWT_SECRET（≥32 位随机字符串，禁止默认值）"
        )
    # 2. HTTPS 场景强制 Secure cookie
    if not settings.SECURE_COOKIE:
        settings.SECURE_COOKIE = True
    # 3. 加密密钥弱默认仅告警不阻断（存量 DB 里的上游 key 用它加密，换值需迁移）
    if settings.KEY_ENCRYPTION_KEY in _WEAK_KNOWN_SECRETS:
        import logging
        logging.getLogger(__name__).warning(
            "KEY_ENCRYPTION_KEY 仍在使用弱默认值；上游模型 key 加密强度受限，"
            "请尽快迁移为强随机值（迁移需重录各上游 key）"
        )


validate_production_settings()
