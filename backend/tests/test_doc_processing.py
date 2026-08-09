"""Tests for app.services.doc_processing_service."""
from pathlib import Path

import pytest

from app.services.doc_processing_service import parse_asset, MAX_FILE_BYTES


def test_parse_asset_missing_file():
    result = parse_asset(Path("/non/existent/file.pdf"))
    assert result["text_status"] == "failed"
    assert "not found" in result["text_error"]


def test_parse_asset_oversized_file(tmp_path: Path):
    path = tmp_path / "big.txt"
    path.write_bytes(b"x" * (MAX_FILE_BYTES + 1))
    result = parse_asset(path)
    assert result["text_status"] == "failed"
    assert "too large" in result["text_error"]


def test_parse_asset_unsupported_extension(tmp_path: Path):
    path = tmp_path / "archive.zip"
    path.write_bytes(b"PK")
    result = parse_asset(path)
    assert result["text_status"] == "failed"
    assert "unsupported" in result["text_error"]


def test_parse_asset_plain_text(tmp_path: Path):
    path = tmp_path / "notes.txt"
    path.write_text("hello world\nsecond line", encoding="utf-8")
    result = parse_asset(path)
    assert result["text_status"] == "ready"
    assert result["text"] == "hello world\nsecond line"
    assert result["text_length"] == 23


def test_parse_asset_truncates_long_text(tmp_path: Path):
    from app.services.doc_processing_service import MAX_TEXT_CHARS
    path = tmp_path / "long.txt"
    path.write_text("a" * (MAX_TEXT_CHARS + 100), encoding="utf-8")
    result = parse_asset(path)
    assert result["text_status"] == "ready"
    assert len(result["text"]) == MAX_TEXT_CHARS
    assert result["text_error"] == "truncated to 30k chars"
