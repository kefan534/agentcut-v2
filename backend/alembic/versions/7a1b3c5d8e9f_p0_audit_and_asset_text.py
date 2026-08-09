"""P0: agent_audit_logs table + assets parsing/OCR columns

Revision ID: 7a1b3c5d8e9f
Revises: 60840735b2a5
Create Date: 2026-08-08 19:30:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


# revision identifiers, used by Alembic.
revision = "7a1b3c5d8e9f"
down_revision = "dd2b6818433b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Extend assets table with parser/OCR fields
    op.add_column(
        "assets",
        sa.Column("text", sa.Text(), nullable=True),
    )
    op.add_column(
        "assets",
        sa.Column("text_status", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "assets",
        sa.Column("text_length", sa.Integer(), nullable=True),
    )
    op.add_column(
        "assets",
        sa.Column("text_error", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "assets",
        sa.Column("ocr_used", sa.String(length=32), nullable=True),
    )

    # Index for fast repository queries by (user_id, asset_type, text_status)
    op.create_index(
        "ix_assets_user_text_status",
        "assets",
        ["user_id", "text_status"],
    )

    # 2) New agent_audit_logs table
    op.create_table(
        "agent_audit_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("event", sa.String(length=64), nullable=False),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("tool_name", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="success"),
        sa.Column("meta", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
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
    op.create_index(
        "ix_audit_user_event_time",
        "agent_audit_logs",
        ["user_id", "event", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_user_event_time", table_name="agent_audit_logs")
    op.drop_index("ix_agent_audit_logs_session_id", table_name="agent_audit_logs")
    op.drop_index("ix_agent_audit_logs_created_at", table_name="agent_audit_logs")
    op.drop_index("ix_agent_audit_logs_event", table_name="agent_audit_logs")
    op.drop_index("ix_agent_audit_logs_user_id", table_name="agent_audit_logs")
    op.drop_table("agent_audit_logs")

    op.drop_index("ix_assets_user_text_status", table_name="assets")
    op.drop_column("assets", "ocr_used")
    op.drop_column("assets", "text_error")
    op.drop_column("assets", "text_length")
    op.drop_column("assets", "text_status")
    op.drop_column("assets", "text")
