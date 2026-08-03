"""add_generation_sessions

Revision ID: 60840735b2a5
Revises: 001
Create Date: 2026-08-01 19:36:33.268566

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '60840735b2a5'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'generation_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('modal_category', sa.String(length=32), nullable=False),
        sa.Column('prompt', sa.Text(), nullable=False),
        sa.Column('model', sa.String(length=128), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('result_urls', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_generation_sessions_modal_category'), 'generation_sessions', ['modal_category'], unique=False)
    op.create_index(op.f('ix_generation_sessions_user_id'), 'generation_sessions', ['user_id'], unique=False)
    op.create_index('ix_generation_sessions_user_category_created', 'generation_sessions', ['user_id', 'modal_category', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_generation_sessions_user_category_created', table_name='generation_sessions')
    op.drop_index(op.f('ix_generation_sessions_user_id'), table_name='generation_sessions')
    op.drop_index(op.f('ix_generation_sessions_modal_category'), table_name='generation_sessions')
    op.drop_table('generation_sessions')
