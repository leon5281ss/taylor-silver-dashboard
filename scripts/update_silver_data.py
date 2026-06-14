#!/usr/bin/env python3
"""
Update Taylor Silver Dashboard daily price data.

Data source order:
- 00738U: FinMind TaiwanStockPrice, with optional FINMIND_TOKEN env var.
- SLV: Stooq slv.us, then yfinance SLV.
- XAG/USD: Stooq xagusd, then yfinance XAGUSD=X, then SI=F silver futures.

If one source fails, the updater keeps that asset's previous data and writes a
clear sourceStatus. API keys are never written to the front end.
"""

from __future__ import annotations

import io
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import pandas as pd
import requests

try:
    import yfinance as yf
except Exception:  # pragma: no cover - optional fallback
    yf = None

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "docs" / "data" / "silver.json"
REQUEST_TIMEOUT = 30


ASSET_META = {
    "00738U": {
        "symbol": "00738U",
        "name": "元大道瓊白銀ER",
        "typeLabel": "台灣白銀 ETF",
        "currency": "TWD",
    },
    "SLV": {
        "symbol": "SLV",
        "name": "iShares Silver Trust",
        "typeLabel": "美股白銀 ETF",
        "currency": "USD",
    },
    "XAGUSD": {
        "symbol": "XAGUSD",
        "name": "白銀現貨參考",
        "typeLabel": "白銀現貨參考",
        "currency": "USD/oz",
    },
}


def load_current_data() -> dict:
    if DATA_PATH.exists():
        return json.loads(DATA_PATH.read_text(encoding="utf-8"))
    return {"dataStatus": "mock", "assets": {}, "news": []}


def request_text(url: str, params: dict | None = None) -> str:
    response = requests.get(
        url,
        params=params,
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": "taylor-silver-dashboard/2.0"},
    )
    response.raise_for_status()
    return response.text


def fetch_00738u_finmind() -> tuple[pd.DataFrame, str, bool]:
    start_date = (datetime.now(timezone.utc).date() - timedelta(days=520)).isoformat()
    params = {
        "dataset": "TaiwanStockPrice",
        "data_id": "00738U",
        "start_date": start_date,
    }
    token = os.getenv("FINMIND_TOKEN")
    if token:
        params["token"] = token
    payload = json.loads(request_text("https://api.finmindtrade.com/api/v4/data", params=params))
    rows = payload.get("data") or []
    if not rows:
        raise RuntimeError(payload.get("msg") or "FinMind returned no 00738U rows")
    frame = pd.DataFrame(rows)
    frame = frame.rename(
        columns={
            "date": "date",
            "Trading_Volume": "volume",
            "open": "open",
            "max": "high",
            "min": "low",
            "close": "close",
        }
    )
    return frame[["date", "open", "high", "low", "close", "volume"]], "FinMind TaiwanStockPrice 00738U", True


def fetch_stooq(symbol: str) -> pd.DataFrame:
    text = request_text("https://stooq.com/q/d/l/", params={"s": symbol, "i": "d"})
    frame = pd.read_csv(io.StringIO(text))
    if frame.empty or "Date" not in frame.columns:
        raise RuntimeError(f"Stooq returned no rows for {symbol}")
    frame = frame.rename(
        columns={
            "Date": "date",
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        }
    )
    return frame[["date", "open", "high", "low", "close", "volume"]]


def fetch_yfinance(symbol: str) -> pd.DataFrame:
    if yf is None:
        raise RuntimeError("yfinance is not installed")
    frame = yf.download(symbol, period="2y", interval="1d", progress=False, auto_adjust=False)
    if frame.empty:
        raise RuntimeError(f"yfinance returned no rows for {symbol}")
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = frame.columns.get_level_values(0)
    frame = frame.reset_index()
    frame = frame.rename(
        columns={
            "Date": "date",
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        }
    )
    return frame[["date", "open", "high", "low", "close", "volume"]]


def fetch_slv() -> tuple[pd.DataFrame, str, bool]:
    try:
        return fetch_stooq("slv.us"), "Stooq slv.us", True
    except Exception as stooq_error:
        frame = fetch_yfinance("SLV")
        return frame, f"yfinance SLV; Stooq failed: {stooq_error}", True


def fetch_xagusd() -> tuple[pd.DataFrame, str, bool]:
    for symbol in ("xagusd", "xagusd.pl"):
        try:
            return fetch_stooq(symbol), f"Stooq {symbol}", True
        except Exception:
            pass
    for symbol, label in (
        ("XAGUSD=X", "yfinance XAGUSD=X"),
        ("SI=F", "yfinance SI=F；使用白銀期貨 SI=F 作為參考"),
    ):
        try:
            return fetch_yfinance(symbol), label, True
        except Exception:
            pass
    raise RuntimeError("No XAG/USD or silver futures source returned rows")


