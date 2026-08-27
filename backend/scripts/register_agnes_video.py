"""注册 Agnes Video 2.5 / 2.5 Flash 模型源 + 变量映射 + 定价规则。

用法（在服务器 backend 目录、venv 内执行）：
    AGNES_API_KEY=sk-xxx python scripts/register_agnes_video.py

幂等：已存在的行会更新而不是重复插入。
Key 只写入数据库（加密），不落盘、不入仓。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.encryption import encrypt_api_key
from app.db.session import SessionLocal
from app.models.model import ApiSource, VariableMapping
from app.models.pricing_rule import PricingRule

BASE_URL = "https://api.agnes-ai.cn/v1"

MODELS = [
    {
        "variable": "agnes-video-2.5",
        "model_version": "agnes-video-2.5",
        "priority": 60,
        "cost_level": "medium",
        "pricing": [  # (param_conditions, credits, sort_order)
            ({"size": "720P"}, 10, 10),
            ({"size": "960P"}, 15, 11),
            ({"size": "2K"}, 20, 12),
        ],
    },
    {
        "variable": "agnes-video-2.5-flash",
        "model_version": "agnes-video-2.5-flash",
        "priority": 61,
        "cost_level": "low",
        "pricing": [({}, 0, 10)],  # Flash 限时免费期：0 积分
    },
]


def main() -> None:
    api_key = os.environ.get("AGNES_API_KEY", "").strip()
    if not api_key:
        print("错误：请通过环境变量 AGNES_API_KEY 提供 Agnes API Key")
        sys.exit(1)

    db = SessionLocal()
    try:
        for spec in MODELS:
            source = (
                db.query(ApiSource)
                .filter(
                    ApiSource.modal_category == "video",
                    ApiSource.vendor == "agnes",
                    ApiSource.model_version == spec["model_version"],
                )
                .first()
            )
            if source:
                source.base_url = BASE_URL
                source.endpoint_path = "/videos"
                source.api_key_encrypted = encrypt_api_key(api_key)
                source.is_active = True
                source.priority = spec["priority"]
                source.cost_level = spec["cost_level"]
                print(f"[update] api_source #{source.id} {spec['model_version']}")
            else:
                source = ApiSource(
                    modal_category="video",
                    vendor="agnes",
                    model_version=spec["model_version"],
                    source_name="official",
                    priority=spec["priority"],
                    base_url=BASE_URL,
                    endpoint_path="/videos",
                    api_key_encrypted=encrypt_api_key(api_key),
                    timeout_ms=600000,
                    retry_count=1,
                    is_active=True,
                    cost_level=spec["cost_level"],
                    quality_level="high",
                    allowed_user_levels=["free", "paid", "vip"],
                    extra_headers={},
                    extra_body={},
                )
                db.add(source)
                db.flush()
                print(f"[create] api_source #{source.id} {spec['model_version']}")

            mapping = db.query(VariableMapping).filter(VariableMapping.variable_name == spec["variable"]).first()
            if mapping:
                mapping.default_source_id = source.id
                mapping.modal_category = "video"
                print(f"[update] variable_mapping {spec['variable']} -> #{source.id}")
            else:
                db.add(
                    VariableMapping(
                        variable_name=spec["variable"],
                        modal_category="video",
                        default_source_id=source.id,
                        fallback_source_ids=[],
                        condition_rules={},
                        description=f"Agnes Video {spec['model_version']}",
                    )
                )
                print(f"[create] variable_mapping {spec['variable']} -> #{source.id}")

            for conditions, credits, sort_order in spec["pricing"]:
                rule = (
                    db.query(PricingRule)
                    .filter(
                        PricingRule.variable_name == spec["variable"],
                        PricingRule.param_conditions == conditions,
                    )
                    .first()
                )
                if rule:
                    rule.credits = credits
                    rule.enabled = True
                    print(f"[update] pricing_rule {spec['variable']} {conditions} -> {credits} credits")
                else:
                    db.add(
                        PricingRule(
                            variable_name=spec["variable"],
                            param_conditions=conditions,
                            credits=credits,
                            sort_order=sort_order,
                            enabled=True,
                        )
                    )
                    print(f"[create] pricing_rule {spec['variable']} {conditions} -> {credits} credits")

        db.commit()
        print("完成：Agnes 视频模型源注册成功。")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
