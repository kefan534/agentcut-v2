"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-07-29 21:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('email', sa.String(255), unique=True, nullable=False, index=True),
        sa.Column('hashed_password', sa.Text, nullable=False),
        sa.Column('nickname', sa.String(64), nullable=True),
        sa.Column('avatar_url', sa.Text, nullable=True),
        sa.Column('role', sa.String(16), nullable=False, server_default='user'),
        sa.Column('level', sa.String(16), nullable=False, server_default='free'),
        sa.Column('credits', sa.Integer, nullable=False, server_default='0'),
        sa.Column('status', sa.String(16), nullable=False, server_default='active'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        'credit_ledger',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('delta', sa.Integer, nullable=False),
        sa.Column('balance_after', sa.Integer, nullable=False),
        sa.Column('reason', sa.String(64), nullable=False),
        sa.Column('reference_id', sa.String(128), nullable=True),
        sa.Column('metadata_json', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_credit_ledger_user_created', 'credit_ledger', ['user_id', 'created_at'])

    op.create_table(
        'api_sources',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('modal_category', sa.String(32), nullable=False, index=True),
        sa.Column('vendor', sa.String(64), nullable=False, index=True),
        sa.Column('model_version', sa.String(64), nullable=False),
        sa.Column('source_name', sa.String(64), nullable=False),
        sa.Column('priority', sa.Integer, nullable=False, server_default='100'),
        sa.Column('base_url', sa.Text, nullable=False),
        sa.Column('endpoint_path', sa.String(255), nullable=False, server_default='/v1/chat/completions'),
        sa.Column('api_key_encrypted', sa.Text, nullable=False),
        sa.Column('timeout_ms', sa.Integer, nullable=False, server_default='30000'),
        sa.Column('retry_count', sa.Integer, nullable=False, server_default='2'),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('cost_level', sa.String(16), nullable=False, server_default='medium'),
        sa.Column('quality_level', sa.String(16), nullable=False, server_default='medium'),
        sa.Column('allowed_user_levels', postgresql.ARRAY(sa.String), nullable=False, server_default='{}'),
        sa.Column('extra_headers', postgresql.JSONB, nullable=True, server_default='{}'),
        sa.Column('extra_body', postgresql.JSONB, nullable=True, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        'variable_mappings',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('variable_name', sa.String(64), unique=True, nullable=False, index=True),
        sa.Column('modal_category', sa.String(32), nullable=False),
        sa.Column('default_source_id', sa.Integer, sa.ForeignKey('api_sources.id'), nullable=False),
        sa.Column('fallback_source_ids', postgresql.ARRAY(sa.Integer), nullable=False, server_default='{}'),
        sa.Column('condition_rules', postgresql.JSONB, nullable=False, server_default='{}'),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        'model_plugins',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(128), nullable=False),
        sa.Column('modal_category', sa.String(32), nullable=False),
        sa.Column('api_source_id', sa.Integer, sa.ForeignKey('api_sources.id'), nullable=True),
        sa.Column('script_content', sa.Text, nullable=False),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        'projects',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('thumbnail_url', sa.Text, nullable=True),
        sa.Column('canvas_data', postgresql.JSONB, nullable=False, server_default='{}'),
        sa.Column('meta', postgresql.JSONB, nullable=False, server_default='{}'),
        sa.Column('is_deleted', sa.String(1), nullable=False, server_default='N'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_projects_user_updated', 'projects', ['user_id', 'updated_at'])

    op.create_table(
        'assets',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('asset_type', sa.String(32), nullable=False, index=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('storage_key', sa.String(512), nullable=False),
        sa.Column('mime_type', sa.String(128), nullable=True),
        sa.Column('size_bytes', sa.Integer, nullable=True),
        sa.Column('width', sa.Integer, nullable=True),
        sa.Column('height', sa.Integer, nullable=True),
        sa.Column('duration_seconds', sa.Float, nullable=True),
        sa.Column('prompt', sa.Text, nullable=True),
        sa.Column('meta', postgresql.JSONB, nullable=False, server_default='{}'),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=True, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_assets_user_type_created', 'assets', ['user_id', 'asset_type', 'created_at'])

    op.create_table(
        'call_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('request_id', sa.String(64), nullable=False, index=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('variable_name', sa.String(64), nullable=False, index=True),
        sa.Column('source_id', sa.Integer, sa.ForeignKey('api_sources.id'), nullable=True),
        sa.Column('modal_category', sa.String(32), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
        sa.Column('status_code', sa.Integer, nullable=True),
        sa.Column('latency_ms', sa.Float, nullable=False, server_default='0'),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.Column('cost_credits', sa.Integer, nullable=False, server_default='0'),
        sa.Column('request_body', postgresql.JSONB, nullable=True),
        sa.Column('response_summary', postgresql.JSONB, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_call_logs_user_created', 'call_logs', ['user_id', 'created_at'])
    op.create_index('ix_call_logs_created', 'call_logs', ['created_at'])


def downgrade() -> None:
    op.drop_table('call_logs')
    op.drop_table('assets')
    op.drop_table('projects')
    op.drop_table('model_plugins')
    op.drop_table('variable_mappings')
    op.drop_table('api_sources')
    op.drop_table('credit_ledger')
    op.drop_table('users')