def calculate_indicators(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame["date"] = pd.to_datetime(frame["date"]).dt.strftime("%Y-%m-%d")
    for column in ("open", "high", "low", "close", "volume"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.dropna(subset=["open", "high", "low", "close"]).sort_values("date")
    frame["volume"] = frame["volume"].fillna(0)

    low_min = frame["low"].rolling(window=9, min_periods=1).min()
    high_max = frame["high"].rolling(window=9, min_periods=1).max()
    rsv = ((frame["close"] - low_min) / (high_max - low_min).replace(0, pd.NA) * 100).fillna(50)
    k_values: list[float] = []
    d_values: list[float] = []
    prev_k = 50.0
    prev_d = 50.0
    for value in rsv:
        current_k = (prev_k * 2 + float(value)) / 3
        current_d = (prev_d * 2 + current_k) / 3
        k_values.append(current_k)
        d_values.append(current_d)
        prev_k = current_k
        prev_d = current_d
    frame["k"] = k_values
    frame["d"] = d_values
    frame["j"] = 3 * frame["k"] - 2 * frame["d"]

    ema_fast = frame["close"].ewm(span=12, adjust=False).mean()
    ema_slow = frame["close"].ewm(span=26, adjust=False).mean()
    frame["macd"] = ema_fast - ema_slow
    frame["macdSignal"] = frame["macd"].ewm(span=9, adjust=False).mean()
    frame["macdHistogram"] = frame["macd"] - frame["macdSignal"]
    frame["volumeRatio5"] = frame["volume"] / frame["volume"].rolling(window=5, min_periods=1).mean()
    frame["volumeRatio20"] = frame["volume"] / frame["volume"].rolling(window=20, min_periods=1).mean()
    frame["changePercent"] = frame["close"].pct_change() * 100
    return frame.tail(250)


def clean_number(value: object, digits: int = 4) -> float | None:
    if pd.isna(value):
        return None
    return round(float(value), digits)


def rows_to_records(frame: pd.DataFrame) -> list[dict]:
    output = []
    for row in frame.to_dict(orient="records"):
        output.append(
            {
                "date": row["date"],
                "open": clean_number(row["open"]),
                "high": clean_number(row["high"]),
                "low": clean_number(row["low"]),
                "close": clean_number(row["close"]),
                "volume": int(row["volume"] or 0),
                "k": clean_number(row["k"]),
                "d": clean_number(row["d"]),
                "j": clean_number(row["j"]),
                "macd": clean_number(row["macd"], 6),
                "macdSignal": clean_number(row["macdSignal"], 6),
                "macdHistogram": clean_number(row["macdHistogram"], 6),
                "volumeRatio5": clean_number(row["volumeRatio5"]),
                "volumeRatio20": clean_number(row["volumeRatio20"]),
                "changePercent": clean_number(row["changePercent"]),
            }
        )
    return output


def build_asset(symbol: str, fetcher: Callable[[], tuple[pd.DataFrame, str, bool]]) -> dict:
    frame, source_label, data_delay = fetcher()
    calculated = calculate_indicators(frame)
    rows = rows_to_records(calculated)
    if len(rows) < 30:
        raise RuntimeError(f"{symbol} has only {len(rows)} rows after update")
    latest = rows[-1]
    return {
        **ASSET_META[symbol],
        "sourceStatus": "success",
        "sourceLabel": source_label,
        "source": source_label,
        "dataDelay": data_delay,
        "lastCloseDate": latest["date"],
        "latestClose": latest["close"],
        "changePercent": latest["changePercent"],
        "recentMacdHistogram": [row["macdHistogram"] for row in rows[-3:]],
        "prices": rows,
    }


def keep_previous_asset(symbol: str, current: dict, error: Exception) -> dict:
    previous = (current.get("assets") or {}).get(symbol, {})
    prices = previous.get("prices") or []
    latest = prices[-1] if prices else {}
    return {
        **ASSET_META[symbol],
        **previous,
        "sourceStatus": f"failed; kept previous data: {error}",
        "sourceLabel": previous.get("sourceLabel") or previous.get("source") or "previous data",
        "source": previous.get("source") or "previous data",
        "dataDelay": True,
        "lastCloseDate": previous.get("lastCloseDate") or latest.get("date"),
        "latestClose": previous.get("latestClose") or latest.get("close"),
        "changePercent": previous.get("changePercent") or latest.get("changePercent"),
        "recentMacdHistogram": previous.get("recentMacdHistogram")
        or [row.get("macdHistogram") for row in prices[-3:]],
        "prices": prices,
    }


def main() -> None:
    current = load_current_data()
    fetchers = {
        "00738U": fetch_00738u_finmind,
        "SLV": fetch_slv,
        "XAGUSD": fetch_xagusd,
    }
    assets = {}
    success_count = 0
    for symbol, fetcher in fetchers.items():
        try:
            assets[symbol] = build_asset(symbol, fetcher)
            success_count += 1
            print(f"{symbol}: updated from {assets[symbol]['sourceLabel']}")
        except Exception as error:
            assets[symbol] = keep_previous_asset(symbol, current, error)
            print(f"{symbol}: failed, kept previous data: {error}")

    if success_count == len(fetchers):
        data_status = "live"
    elif success_count > 0:
        data_status = "partial"
    else:
        data_status = "mock"

    output = {
        **current,
        "updatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "dataStatus": data_status,
        "sourceStatus": {symbol: asset.get("sourceStatus") for symbol, asset in assets.items()},
        "sourceLabel": {symbol: asset.get("sourceLabel") for symbol, asset in assets.items()},
        "dataDelay": {symbol: asset.get("dataDelay", True) for symbol, asset in assets.items()},
        "lastCloseDate": {symbol: asset.get("lastCloseDate") for symbol, asset in assets.items()},
        "assets": assets,
    }
    DATA_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"dataStatus={data_status}; wrote {DATA_PATH}")


if __name__ == "__main__":
    main()
