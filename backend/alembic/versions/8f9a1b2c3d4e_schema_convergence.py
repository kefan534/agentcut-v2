"""P0/P1/P2 schema convergence — idempotent migration for manual schema drift

Revision ID: 8f9a1b2c3d4e
Revises: dd2b6818433b
Create Date: 2026-08-09 17:50:00.000000

Context:
- Current DB revision was stuck at dd2b6818433b.
- Several model-driven schema changes (agent_model, model_pricing, skill tables,
  agent_audit_logs, asset text parsing columns) were created manually.
- This migration is intentionally idempotent: it uses `IF NOT EXISTS` checks so it
  can safely run against a database that already has some of these objects.

After applying, `alembic current` should report 8f9a1b2c3d4e.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "8f9a1b2c3d4e"
down_revision = "dd2b6818433b"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = :name"
        ),
        {"name": name},
    )
    return result.scalar() is not None


def _has_column(table: str, column: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    )
    return result.scalar() is not None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1) users.agent_model / agent_model_updated_at
    # ------------------------------------------------------------------
    if not _has_column("users", "agent_model"):
        op.add_column(
            "users",
            sa.Column("agent_model", sa.String(length=128), nullable=True),
        )
    if not _has_column("users", "agent_model_updated_at"):
        op.add_column(
            "users",
            sa.Column("agent_model_updated_at", sa.DateTime(timezone=True), nullable=True),
        )

    # ------------------------------------------------------------------
    # 2) model_pricing table
    # ------------------------------------------------------------------
    if not _has_table("model_pricing"):
        op.create_table(
            "model_pricing",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("model_id", sa.String(length=128), nullable=False, unique=True, index=True),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("supports_tools", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("cost_per_turn", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_model_pricing_enabled", "model_pricing", ["enabled"])

    # ------------------------------------------------------------------
    # 3) user_notifications table
    # ------------------------------------------------------------------
    if not _has_table("user_notifications"):
        op.create_table(
            "user_notifications",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("meta", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("is_read", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_user_notif_user_unread", "user_notifications", ["user_id", "is_read", "created_at"])

    # ------------------------------------------------------------------
    # 4) skill store tables
    # ------------------------------------------------------------------
    if not _has_table("admin_skills"):
        op.create_table(
            "admin_skills",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("category", sa.String(length=64), nullable=False, index=True),
            sa.Column("tags", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("prompt_fragment", sa.Text(), nullable=True),
            sa.Column("tool_overrides", postgresql.JSONB, nullable=True),
            sa.Column("resource_files", postgresql.JSONB, nullable=True),
            sa.Column("price_credits", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("submitter_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
            sa.Column("revenue_ratio", sa.Float(), nullable=False, server_default="0.3"),
            sa.Column("total_revenue", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("avg_rating", sa.Float(), nullable=True),
            sa.Column("review_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("enabled_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("palette", postgresql.JSONB, nullable=True),
            sa.Column("badge", sa.String(length=16), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="draft", index=True),
            sa.Column("review_comment", sa.Text(), nullable=True),
            sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_admin_skills_status_cat", "admin_skills", ["status", "category"])

    if not _has_table("user_skill_bindings"):
        op.create_table(
            "user_skill_bindings",
            sa.Column("user_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False, index=True),
            sa.Column("skill_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False, index=True),
            sa.Column("enabled_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("config", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("cost_paid", sa.Integer(), nullable=True),
        )
        op.create_index("ix_skill_bindings_user", "user_skill_bindings", ["user_id", "skill_id"])

    if not _has_table("skill_reviews"):
        op.create_table(
            "skill_reviews",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("skill_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
            sa.Column("rating", sa.Integer(), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("hidden", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_unique_constraint("uq_skill_review_per_user", "skill_reviews", ["skill_id", "user_id"])

    # ------------------------------------------------------------------
    # 5) asset text / OCR columns (from migration 7a1b3c5d8e9f)
    # ------------------------------------------------------------------
    for col_name, col_type, col_kwargs in [
        ("text", sa.Text(), {"nullable": True}),
        ("text_status", sa.String(length=16), {"nullable": True}),
        ("text_length", sa.Integer(), {"nullable": True}),
        ("text_error", sa.String(length=512), {"nullable": True}),
        ("ocr_used", sa.String(length=32), {"nullable": True}),
    ]:
        if not _has_column("assets", col_name):
            op.add_column("assets", sa.Column(col_name, col_type, **col_kwargs))

    conn = op.get_bind()
    index_exists = conn.execute(
        sa.text(
            "SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ix_assets_user_text_status'"
        )
    ).scalar()
    if not index_exists:
        op.create_index("ix_assets_user_text_status", "assets", ["user_id", "text_status"])

    # ------------------------------------------------------------------
    # 6) agent_audit_logs table (from migration 7a1b3c5d8e9f)
    # ------------------------------------------------------------------
    if not _has_table("agent_audit_logs"):
        op.create_table(
            "agent_audit_logs",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("event", sa.String(length=64), nullable=False),
            sa.Column("target_id", sa.String(length=64), nullable=True),
            sa.Column("tool_name", sa.String(length=64), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="success"),
            sa.Column("meta", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("ip", sa.String(length=64), nullable=True),
            sa.Column("session_id", sa.String(length=64), nullable=True),
            sa.Column("cost_credits", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )
        op.create_index("ix_agent_audit_logs_user_id", "agent_audit_logs", ["user_id"])
        op.create_index("ix_agent_audit_logs_event", "agent_audit_logs", ["event"])
        op.create_index("ix_agent_audit_logs_created_at", "agent_audit_logs", ["created_at"])
        op.create_index("ix_agent_audit_logs_session_id", "agent_audit_logs", ["session_id"])
        op.create_index("ix_audit_user_event_time", "agent_audit_logs", ["user_id", "event", "created_at"])


def downgrade() -> None:
    # Idempotent downgrade is intentionally conservative: only drop objects that exist.
    # Downgrade order matters for foreign-key-less schema.

    def _drop_table_if_exists(name: str) -> None:
        op.execute(sa.text(f'DROP TABLE IF EXISTS "{name}" CASCADE'))

    _drop_table_if_exists("agent_audit_logs")
    _drop_table_if_exists("skill_reviews")
    _drop_table_if_exists("user_skill_bindings")
    _drop_table_if_exists("admin_skills")
    _drop_table_if_exists("user_notifications")
    _drop_table_if_exists("model_pricing")

    for col in ["text", "text_status", "text_length", "text_error", "ocr_used"]:
        if _has_column("assets", col):
            op.drop_column("assets", col)

    if _has_column("users", "agent_model_updated_at"):
        op.drop_column("users", "agent_model_updated_at")
    if _has_column("users", "agent_model"):
        op.drop_column("users", "agent_model")
