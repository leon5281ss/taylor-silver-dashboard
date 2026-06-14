const STORAGE_KEY = "taylorSilverSettings.v2";
const DATA_URL = "./data/silver.json";
const SYMBOLS = ["00738U", "SLV", "XAGUSD"];

const fallbackData = {
  updatedAt: new Date().toISOString(),
  dataStatus: "mock",
  sourceStatus: {},
  sourceLabel: {},
  dataDelay: {},
  lastCloseDate: {},
  assets: {}
};

const defaultSettings = {
  symbol: "00738U",
  isHolding: false,
  averageCost: 0,
  quantity: 0,
  plannedCapital: 300000,
  buyTranches: 3,
  stopLossRatio: 10
};

let appState = {
  data: fallbackData,
  selectedSymbol: "00738U",
  expandedSymbol: "00738U",
  tvExpanded: false,
  settings: loadSettings()
};

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function calculateKDJ(rows, period = 9, kSmoothing = 3, dSmoothing = 3) {
  let prevK = 50;
  let prevD = 50;
  return rows.map((row, index) => {
    const start = Math.max(0, index - period + 1);
    const window = rows.slice(start, index + 1);
    const low = Math.min(...window.map((item) => Number(item.low)));
    const high = Math.max(...window.map((item) => Number(item.high)));
    const rsv = high === low ? 50 : ((Number(row.close) - low) / (high - low)) * 100;
    const k = (prevK * (kSmoothing - 1) + rsv) / kSmoothing;
    const d = (prevD * (dSmoothing - 1) + k) / dSmoothing;
    const j = 3 * k - 2 * d;
    prevK = k;
    prevD = d;
    return { ...row, k, d, j };
  });
}

function ema(values, period) {
  const multiplier = 2 / (period + 1);
  const output = [];
  values.forEach((value, index) => {
    output.push(index === 0 ? value : value * multiplier + output[index - 1] * (1 - multiplier));
  });
  return output;
}

function calculateMACD(rows, fast = 12, slow = 26, signal = 9) {
  const closes = rows.map((row) => Number(row.close));
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = closes.map((_, index) => fastEma[index] - slowEma[index]);
  const signalLine = ema(macdLine, signal);
  return rows.map((row, index) => ({
    ...row,
    macd: macdLine[index],
    macdSignal: signalLine[index],
    macdHistogram: macdLine[index] - signalLine[index]
  }));
}

function detectMacdGreenShrinking(histograms) {
  if (histograms.length < 3) return false;
  const [hist2, hist1, hist0] = histograms.slice(-3);
  return hist0 < 0 && hist1 < 0 && hist2 < 0 && hist0 > hist1 && hist1 > hist2;
}

function detectMacdRedShrinking(histograms) {
  if (histograms.length < 3) return false;
  const [hist2, hist1, hist0] = histograms.slice(-3);
  return hist0 > 0 && hist1 > 0 && hist2 > 0 && hist0 < hist1 && hist1 < hist2;
}

function calculateVolumeRatio(rows, days) {
  return rows.map((row, index) => {
    const start = Math.max(0, index - days + 1);
    const window = rows.slice(start, index + 1);
    const average = window.reduce((sum, item) => sum + Number(item.volume || 0), 0) / window.length;
    return average > 0 ? Number(row.volume || 0) / average : null;
  });
}

function calculatePositionPnl(price, settings) {
  const averageCost = Number(settings.averageCost || 0);
  const quantity = Number(settings.quantity || 0);
  if (!settings.isHolding || averageCost <= 0 || quantity <= 0 || !Number.isFinite(Number(price))) {
    return { pnlPercent: null, pnlAmount: null };
  }
  return {
    pnlPercent: ((Number(price) - averageCost) / averageCost) * 100,
    pnlAmount: (Number(price) - averageCost) * quantity
  };
}

