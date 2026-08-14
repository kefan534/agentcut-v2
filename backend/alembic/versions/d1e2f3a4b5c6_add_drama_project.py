"""add_drama_project_table

Revision ID: d1e2f3a4b5c6
Revises: df9fcf8f7035
Create Date: 2026-08-13 22:30:00.000000

P1: create ``drama_project`` table for the short-drama (Toonflow) module.
Ports Toonflow ``o_project`` to AgentCut conventions (UUID PK, user_id isolation,
soft delete).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision = "d1e2f3a4b5c6"
down_revision = "df9fcf8f7035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "drama_project",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("intro", sa.Text(), nullable=True),
        sa.Column("project_type", sa.String(length=64), nullable=True),
        sa.Column("type", sa.String(length=64), nullable=True),
        sa.Column("art_style", sa.Text(), nullable=True),
        sa.Column("director_manual", sa.Text(), nullable=True),
        sa.Column("video_ratio", sa.String(length=32), nullable=True),
        sa.Column("image_model", sa.String(length=255), nullable=True),
        sa.Column("video_model", sa.String(length=255), nullable=True),
        sa.Column("image_quality", sa.String(length=64), nullable=True),
        sa.Column("mode", sa.String(length=32), nullable=True),
        sa.Column("is_deleted", sa.String(length=1), nullable=False, server_default="N"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_drama_project_user_id", "drama_project", ["user_id"])
    op.create_index(
        "ix_drama_project_user_updated",
        "drama_project",
        ["user_id", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_drama_project_user_updated", table_name="drama_project")
    op.drop_index("ix_drama_project_user_id", table_name="drama_project")
    op.drop_table("drama_project")
