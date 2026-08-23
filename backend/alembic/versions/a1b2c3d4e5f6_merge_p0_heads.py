"""merge P0 heads: audit/asset_text + pricing_rules

Revision ID: a1b2c3d4e5f6
Revises: 7a1b3c5d8e9f, e8f9a0b1c2d3
Create Date: 2026-08-16

This is a pure merge migration. Both branches (p0_audit_and_asset_text and
add_pricing_rules_table) have already been applied independently, so the
upgrade/downgrade bodies are intentionally empty. Its only purpose is to
collapse the two leaf heads back into a single linear head so that
``alembic upgrade head`` is unambiguous.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = ["7a1b3c5d8e9f", "e8f9a0b1c2d3"]
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Both branches are already materialized; nothing to do here.
    pass


def downgrade() -> None:
    # Splitting the head again would require reversing two independent
    # branches; intentionally a no-op to keep the graph reversible in shape.
    pass
