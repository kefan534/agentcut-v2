"""积分定价默认档位（leaf 模块）。

从 gateway_service 抽出，供 gateway_service / model_service / async_job_service
共用，消除 ``gateway_service ↔ model_service`` 的循环导入。仅含纯数据常量。
"""

# 各模态每次生成的基础积分成本（未命中 pricing_rules 时的兜底档位）
COST_MAP = {
    "text": 1,
    "image": 5,
    "audio": 3,
    "video": 20,
}
