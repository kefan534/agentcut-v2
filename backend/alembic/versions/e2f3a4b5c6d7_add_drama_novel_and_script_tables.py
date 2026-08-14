"""add_drama_novel_and_script_tables

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-08-13 23:20:00.000000

P3/P4: create ``drama_novel`` (novel chapters) and ``drama_script`` (scripts).
Ports Toonflow ``o_novel`` / ``o_script`` to AgentCut conventions (UUID PK,
user_id isolation, soft delete).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision = "e2f3a4b5c6d7"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "drama_novel",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("chapter_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reel", sa.Text(), nullable=True),
        sa.Column("chapter", sa.Text(), nullable=True),
        sa.Column("chapter_data", sa.Text(), nullable=True),
        sa.Column("event_state", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("event", sa.Text(), nullable=True),
        sa.Column("error_reason", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.String(length=1), nullable=False, server_default="N"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_drama_novel_user_id", "drama_novel", ["user_id"])
    op.create_index("ix_drama_novel_project_index", "drama_novel", ["project_id", "chapter_index"])

    op.create_table(
        "drama_script",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("extract_state", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_reason", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.String(length=1), nullable=False, server_default="N"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_drama_script_user_id", "drama_script", ["user_id"])
    op.create_index("ix_drama_script_project_updated", "drama_script", ["project_id", "updated_at"])


def downgrade() -> None:
    op.drop_index("ix_drama_script_project_updated", table_name="drama_script")
    op.drop_index("ix_drama_script_user_id", table_name="drama_script")
    op.drop_table("drama_script")

    op.drop_index("ix_drama_novel_project_index", table_name="drama_novel")
    op.drop_index("ix_drama_novel_user_id", table_name="drama_novel")
    op.drop_table("drama_novel")