function evaluateSilverSignal(latest, rows, settings) {
  if (!latest) {
    return {
      type: "none",
      label: "⚪ 無明確訊號",
      message: "資料不足，等待下一根日 K 確認。",
      action: "資料不足，需要人工確認。"
    };
  }

  const histograms = rows.map((row) => Number(row.macdHistogram)).filter(Number.isFinite);
  const stopLossRatio = Number(settings.stopLossRatio || 10) / 100;
  const averageCost = Number(settings.averageCost || 0);

  if (settings.isHolding && averageCost > 0 && Number(latest.close) <= averageCost * (1 - stopLossRatio)) {
    return {
      type: "stop",
      label: "⚠️ 紀律停損",
      message: `帳面虧損已達 ${settings.stopLossRatio || 10}% 停損線，無條件全數出場。`,
      action: "停損條件優先於所有技術指標，需要人工確認後執行。"
    };
  }

  if (Number(latest.k) < 20 && Number(latest.macdHistogram) < 0 && detectMacdGreenShrinking(histograms)) {
    const tranche = Number(settings.buyTranches || 3);
    return {
      type: "ready",
      label: "🟢 準備進場",
      message: "市場短線超賣，MACD 綠柱開始縮短，殺盤力道減弱。可分批買進，不建議一次滿倉。",
      action: settings.isHolding ? `可考慮下一筆 1/${tranche}，最多 ${tranche} 筆。` : `尚未持有，第一筆以 1/${tranche} 為上限。`
    };
  }

  if (Number(latest.k) > 80 && Number(latest.macdHistogram) > 0 && detectMacdRedShrinking(histograms)) {
    return {
      type: "exit",
      label: "🔴 獲利退場",
      message: "市場短線過熱，MACD 紅柱開始縮短，多頭力道減弱。建議分批停利，避免獲利回吐。",
      action: settings.isHolding ? "可分批停利，避免獲利回吐。" : "沒有持倉，不追高。"
    };
  }

  if (Number(latest.k) >= 40 && Number(latest.k) <= 70) {
    return {
      type: "hold",
      label: "🟡 續抱觀望",
      message: "目前沒有明確進出場訊號。若已有持倉可續抱，若尚未持有不建議追高。",
      action: settings.isHolding ? "續抱觀望，等待下一根日 K。" : "尚未持有，不建議追高。"
    };
  }

  return {
    type: "none",
    label: "⚪ 無明確訊號",
    message: "KD 與 MACD 尚未同步，等待下一根日 K 確認。",
    action: "無明確訊號，需要人工確認。"
  };
}

function normalizeRows(rows) {
  let normalized = (rows || []).map((row) => ({
    ...row,
    k: Number.isFinite(Number(row.k ?? row.K)) ? Number(row.k ?? row.K) : undefined,
    d: Number.isFinite(Number(row.d ?? row.D)) ? Number(row.d ?? row.D) : undefined,
    j: Number.isFinite(Number(row.j ?? row.J)) ? Number(row.j ?? row.J) : undefined,
    macd: Number.isFinite(Number(row.macd ?? row.MACD)) ? Number(row.macd ?? row.MACD) : undefined,
    macdSignal: Number.isFinite(Number(row.macdSignal ?? row["MACD Signal"])) ? Number(row.macdSignal ?? row["MACD Signal"]) : undefined,
    macdHistogram: Number.isFinite(Number(row.macdHistogram ?? row["MACD Histogram"])) ? Number(row.macdHistogram ?? row["MACD Histogram"]) : undefined
  }));
  if (normalized.some((row) => !Number.isFinite(row.k))) normalized = calculateKDJ(normalized);
  if (normalized.some((row) => !Number.isFinite(row.macdHistogram))) normalized = calculateMACD(normalized);
  const ratio5 = calculateVolumeRatio(normalized, 5);
  const ratio20 = calculateVolumeRatio(normalized, 20);
  return normalized.map((row, index) => ({
    ...row,
    volumeRatio5: Number.isFinite(Number(row.volumeRatio5)) ? Number(row.volumeRatio5) : ratio5[index],
    volumeRatio20: Number.isFinite(Number(row.volumeRatio20)) ? Number(row.volumeRatio20) : ratio20[index],
    changePercent: Number.isFinite(Number(row.changePercent)) ? Number(row.changePercent) : null
  }));
}

function settingsForSymbol(symbol) {
  return appState.settings.symbol === symbol ? appState.settings : { ...defaultSettings, symbol };
}

function getAsset(symbol) {
  const asset = appState.data.assets?.[symbol] || {};
  const prices = normalizeRows(asset.prices || []);
  return { symbol, ...asset, prices };
}

