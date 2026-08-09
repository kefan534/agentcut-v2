"""add_rate_limit_buckets_table

Revision ID: df9fcf8f7035
Revises: 8f9a1b2c3d4e
Create Date: 2026-08-09 17:52:20.369287

Persistent rate-limit bucket storage in PostgreSQL so limits survive process restarts.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'df9fcf8f7035'
down_revision = '8f9a1b2c3d4e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'rate_limit_buckets',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('bucket_key', sa.String(length=255), nullable=False, index=True),
        sa.Column('event_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_rate_limit_buckets_key_event', 'rate_limit_buckets', ['bucket_key', 'event_at'])


def downgrade() -> None:
    op.drop_index('ix_rate_limit_buckets_key_event', table_name='rate_limit_buckets')
    op.drop_table('rate_limit_buckets')
