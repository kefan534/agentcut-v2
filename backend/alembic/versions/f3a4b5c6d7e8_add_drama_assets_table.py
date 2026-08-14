"""add_drama_assets_table

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-08-14 09:40:00.000000

P5: create ``drama_assets`` (short-drama assets: role / scene / tool + generated image).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision = "f3a4b5c6d7e8"
down_revision = "e2f3a4b5c6d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "drama_assets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("describe", sa.Text(), nullable=True),
        sa.Column("type", sa.String(length=32), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("image_model", sa.String(length=255), nullable=True),
        sa.Column("image_state", sa.String(length=32), nullable=True),
        sa.Column("error_reason", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.String(length=1), nullable=False, server_default="N"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_drama_assets_user_id", "drama_assets", ["user_id"])
    op.create_index("ix_drama_assets_project_type", "drama_assets", ["project_id", "type"])


def downgrade() -> None:
    op.drop_index("ix_drama_assets_project_type", table_name="drama_assets")
    op.drop_index("ix_drama_assets_user_id", table_name="drama_assets")
    op.drop_table("drama_assets")
