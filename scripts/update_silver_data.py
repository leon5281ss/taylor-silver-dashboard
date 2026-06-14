#!/usr/bin/env python3
"""
Manual data updater scaffold for Taylor Silver Dashboard.

This MVP keeps mock data usable without API keys. Add real adapters below and
write the normalized output to docs/data/silver.json.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "docs" / "data" / "silver.json"


def load_current_data() -> dict:
    with DATA_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def fetch_00738u_from_finmind_or_fugle() -> None:
    """Adapter placeholder. Read API keys from environment variables only."""
    return None


def fetch_slv_from_free_source() -> None:
    """Adapter placeholder for Alpha Vantage, Stooq, or Yahoo Finance backup."""
    return None


def fetch_xagusd_from_free_source() -> None:
    """Adapter placeholder for free metals or FX data."""
    return None


def main() -> None:
    data = load_current_data()
    data["updatedAt"] = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    data["dataStatus"] = "mock"
    DATA_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated mock timestamp: {DATA_PATH}")


if __name__ == "__main__":
    main()
