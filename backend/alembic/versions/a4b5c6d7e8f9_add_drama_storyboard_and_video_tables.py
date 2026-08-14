"""add_drama_storyboard_and_video_tables

Revision ID: a4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-08-14 11:40:00.000000

P6: create ``drama_storyboard`` (shots) and ``drama_video`` (video clips).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision = "a4b5c6d7e8f9"
down_revision = "f3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "drama_storyboard",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("script_id", UUID(as_uuid=True), nullable=True),
        sa.Column("index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("video_desc", sa.Text(), nullable=True),
        sa.Column("duration", sa.Integer(), nullable=True, server_default="5"),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("image_state", sa.String(length=32), nullable=True),
        sa.Column("error_reason", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.String(length=1), nullable=False, server_default="N"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_drama_storyboard_user_id", "drama_storyboard", ["user_id"])
    op.create_index("ix_drama_storyboard_script_index", "drama_storyboard", ["script_id", "index"])

    op.create_table(
        "drama_video",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("script_id", UUID(as_uuid=True), nullable=True),
        sa.Column("storyboard_id", UUID(as_uuid=True), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("video_url", sa.Text(), nullable=True),
        sa.Column("duration", sa.Integer(), nullable=True, server_default="5"),
        sa.Column("model", sa.String(length=255), nullable=True),
        sa.Column("state", sa.String(length=32), nullable=False, server_default="生成中"),
        sa.Column("error_reason", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.String(length=1), nullable=False, server_default="N"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_drama_video_user_id", "drama_video", ["user_id"])
    op.create_index("ix_drama_video_project_updated", "drama_video", ["project_id", "updated_at"])


def downgrade() -> None:
    op.drop_index("ix_drama_video_project_updated", table_name="drama_video")
    op.drop_index("ix_drama_video_user_id", table_name="drama_video")
    op.drop_table("drama_video")

    op.drop_index("ix_drama_storyboard_script_index", table_name="drama_storyboard")
    op.drop_index("ix_drama_storyboard_user_id", table_name="drama_storyboard")
    op.drop_table("drama_storyboard")
