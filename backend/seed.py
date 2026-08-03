"""Seed initial data for infinite-canvas-backend."""
import os
import uuid
from sqlalchemy.orm import Session
from app.db.session import Base, SessionLocal, engine
from app.models.user import User
from app.models.model import ApiSource, VariableMapping
from app.core.security import get_password_hash
from app.core.encryption import encrypt_api_key


def seed():
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()

    # Default admin
    admin_email = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@example.com")
    admin_password = os.getenv("DEFAULT_ADMIN_PASSWORD", "admin123456")
    admin = db.query(User).filter(User.email == admin_email).first()
    if not admin:
        admin = User(
            id=uuid.uuid4(),
            email=admin_email,
            hashed_password=get_password_hash(admin_password),
            nickname="Admin",
            role="admin",
            level="vip",
            credits=100000,
        )
        db.add(admin)
        db.commit()
        print(f"Created admin: {admin_email} / {admin_password}")

    # Example sources (placeholder credentials, must be updated in admin panel)
    text_source = db.query(ApiSource).filter(
        ApiSource.vendor == "openai",
        ApiSource.model_version == "gpt-4o-mini",
    ).first()
    if not text_source:
        text_source = ApiSource(
            modal_category="text",
            vendor="openai",
            model_version="gpt-4o-mini",
            source_name="official",
            base_url="https://api.openai.com",
            endpoint_path="/v1/chat/completions",
            api_key_encrypted=encrypt_api_key("sk-placeholder"),
            timeout_ms=30000,
            retry_count=2,
            is_active=True,
            allowed_user_levels=["free", "paid", "vip"],
        )
        db.add(text_source)
        db.commit()
        db.refresh(text_source)

    image_source = db.query(ApiSource).filter(
        ApiSource.vendor == "openai",
        ApiSource.model_version == "dall-e-3",
    ).first()
    if not image_source:
        image_source = ApiSource(
            modal_category="image",
            vendor="openai",
            model_version="dall-e-3",
            source_name="official",
            base_url="https://api.openai.com",
            endpoint_path="/v1/images/generations",
            api_key_encrypted=encrypt_api_key("sk-placeholder"),
            timeout_ms=60000,
            retry_count=2,
            is_active=True,
            allowed_user_levels=["free", "paid", "vip"],
        )
        db.add(image_source)
        db.commit()
        db.refresh(image_source)

    # Variable mappings
    defaults = [
        ("TEXT_MODEL", "text", text_source.id),
        ("IMAGE_MODEL", "image", image_source.id),
        ("VIDEO_MODEL", "video", None),
        ("AUDIO_MODEL", "audio", None),
    ]
    for var_name, category, source_id in defaults:
        existing = db.query(VariableMapping).filter(VariableMapping.variable_name == var_name).first()
        if not existing and source_id:
            db.add(VariableMapping(
                variable_name=var_name,
                modal_category=category,
                default_source_id=source_id,
                description=f"Default {category} model variable",
            ))
    db.commit()
    print("Seeding completed.")


if __name__ == "__main__":
    seed()
