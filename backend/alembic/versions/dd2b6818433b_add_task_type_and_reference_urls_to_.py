"""add task_type and reference_urls to generation_sessions

Revision ID: dd2b6818433b
Revises: 60840735b2a5
Create Date: 2026-08-01 23:53:51.191816

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'dd2b6818433b'
down_revision = '60840735b2a5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("generation_sessions", sa.Column("task_type", sa.String(32), nullable=False, server_default="text"))
    op.add_column("generation_sessions", sa.Column("reference_urls", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))


def downgrade() -> None:
    op.drop_column("generation_sessions", "reference_urls")
    op.drop_column("generation_sessions", "task_type")