function getActiveAsset() {
  return getAsset(appState.selectedSymbol);
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "資料不足";
  return Number(value).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return "資料不足";
  const prefix = Number(value) > 0 ? "+" : "";
  return `${prefix}${formatNumber(value, 2)}%`;
}

function dataStatusText(status) {
  return {
    live: "真實資料",
    partial: "部分資料",
    mock: "測試資料"
  }[status] || "資料狀態不明";
}

function volumeNote(latest) {
  if (!latest || !Number.isFinite(Number(latest.volumeRatio20))) return "資料不足";
  if (Number(latest.volumeRatio20) >= 1.5 && Number(latest.k) < 20) return "恐慌量放大";
  if (Number(latest.volumeRatio20) >= 1.5 && Number(latest.k) > 80) return "追價量放大";
  if (Number(latest.volumeRatio20) < 0.8) return "量能不足，訊號可信度下降";
  return "量能中性";
}

function trendClass(value) {
  if (!Number.isFinite(Number(value))) return "";
  return Number(value) >= 0 ? "up" : "down";
}

function getRecentHist(rows) {
  return rows.map((row) => Number(row.macdHistogram)).filter(Number.isFinite).slice(-3);
}

function conditionChecks(latest, rows, settings) {
  const hist = getRecentHist(rows);
  const greenShrinking = detectMacdGreenShrinking(hist);
  const redShrinking = detectMacdRedShrinking(hist);
  const stopLossRatio = Number(settings.stopLossRatio || 10) / 100;
  const averageCost = Number(settings.averageCost || 0);
  const stopTriggered = Boolean(settings.isHolding && averageCost > 0 && latest && Number(latest.close) <= averageCost * (1 - stopLossRatio));
  return [
    ["K < 20", Number(latest?.k) < 20, `K = ${formatNumber(latest?.k)}`],
    ["K > 80", Number(latest?.k) > 80, `K = ${formatNumber(latest?.k)}`],
    ["MACD 為綠柱", Number(latest?.macdHistogram) < 0, `Hist = ${formatNumber(latest?.macdHistogram, 4)}`],
    ["MACD 綠柱縮短", greenShrinking, hist.map((value) => formatNumber(value, 4)).join(" → ") || "資料不足"],
    ["MACD 紅柱縮短", redShrinking, hist.map((value) => formatNumber(value, 4)).join(" → ") || "資料不足"],
    ["成交量放大", Number(latest?.volumeRatio20) > 1.5, `Vol/20D = ${formatNumber(latest?.volumeRatio20, 2)}x`],
    ["停損觸發", stopTriggered, settings.isHolding ? `停損線 ${formatNumber(averageCost * (1 - stopLossRatio))}` : "未設定持倉"]
  ];
}

function statusBadges(latest, rows) {
  const hist = getRecentHist(rows);
  const badges = [];
  if (Number(latest?.k) < 20) badges.push(["超賣", "green"]);
  if (Number(latest?.k) > 80) badges.push(["過熱", "red"]);
  if (detectMacdGreenShrinking(hist)) badges.push(["跌勢減弱", "green"]);
  if (detectMacdRedShrinking(hist)) badges.push(["漲勢減弱", "red"]);
  if (Number(latest?.volumeRatio20) < 0.8) badges.push(["量能不足", "gray"]);
  if (Number(latest?.volumeRatio20) > 1.5) badges.push(["量能放大", "blue"]);
  return badges;
}

