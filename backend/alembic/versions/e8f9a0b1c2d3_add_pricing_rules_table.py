"""add_pricing_rules_table

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-08-16 23:25:00.000000

Flexible per-model credit pricing tiers.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "e8f9a0b1c2d3"
down_revision = "d7e8f9a0b1c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pricing_rules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("variable_name", sa.String(length=64), nullable=False),
        sa.Column("param_conditions", JSONB(), nullable=False, server_default="{}"),
        sa.Column("credits", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_pricing_rules_variable_name", "pricing_rules", ["variable_name"])


def downgrade() -> None:
    op.drop_index("ix_pricing_rules_variable_name", table_name="pricing_rules")
    op.drop_table("pricing_rules")
