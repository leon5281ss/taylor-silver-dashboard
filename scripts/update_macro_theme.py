#!/usr/bin/env python3
"""
Update macro and theme score for Taylor Silver Dashboard.

The score is a confidence/reference layer only. It never changes the technical
KD/MACD signal and never overrides discipline stop-loss rules.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

try:
    import yfinance as yf
except Exception:  # pragma: no cover
    yf = None

ROOT = Path(__file__).resolve().parents[1]
SILVER_DATA_PATH = ROOT / "docs" / "data" / "silver.json"
MACRO_DATA_PATH = ROOT / "docs" / "data" / "macro_theme.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def download_close(symbol: str, period: str = "6mo") -> pd.Series:
    if yf is None:
        raise RuntimeError("yfinance is not installed")
    frame = yf.download(symbol, period=period, interval="1d", progress=False, auto_adjust=False)
    if frame.empty:
        raise RuntimeError(f"yfinance returned no rows for {symbol}")
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = frame.columns.get_level_values(0)
    close = pd.to_numeric(frame["Close"], errors="coerce").dropna()
    if len(close) < 25:
        raise RuntimeError(f"{symbol} close series has only {len(close)} rows")
    return close


def trend_from_series(close: pd.Series) -> str:
    ma5 = close.tail(5).mean()
    ma20 = close.tail(20).mean()
    last = close.iloc[-1]
    distance = abs(ma5 - ma20) / max(abs(ma20), 1)
    if distance < 0.003:
        return "flat"
    if ma5 < ma20 and last <= ma5:
        return "down"
    if ma5 > ma20 and last >= ma5:
        return "up"
    return "flat"


def score_label(score: int) -> tuple[str, str]:
    if score >= 80:
        return "強多環境", "美元與利率條件有利，白銀題材與資金面同步轉強。"
    if score >= 65:
        return "偏多環境", "白銀大環境偏正面，但仍需技術面確認。"
    if score >= 45:
        return "中性觀望", "多空條件混雜，不適合追高。"
    if score >= 30:
        return "偏空環境", "美元、利率或資金面不利，綠燈也應降低部位。"
    return "高風險環境", "宏觀與資金面明顯不利，除非技術訊號極佳，否則以觀望為主。"


def item(score: int, max_score: int, name: str, label: str, value: str, status: str, source: str) -> dict:
    return {
        "score": score,
        "maxScore": max_score,
        "name": name,
        "label": label,
        "value": value,
        "status": status,
        "source": source,
    }


def neutral_item(max_score: int, neutral_score: int, name: str, label: str, source: str = "manual fallback") -> dict:
    return item(neutral_score, max_score, name, label, "資料不足，暫以中性處理", "neutral", source)


def calculate_dxy(source_status: dict) -> dict:
    for symbol in ("DX-Y.NYB", "DX=F", "UUP"):
        try:
            close = download_close(symbol)
            trend = trend_from_series(close)
            if trend == "down":
                return item(15, 15, "美元指數 DXY", "美元轉弱", "DXY 5日與20日趨勢下降", "bullish", f"yfinance {symbol}")
            if trend == "flat":
                return item(7, 15, "美元指數 DXY", "美元橫盤", "DXY 5日與20日趨勢接近", "neutral", f"yfinance {symbol}")
            return item(0, 15, "美元指數 DXY", "美元轉強", "DXY 5日與20日趨勢上升", "bearish", f"yfinance {symbol}")
        except Exception as error:
            source_status[f"dxy:{symbol}"] = str(error)
    return neutral_item(15, 7, "美元指數 DXY", "美元中性")


def calculate_gold_silver_ratio(source_status: dict) -> dict:
    try:
        gold = download_close("GC=F")
        silver = download_close("SI=F")
        count = min(len(gold), len(silver))
        ratio = (gold.tail(count).reset_index(drop=True) / silver.tail(count).reset_index(drop=True)).dropna()
        trend = trend_from_series(ratio)
        latest = ratio.iloc[-1]
        if trend == "down":
            return item(10, 10, "金銀比", "白銀相對黃金轉強", f"金銀比下降，最新約 {latest:.2f}", "bullish", "yfinance GC=F / SI=F")
        if trend == "flat":
            return item(5, 10, "金銀比", "金銀比橫盤", f"金銀比橫盤，最新約 {latest:.2f}", "neutral", "yfinance GC=F / SI=F")
        return item(0, 10, "金銀比", "白銀相對黃金轉弱", f"金銀比上升，最新約 {latest:.2f}", "bearish", "yfinance GC=F / SI=F")
    except Exception as error:
        source_status["goldSilverRatio"] = str(error)
        return neutral_item(10, 5, "金銀比", "金銀比中性")


def main() -> None:
    load_json(SILVER_DATA_PATH)
    source_status: dict[str, str] = {}
    items = {
        "dxy": calculate_dxy(source_status),
        "realYield": neutral_item(15, 7, "美國10年實質利率", "實質利率中性"),
        "fedExpectation": neutral_item(10, 5, "Fed降息預期", "降息預期中性"),
        "etfFlow": neutral_item(15, 7, "SLV / 白銀ETF資金流", "ETF資金平穩"),
        "openInterest": neutral_item(10, 5, "白銀期貨未平倉量", "期貨未平倉量中性"),
        "cftcPosition": neutral_item(10, 5, "CFTC投機淨部位", "投機部位中性"),
        "goldSilverRatio": calculate_gold_silver_ratio(source_status),
        "themeHeat": neutral_item(15, 7, "白銀供需 / 題材熱度", "題材中性，需人工確認"),
    }
    score = int(sum(value["score"] for value in items.values()))
    label, description = score_label(score)
    data_status = "partial"
    output = {
        "updatedAt": now_iso(),
        "dataStatus": data_status,
        "macroThemeScore": score,
        "macroThemeLabel": label,
        "macroThemeDescription": description,
        "items": items,
        "sourceStatus": source_status
        | {"manualFallback": "realYield、fedExpectation、etfFlow、openInterest、cftcPosition、themeHeat 第一版暫以中性或需人工確認處理"},
        "summary": f"{label}：{description} 宏觀與題材分數只作為信心加權與部位大小參考，仍需搭配 KD / MACD 技術燈號確認。",
    }
    MACRO_DATA_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"macroThemeScore={score}; macroThemeLabel={label}; wrote {MACRO_DATA_PATH}")


if __name__ == "__main__":
    main()