function renderSourceStrip() {
  const items = [
    ["資料狀態", dataStatusText(appState.data.dataStatus)],
    ["最後更新", appState.data.updatedAt || "資料不足"],
    ["00738U 收盤", appState.data.lastCloseDate?.["00738U"] || getAsset("00738U").lastCloseDate || "資料不足"],
    ["SLV 收盤", appState.data.lastCloseDate?.SLV || getAsset("SLV").lastCloseDate || "資料不足"],
    ["XAG/USD 收盤", appState.data.lastCloseDate?.XAGUSD || getAsset("XAGUSD").lastCloseDate || "資料不足"]
  ];
  document.getElementById("sourceStrip").innerHTML = items
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function renderComparisonCards() {
  document.getElementById("comparisonGrid").innerHTML = SYMBOLS.map((symbol) => {
    const asset = getAsset(symbol);
    const latest = asset.prices.at(-1);
    const settings = settingsForSymbol(symbol);
    const signal = evaluateSilverSignal(latest, asset.prices, settings);
    const pnl = calculatePositionPnl(latest?.close, settings);
    const expanded = appState.expandedSymbol === symbol;
    const recentHist = (asset.recentMacdHistogram || asset.prices.slice(-3).map((row) => row.macdHistogram)).map((value) => formatNumber(value, 4)).join(" → ");
    const sourceStatus = asset.sourceStatus || appState.data.sourceStatus?.[symbol] || "資料狀態不明";
    const sourceLabel = asset.sourceLabel || appState.data.sourceLabel?.[symbol] || asset.source || "資料來源不明";
    const checks = conditionChecks(latest, asset.prices, settings);
    return `
      <article class="compare-card ${signal.type} ${expanded ? "expanded" : ""}" data-symbol="${symbol}">
        <button class="compare-button" type="button" data-symbol="${symbol}" aria-expanded="${expanded}">
          <div>
            <span class="card-kicker">${asset.typeLabel || ""}</span>
            <h2>${symbol === "XAGUSD" ? "XAG/USD" : symbol}</h2>
            <p>${asset.name || ""}</p>
          </div>
          <strong>${signal.label}</strong>
        </button>
        <div class="card-quick">
          <div><span>收盤價</span><strong>${formatNumber(latest?.close)}</strong></div>
          <div><span>漲跌幅</span><strong class="${trendClass(latest?.changePercent)}">${formatPercent(latest?.changePercent)}</strong></div>
          <div><span>K 值</span><strong>${formatNumber(latest?.k)}</strong></div>
          <div><span>MACD</span><strong>${formatNumber(latest?.macdHistogram, 4)}</strong></div>
          <div><span>Vol / 20D</span><strong>${formatNumber(latest?.volumeRatio20, 2)}x</strong></div>
          <div><span>量能</span><strong>${volumeNote(latest)}</strong></div>
        </div>
        <p class="card-action">${signal.action}</p>
        <div class="card-expanded">
          <div class="mini-checklist">
            ${checks.map(([label, passed, detail]) => `<div class="${passed ? "pass" : "fail"}"><strong>${passed ? "是" : "否"}</strong><span>${label}</span><em>${detail}</em></div>`).join("")}
          </div>
          <canvas class="mini-chart" id="mini-${symbol}" height="68"></canvas>
          <dl>
            <div><dt>最後收盤日期</dt><dd>${asset.lastCloseDate || latest?.date || "資料不足"}</dd></div>
            <div><dt>D / J</dt><dd>${formatNumber(latest?.d)} / ${formatNumber(latest?.j)}</dd></div>
            <div><dt>最近三日 MACD</dt><dd>${recentHist || "資料不足"}</dd></div>
            <div><dt>volumeRatio20</dt><dd>${formatNumber(latest?.volumeRatio20, 2)}x，${volumeNote(latest)}</dd></div>
            <div><dt>停損資訊</dt><dd>${settings.isHolding ? `平均成本 ${formatNumber(settings.averageCost)}，帳面損益 ${formatPercent(pnl.pnlPercent)}` : "此標的未設定持倉"}</dd></div>
            <div><dt>資料狀態</dt><dd>${dataStatusText(appState.data.dataStatus)}；${sourceLabel}</dd></div>
            <div><dt>來源狀態</dt><dd>${sourceStatus}</dd></div>
            <div><dt>新聞摘要</dt><dd>${(appState.data.news || []).slice(0, 2).map((item) => item.title).join(" / ") || "暫無新聞"}</dd></div>
            <div><dt>圖表</dt><dd><button class="inline-tv-button" type="button" data-tv-symbol="${symbol}">展開 TradingView 參考圖</button></dd></div>
          </dl>
        </div>
      </article>
    `;
  }).join("");
  drawMiniCharts();
}

function renderMetrics(asset, latest, signal, pnl) {
  const cards = [
    ["收盤價", formatNumber(latest?.close), `${asset.currency || ""} / ${latest?.date || ""}`],
    ["漲跌幅", formatPercent(latest?.changePercent), "紅漲綠跌"],
    ["K / D / J", `${formatNumber(latest?.k)} / ${formatNumber(latest?.d)} / ${formatNumber(latest?.j)}`, "K < 20 超賣，K > 80 過熱"],
    ["MACD histogram", formatNumber(latest?.macdHistogram, 4), "histogram = macdLine - signalLine"],
    ["MACD 最近三日", asset.prices.slice(-3).map((row) => formatNumber(row.macdHistogram, 4)).join(" → "), "柱狀圖方向"],
    ["成交量 / 20 日均量", `${formatNumber(latest?.volumeRatio20, 2)}x`, volumeNote(latest)],
    ["建議動作", signal.action, "需人工確認"],
    ["資料狀態", dataStatusText(appState.data.dataStatus), `${asset.sourceLabel || asset.source || "資料來源不明"}；${asset.dataDelay ? "資料延遲" : "即時或近即時"}`]
  ];
  document.getElementById("metricsGrid").innerHTML = cards
    .map(([label, value, note]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><p>${note || "&nbsp;"}</p></article>`)
    .join("");
}

function renderConditionChecklist(asset, latest) {
  const checks = conditionChecks(latest, asset.prices, appState.settings);
  document.getElementById("conditionChecklist").innerHTML = checks
    .map(([label, passed, detail]) => `
      <div class="condition-row ${passed ? "pass" : "fail"}">
        <strong>${passed ? "是" : "否"}</strong>
        <span>${label}</span>
        <em>${detail}</em>
      </div>
    `)
    .join("");
}

function renderChartValueRow(asset, latest) {
  const badges = statusBadges(latest, asset.prices);
  const values = [
    ["Close", formatNumber(latest?.close)],
    ["Change", formatPercent(latest?.changePercent)],
    ["K", formatNumber(latest?.k)],
    ["D", formatNumber(latest?.d)],
    ["J", formatNumber(latest?.j)],
    ["MACD Hist", formatNumber(latest?.macdHistogram, 4)],
    ["Vol / 20D", `${formatNumber(latest?.volumeRatio20, 2)}x`]
  ];
  document.getElementById("chartValueRow").innerHTML = `
    <div class="chart-values">${values.map(([label, value]) => `<span><b>${label}</b>${value}</span>`).join("")}</div>
    <div class="status-badges">${badges.map(([label, type]) => `<span class="${type}">${label}</span>`).join("") || "<span class=\"gray\">無特殊狀態</span>"}</div>
  `;
}

function resizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  let height = Number(canvas.getAttribute("height"));
  if (window.innerWidth <= 720) {
    if (canvas.id === "priceCanvas") height = 160;
    if (canvas.id === "indicatorCanvas") height = 140;
  }
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  return { ctx, width, height };
}

function drawPriceChart(asset) {
  const canvas = document.getElementById("priceCanvas");
  const { ctx, width, height } = resizeCanvas(canvas);
  const rows = asset.prices.slice(-60);
  ctx.clearRect(0, 0, width, height);
  if (!rows.length) return;
  const pad = 30;
  const max = Math.max(...rows.map((row) => Number(row.high)));
  const min = Math.min(...rows.map((row) => Number(row.low)));
  const xStep = (width - pad * 2 - 48) / Math.max(rows.length - 1, 1);
  const y = (value) => height - pad - ((Number(value) - min) / (max - min || 1)) * (height - pad * 2);
  const latest = rows.at(-1);
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = pad + index * xStep;
    index === 0 ? ctx.moveTo(x, y(row.close)) : ctx.lineTo(x, y(row.close));
  });
  ctx.stroke();
  rows.forEach((row, index) => {
    const x = pad + index * xStep;
    const up = Number(row.close) >= Number(row.open);
    ctx.strokeStyle = up ? "#c63838" : "#168a4a";
    ctx.fillStyle = up ? "#c63838" : "#168a4a";
    ctx.beginPath();
    ctx.moveTo(x, y(row.low));
    ctx.lineTo(x, y(row.high));
    ctx.stroke();
    ctx.fillRect(x - 3, Math.min(y(row.open), y(row.close)), 6, Math.max(2, Math.abs(y(row.open) - y(row.close))));
  });
  const latestY = y(latest.close);
  ctx.strokeStyle = "#20242c";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad, latestY);
  ctx.lineTo(width - pad, latestY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#20242c";
  ctx.fillRect(width - pad - 44, latestY - 11, 44, 22);
  ctx.fillStyle = "#ffffff";
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillText(formatNumber(latest.close), width - pad - 40, latestY + 4);
  ctx.fillStyle = "#667085";
  ctx.font = "12px sans-serif";
  ctx.fillText(`High ${formatNumber(max)}  Low ${formatNumber(min)}`, pad, 16);
}

function drawIndicatorChart(asset) {
  const canvas = document.getElementById("indicatorCanvas");
  const { ctx, width, height } = resizeCanvas(canvas);
  const rows = asset.prices.slice(-60);
  ctx.clearRect(0, 0, width, height);
  if (!rows.length) return;
  const pad = 28;
  const xStep = (width - pad * 2) / Math.max(rows.length - 1, 1);
  const kdY = (value) => pad + (100 - Number(value)) / 100 * (height * 0.45);
  const histValues = rows.map((row) => Number(row.macdHistogram));
  const histMax = Math.max(...histValues.map((value) => Math.abs(value)), 1);
  const histBase = height - 44;
  const latest = rows.at(-1);
  const histArrow = getRecentHist(rows).map((value) => formatNumber(value, 4)).join(" → ");

  ctx.strokeStyle = "#d9dee8";
  ctx.beginPath();
  ctx.moveTo(pad, kdY(80));
  ctx.lineTo(width - pad, kdY(80));
  ctx.moveTo(pad, kdY(20));
  ctx.lineTo(width - pad, kdY(20));
  ctx.stroke();
  ctx.fillStyle = "#667085";
  ctx.font = "11px sans-serif";
  ctx.fillText("80 過熱", pad + 4, kdY(80) - 4);
  ctx.fillText("20 超賣", pad + 4, kdY(20) - 4);

  [["#2563eb", "k"], ["#b7791f", "d"], ["#667085", "j"]].forEach(([color, key]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    rows.forEach((row, index) => {
      const x = pad + index * xStep;
      index === 0 ? ctx.moveTo(x, kdY(row[key])) : ctx.lineTo(x, kdY(row[key]));
    });
    ctx.stroke();
  });

  rows.forEach((row, index) => {
    const x = pad + index * xStep;
    const barHeight = (Number(row.macdHistogram) / histMax) * 44;
    ctx.fillStyle = Number(row.macdHistogram) >= 0 ? "#c63838" : "#168a4a";
    ctx.fillRect(x - 4, histBase - Math.max(barHeight, 0), 8, Math.abs(barHeight));
  });
  ctx.fillStyle = "#667085";
  ctx.font = "12px sans-serif";
  ctx.fillText("K", pad, 16);
  ctx.fillStyle = "#b7791f";
  ctx.fillText("D", pad + 24, 16);
  ctx.fillStyle = "#667085";
  ctx.fillText("J", pad + 48, 16);
  ctx.fillStyle = "#20242c";
  ctx.textAlign = "right";
  ctx.fillText(`K ${formatNumber(latest.k)} / D ${formatNumber(latest.d)} / J ${formatNumber(latest.j)}`, width - pad, 16);
  ctx.fillText(`Hist ${formatNumber(latest.macdHistogram, 4)}`, width - pad, histBase - 52);
  ctx.fillText(histArrow, width - pad, histBase + 18);
  ctx.textAlign = "left";
}

function drawMiniCharts() {
  SYMBOLS.forEach((symbol) => {
    const canvas = document.getElementById(`mini-${symbol}`);
    if (!canvas) return;
    const asset = getAsset(symbol);
    const rows = asset.prices.slice(-30);
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = 68;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);
    if (!rows.length) return;
    const max = Math.max(...rows.map((row) => Number(row.close)));
    const min = Math.min(...rows.map((row) => Number(row.close)));
    const xStep = width / Math.max(rows.length - 1, 1);
    const y = (value) => height - 8 - ((Number(value) - min) / (max - min || 1)) * (height - 16);
    const up = Number(rows.at(-1).close) >= Number(rows[0].close);
    ctx.strokeStyle = up ? "#c63838" : "#168a4a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    rows.forEach((row, index) => {
      const x = index * xStep;
      index === 0 ? ctx.moveTo(x, y(row.close)) : ctx.lineTo(x, y(row.close));
    });
    ctx.stroke();
  });
}

function renderNews(news) {
  const now = new Date();
  const items = (news || []).map((item) => ({ ...item, timeValue: new Date(item.time) }));
  document.getElementById("news24h").textContent = items.filter((item) => now - item.timeValue <= 24 * 60 * 60 * 1000).length;
  document.getElementById("news7d").textContent = items.filter((item) => now - item.timeValue <= 7 * 24 * 60 * 60 * 1000).length;
  document.getElementById("newsList").innerHTML = items.slice(0, 5).map((item) => `
    <article class="news-item">
      <strong>${item.title}</strong>
      <div class="news-meta">
        <span>${item.source}</span>
        <span>${String(item.time).replace("T", " ").slice(0, 16)}</span>
        <span class="sentiment">${item.sentiment}</span>
      </div>
    </article>
  `).join("");
}

function renderTradingView(symbol) {
  const map = {
    "00738U": "TWSE:00738U",
    SLV: "AMEX:SLV",
    XAGUSD: "OANDA:XAGUSD"
  };
  const fallback = symbol === "00738U" ? "OANDA:XAGUSD" : map[symbol];
  const container = document.getElementById("tradingview_chart");
  container.innerHTML = "";
  const isMobile = window.innerWidth <= 720;
  if (isMobile && !appState.tvExpanded) {
    container.classList.add("collapsed");
    return;
  }
  container.classList.remove("collapsed");
  const note = document.createElement("p");
  note.className = "chart-note";
  note.textContent = symbol === "00738U" ? "00738U 若無法顯示，請切換白銀現貨 / SLV 作為參考圖；燈號仍由本系統資料計算。" : "TradingView 僅供看盤參考，燈號由本系統資料計算。";
  container.appendChild(note);
  if (!window.TradingView) {
    note.textContent = "TradingView widget 載入中或被瀏覽器阻擋；燈號仍由本系統資料計算。";
    return;
  }
  const widgetBox = document.createElement("div");
  widgetBox.id = "tv_widget_inner";
  widgetBox.style.height = isMobile ? "320px" : "360px";
  container.appendChild(widgetBox);
  new window.TradingView.widget({
    autosize: true,
    symbol: map[symbol] || fallback || "OANDA:XAGUSD",
    interval: "D",
    timezone: "Asia/Taipei",
    theme: "light",
    style: "1",
    locale: "zh_TW",
    enable_publishing: false,
    hide_side_toolbar: false,
    allow_symbol_change: true,
    container_id: "tv_widget_inner"
  });
}

function renderDashboard() {
  const asset = getActiveAsset();
  const latest = asset.prices.at(-1);
  const pnl = calculatePositionPnl(latest?.close, appState.settings);
  const signal = evaluateSilverSignal(latest, asset.prices, appState.settings);
  const signalPanel = document.getElementById("signalPanel");
  signalPanel.className = `signal-panel ${signal.type}`;
  document.getElementById("signalTitle").textContent = signal.label;
  document.getElementById("signalMessage").textContent = signal.message;
  document.getElementById("signalNumbers").innerHTML = `
    <span><b>Close</b>${formatNumber(latest?.close)}</span>
    <span class="${trendClass(latest?.changePercent)}"><b>Change</b>${formatPercent(latest?.changePercent)}</span>
    <span><b>K</b>${formatNumber(latest?.k)}</span>
    <span><b>MACD</b>${formatNumber(latest?.macdHistogram, 4)}</span>
  `;
  document.getElementById("currentTarget").textContent = `${asset.symbol === "XAGUSD" ? "XAG/USD" : asset.symbol} ${asset.name || ""}`;
  document.getElementById("updatedAt").textContent = `更新 ${appState.data.updatedAt || latest?.date || "--"}；收盤 ${asset.lastCloseDate || latest?.date || "--"}`;
  document.getElementById("dataDelayBadge").textContent = `${dataStatusText(appState.data.dataStatus)} / ${asset.dataDelay ? "資料延遲" : "即時或近即時"}`;
  renderSourceStrip();
  renderComparisonCards();
  renderMetrics(asset, latest, signal, pnl);
  renderConditionChecklist(asset, latest);
  renderChartValueRow(asset, latest);
  drawPriceChart(asset);
  drawIndicatorChart(asset);
  renderNews(appState.data.news);
  renderTradingView(appState.selectedSymbol);
}

function bindSettingsForm() {
  const form = document.getElementById("settingsForm");
  form.symbol.value = appState.settings.symbol || appState.selectedSymbol;
  form.isHolding.checked = Boolean(appState.settings.isHolding);
  form.averageCost.value = appState.settings.averageCost || "";
  form.quantity.value = appState.settings.quantity || "";
  form.plannedCapital.value = appState.settings.plannedCapital || "";
  form.buyTranches.value = appState.settings.buyTranches || 3;
  form.stopLossRatio.value = appState.settings.stopLossRatio || 10;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    appState.settings = {
      symbol: form.symbol.value,
      isHolding: form.isHolding.checked,
      averageCost: Number(form.averageCost.value || 0),
      quantity: Number(form.quantity.value || 0),
      plannedCapital: Number(form.plannedCapital.value || 0),
      buyTranches: Number(form.buyTranches.value || 3),
      stopLossRatio: Number(form.stopLossRatio.value || 10)
    };
    appState.selectedSymbol = appState.settings.symbol;
    appState.expandedSymbol = appState.settings.symbol;
    saveSettings(appState.settings);
    updateTabs();
    renderDashboard();
  });
}

function updateTabs() {
  document.querySelectorAll(".target-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.symbol === appState.selectedSymbol);
  });
  const form = document.getElementById("settingsForm");
  if (form) form.symbol.value = appState.selectedSymbol;
}

async function init() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    appState.data = await response.json();
  } catch (error) {
    console.warn("Unable to load silver.json; using fallback data.", error);
  }
  appState.selectedSymbol = appState.settings.symbol || "00738U";
  appState.expandedSymbol = appState.selectedSymbol;
  bindSettingsForm();
  document.querySelectorAll(".target-tab").forEach((button) => {
    button.addEventListener("click", () => {
      appState.selectedSymbol = button.dataset.symbol;
      appState.expandedSymbol = appState.selectedSymbol;
      appState.settings.symbol = appState.selectedSymbol;
      saveSettings(appState.settings);
      updateTabs();
      renderDashboard();
    });
  });
  document.getElementById("comparisonGrid").addEventListener("click", (event) => {
    const tvButton = event.target.closest(".inline-tv-button");
    if (tvButton) {
      appState.selectedSymbol = tvButton.dataset.tvSymbol;
      appState.tvExpanded = true;
      updateTabs();
      renderDashboard();
      document.getElementById("tradingview_chart").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const button = event.target.closest(".compare-button");
    if (!button) return;
    appState.selectedSymbol = button.dataset.symbol;
    appState.expandedSymbol = appState.expandedSymbol === button.dataset.symbol ? "" : button.dataset.symbol;
    appState.settings.symbol = appState.selectedSymbol;
    saveSettings(appState.settings);
    updateTabs();
    renderDashboard();
  });
  document.getElementById("tvToggle").addEventListener("click", () => {
    appState.tvExpanded = !appState.tvExpanded;
    document.getElementById("tvToggle").textContent = appState.tvExpanded ? "收合 TradingView 參考圖" : "展開 TradingView 參考圖";
    renderTradingView(appState.selectedSymbol);
  });
  updateTabs();
  renderDashboard();
  window.addEventListener("resize", () => {
    const asset = getActiveAsset();
    drawPriceChart(asset);
    drawIndicatorChart(asset);
  });
}

document.addEventListener("DOMContentLoaded", init);

window.calculateKDJ = calculateKDJ;
window.calculateMACD = calculateMACD;
window.detectMacdGreenShrinking = detectMacdGreenShrinking;
window.detectMacdRedShrinking = detectMacdRedShrinking;
window.calculateVolumeRatio = calculateVolumeRatio;
window.evaluateSilverSignal = evaluateSilverSignal;
window.calculatePositionPnl = calculatePositionPnl;
window.renderDashboard = renderDashboard;
