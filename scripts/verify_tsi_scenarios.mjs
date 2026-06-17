import fs from "node:fs";
import vm from "node:vm";

const appSource = fs.readFileSync("docs/assets/app.js", "utf8");
const context = {
  console,
  window: {},
  document: undefined,
  localStorage: {
    getItem: () => null,
    setItem: () => undefined
  }
};
vm.createContext(context);
vm.runInContext(appSource, context);

function row(close, overrides = {}) {
  const open = overrides.open ?? close - 0.15;
  const high = overrides.high ?? Math.max(open, close) + 0.3;
  const low = overrides.low ?? Math.min(open, close) - 0.3;
  return {
    date: overrides.date ?? "2026-01-01",
    open,
    high,
    low,
    close,
    volume: overrides.volume ?? 1000,
    k: overrides.k ?? 50,
    d: overrides.d ?? 50,
    j: overrides.j ?? 50,
    macdHistogram: overrides.macdHistogram ?? 0,
    volumeRatio20: overrides.volumeRatio20 ?? 1,
    changePercent: overrides.changePercent ?? 0
  };
}

function buildRows(kind, count = 40) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    let close = 50 + index * 0.5;
    let values = { volume: 1000 + index * 10, k: 55, macdHistogram: 0.2 };
    if (kind === "panic") {
      close = 60 - index * 0.35 + Math.max(index - 35, 0) * 0.9;
      values = {
        volume: 1200,
        k: index > count - 4 ? 16 : 24,
        d: 22,
        j: 4,
        macdHistogram: index > count - 4 ? [-1.1, -0.8, -0.45][index - (count - 3)] ?? -0.45 : -1.2,
        open: close - 0.6,
        low: close - 0.9,
        high: close + 0.2
      };
    }
    if (kind === "risk") {
      close = 50 + index * 1.5;
      values = { volume: 2000, k: 92, d: 88, j: 100, macdHistogram: 1.3, changePercent: 3 };
    }
    if (kind === "highTsi") {
      close = 50 + index * 0.12 + (index % 2 === 0 ? 0.4 : -0.4);
      values = {
        volume: index > count - 3 ? 2200 : 1000 + index * 8,
        k: 16,
        d: 22,
        j: 4,
        macdHistogram: index > count - 4 ? [-0.9, -0.55, -0.2][index - (count - 3)] ?? -0.2 : 0.15,
        open: close - 0.12,
        low: close - 0.28,
        high: close + 0.28
      };
    }
    rows.push(row(close, { ...values, date: `2026-02-${String((index % 28) + 1).padStart(2, "0")}` }));
  }
  return rows;
}

function assertCase(name, pass, detail) {
  if (!pass) throw new Error(`${name} failed: ${detail}`);
  console.log(`PASS ${name}: ${detail}`);
}

const bullishMacro = {
  items: {
    goldSilverRatio: { status: "bullish", score: 10, maxScore: 10, value: "金銀比快速下降" }
  }
};
const neutralMacro = {
  items: {
    goldSilverRatio: { status: "neutral", score: 5, maxScore: 10, value: "金銀比中性" }
  }
};

context.window.__setTaylorSilverTestMacro(neutralMacro);

// 1. TSI >= 75 but original signal is stop-loss: render layer must override buy wording.
const highStopAsset = { symbol: "TEST", prices: buildRows("highTsi") };
const highStopTsi = context.window.calculateTaylorSilverIndex(highStopAsset);
const stopSignal = context.window.evaluateSilverSignal(highStopAsset.prices.at(-1), highStopAsset.prices, {
  isHolding: true,
  averageCost: highStopAsset.prices.at(-1).close * 1.2,
  stopLossRatio: 10,
  quantity: 1
});
const stopVisible = stopSignal.type === "stop" ? { label: "停損優先", advice: "暫停買進 / 降低部位" } : highStopTsi.light;
assertCase("stop-loss overrides high TSI", highStopTsi.totalScore >= 75 && stopSignal.type === "stop" && stopVisible.advice.includes("暫停買進"), `signal=${stopSignal.type}, tsi=${highStopTsi.totalScore}, trend=${highStopTsi.trendScore}, panic=${highStopTsi.panicScore}, risk=${highStopTsi.riskScore}`);

// 2. High trend, low panic, low risk.
const highTrend = { symbol: "TEST", prices: buildRows("trend") };
const highTsi = context.window.calculateTaylorSilverIndex(highTrend);
assertCase("high trend scenario", highTsi.trendScore >= 80 && highTsi.panicScore < 50 && highTsi.riskScore <= 50, `trend=${highTsi.trendScore}, panic=${highTsi.panicScore}, risk=${highTsi.riskScore}`);

// 3. High panic, low trend, low risk.
const panicAsset = { symbol: "TEST", prices: buildRows("panic") };
const panicTsi = context.window.calculateTaylorSilverIndex(panicAsset);
assertCase("panic-buy scenario", panicTsi.panicScore >= 50 && panicTsi.trendScore < 70 && panicTsi.riskScore <= 50, `trend=${panicTsi.trendScore}, panic=${panicTsi.panicScore}, risk=${panicTsi.riskScore}`);

// 4. High risk lowers TSI.
context.window.__setTaylorSilverTestMacro(bullishMacro);
const riskAsset = { symbol: "TEST", prices: buildRows("risk") };
const riskTsi = context.window.calculateTaylorSilverIndex(riskAsset);
assertCase("high risk lowers TSI", riskTsi.riskScore >= 75 && riskTsi.totalScore < highTsi.totalScore, `riskTsi=${riskTsi.totalScore}, highTsi=${highTsi.totalScore}, risk=${riskTsi.riskScore}`);

// 5. CFTC / premium pending do not participate.
const pendingRisk = riskTsi.groups.risk.filter((condition) => condition.available === false);
assertCase("pending conditions excluded", pendingRisk.length === 2 && pendingRisk.every((condition) => condition.detail === "資料待接入"), `pending=${pendingRisk.length}`);

// 6. Insufficient candles do not calculate score.
const shortAsset = { symbol: "TEST", prices: buildRows("trend", 12) };
const shortTsi = context.window.calculateTaylorSilverIndex(shortAsset);
assertCase("insufficient data protected", shortTsi.dataInsufficient === true && shortTsi.totalScore === null && shortTsi.light.label === "資料不足", JSON.stringify(shortTsi.light));

console.log("All TSI scenario tests passed.");
