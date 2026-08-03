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
