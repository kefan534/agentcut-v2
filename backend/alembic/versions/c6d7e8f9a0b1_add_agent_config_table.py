"""add_agent_config_table

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-08-16 18:10:00.000000

Agent configuration table for per-scope agent tunables.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "c6d7e8f9a0b1"
down_revision = "b5c6d7e8f9a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_config",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("scope", sa.String(length=64), nullable=False),
        sa.Column("system_prompt", sa.Text(), nullable=True),
        sa.Column("model_variable", sa.String(length=64), nullable=True),
        sa.Column("enabled_tools", JSONB(), nullable=True),
        sa.Column("max_steps", sa.Integer(), nullable=True),
        sa.Column("tool_timeout_sec", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_agent_config_scope", "agent_config", ["scope"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_agent_config_scope", table_name="agent_config")
    op.drop_table("agent_config")
