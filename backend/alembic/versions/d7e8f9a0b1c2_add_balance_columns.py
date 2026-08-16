"""add_balance_columns

Revision ID: d7e8f9a0b1c2
Revises: c6d7e8f9a0b1
Create Date: 2026-08-16 19:30:00.000000

Add upstream account balance columns to api_sources.
"""
from alembic import op
import sqlalchemy as sa


revision = "d7e8f9a0b1c2"
down_revision = "c6d7e8f9a0b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("api_sources", sa.Column("balance_remaining", sa.Numeric(18, 4), nullable=True))
    op.add_column("api_sources", sa.Column("balance_type", sa.String(length=16), nullable=False, server_default="credits"))
    op.add_column("api_sources", sa.Column("balance_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("api_sources", "balance_updated_at")
    op.drop_column("api_sources", "balance_type")
    op.drop_column("api_sources", "balance_remaining")
