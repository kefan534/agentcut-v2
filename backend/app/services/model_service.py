from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.models.model import ApiSource, VariableMapping
from app.models.user import User
from app.schemas.model import AvailableModelOut, CatalogModelOut


def resolve_source_for_variable(
    db: Session,
    variable_name: str,
    user: Optional[User],
) -> Optional[ApiSource]:
    mapping = db.query(VariableMapping).filter(VariableMapping.variable_name == variable_name).first()
    if not mapping:
        return None

    # Anonymous: return default source without level filtering.
    if user is None:
        return db.query(ApiSource).filter(
            ApiSource.id == mapping.default_source_id,
            ApiSource.is_active == True,
        ).first()

    # Check conditional rules by user level first
    level_rule = mapping.condition_rules.get("user_level", {})
    if user.level in level_rule:
        source = db.query(ApiSource).filter(
            ApiSource.id == level_rule[user.level],
            ApiSource.is_active == True,
        ).first()
        if source and user.level in source.allowed_user_levels:
            return source

    # Default source
    source = db.query(ApiSource).filter(
        ApiSource.id == mapping.default_source_id,
        ApiSource.is_active == True,
    ).first()
    if source and user.level in source.allowed_user_levels:
        return source

    # Fallbacks
    for fallback_id in mapping.fallback_source_ids:
        source = db.query(ApiSource).filter(
            ApiSource.id == fallback_id,
            ApiSource.is_active == True,
        ).first()
        if source and user.level in source.allowed_user_levels:
            return source

    return None


def list_available_models(db: Session, user: Optional[User]) -> List[AvailableModelOut]:
    mappings = db.query(VariableMapping).all()
    results = []
    for m in mappings:
        source = resolve_source_for_variable(db, m.variable_name, user)
        if source:
            results.append(AvailableModelOut(
                variable_name=m.variable_name,
                modal_category=m.modal_category,
                default_source_id=source.id,
                vendor=source.vendor,
                model_version=source.model_version,
                source_name=source.source_name,
                description=m.description,
            ))
    return results


def get_api_source_by_id(db: Session, source_id: int) -> Optional[ApiSource]:
    return db.query(ApiSource).filter(ApiSource.id == source_id).first()


def first_active_source_by_category(
    db: Session,
    modal_category: str,
    user: User,
) -> Optional[ApiSource]:
    """Return the first active source for a modal category the user is allowed to use."""
    return db.query(ApiSource).filter(
        ApiSource.modal_category == modal_category,
        ApiSource.is_active == True,
    ).order_by(ApiSource.priority.asc()).first()


def _default_capabilities(modal_category: str) -> Dict[str, Any]:
    """Minimal Palmier-compatible UI capabilities when none are stored."""
    if modal_category == "video":
        return {
            "durations": [5, 10],
            "aspectRatios": ["16:9", "9:16", "1:1"],
            "resolutions": ["720p", "1080p"],
            "supportsPrompt": True,
            "supportsFirstFrame": True,
            "supportsLastFrame": False,
            "maxReferenceImages": 4,
            "maxReferenceVideos": 1,
            "maxReferenceAudios": 1,
            "maxTotalReferences": 5,
            "framesAndReferencesExclusive": False,
            "referenceTagNoun": "reference",
            "requiresSourceVideo": False,
            "requiresReferenceImage": False,
            "requiresReferenceAudio": False,
        }
    if modal_category == "image":
        return {
            "aspectRatios": ["1:1", "16:9", "9:16"],
            "resolutions": ["1024x1024", "1024x576", "576x1024"],
            "qualities": ["standard", "hd"],
            "supportsImageReference": True,
            "maxImages": 4,
        }
    if modal_category == "audio":
        return {
            "category": "tts",
            "voices": ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
            "defaultVoice": "alloy",
            "supportsLyrics": False,
            "supportsInstrumental": False,
            "supportsStyleInstructions": True,
            "durations": [5, 10, 30, 60],
            "minPromptLength": 1,
        }
    if modal_category == "upscale":
        return {
            "speed": "Medium",
            "p75DurationSeconds": 10,
            "maximumUpscaleFactor": 4.0,
            "supportedTypes": ["image", "video"],
        }
    return {}


def build_catalog(db: Session, user: User) -> List[CatalogModelOut]:
    """Return a Palmier-compatible model catalog from variable mappings.

    Palmier only consumes video/image/audio/upscale models; text models are
    filtered out because they are handled by the web UI, not the mac editor.
    """
    mappings = db.query(VariableMapping).filter(
        VariableMapping.modal_category.in_(["video", "image", "audio", "upscale"])
    ).all()
    results = []
    for m in mappings:
        source = resolve_source_for_variable(db, m.variable_name, user)
        if not source:
            continue
        # Allow per-source capabilities override via extra_body metadata
        capabilities = source.extra_body.get("palmier_capabilities") if source.extra_body else None
        if not capabilities:
            capabilities = _default_capabilities(m.modal_category)
        response_shape = {
            "video": "video",
            "image": "images",
            "audio": "audio",
            "upscale": "upscaledImage",
        }.get(m.modal_category, "images")
        results.append(CatalogModelOut(
            id=m.variable_name,
            kind=m.modal_category,
            display_name=f"{source.vendor} {source.model_version}",
            provider_name=source.vendor,
            description=m.description or f"{source.vendor} {source.model_version} ({source.source_name})",
            allowed_endpoints=["generate"],
            response_shape=response_shape,
            paid_only=source.cost_level in ("high",),
            credits_cost=COST_MAP.get(m.modal_category, 1),
            variable_name=m.variable_name,
            ui_capabilities=capabilities,
        ))
    return results


from app.services.cost_map import COST_MAP
