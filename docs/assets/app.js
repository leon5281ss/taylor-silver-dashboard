const STORAGE_KEY = "taylorSilverSettings.v1";
const DATA_URL = "./data/silver.json";

const fallbackData = {
  updatedAt: new Date().toISOString(),
  dataStatus: "mock",
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
    const low = Math.min(...window.map((item) => item.low));
    const high = Math.max(...window.map((item) => item.high));
    const rsv = high === low ? 50 : ((row.close - low) / (high - low)) * 100;
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
  const closes = rows.map((row) => row.close);
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
    const average = window.reduce((sum, item) => sum + item.volume, 0) / window.length;
    return average > 0 ? row.volume / average : null;
  });
}

function calculatePositionPnl(price, settings) {
  const averageCost = Number(settings.averageCost || 0);
  const quantity = Number(settings.quantity || 0);
  if (!settings.isHolding || averageCost <= 0 || quantity <= 0) {
    return { pnlPercent: null, pnlAmount: null };
  }
  return {
    pnlPercent: ((price - averageCost) / averageCost) * 100,
    pnlAmount: (price - averageCost) * quantity
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

  const histograms = rows.map((row) => row.macdHistogram).filter((value) => Number.isFinite(value));
  const stopLossRatio = Number(settings.stopLossRatio || 10) / 100;
  const averageCost = Number(settings.averageCost || 0);

  if (settings.isHolding && averageCost > 0 && latest.close <= averageCost * (1 - stopLossRatio)) {
    return {
      type: "stop",
      label: "⚠️ 紀律停損",
      message: `帳面虧損已達 ${settings.stopLossRatio || 10}% 停損線，無條件全數出場。`,
      action: "停損條件優先於所有技術指標，需要人工確認後執行。"
    };
  }

  const greenShrinking = detectMacdGreenShrinking(histograms);
  const redShrinking = detectMacdRedShrinking(histograms);

  if (latest.k < 20 && latest.macdHistogram < 0 && greenShrinking) {
    const tranche = Number(settings.buyTranches || 3);
    return {
      type: "ready",
      label: "🟢 準備進場",
      message: "市場短線超賣，MACD 綠柱開始縮短，殺盤力道減弱。可分批買進，不建議一次滿倉。",
      action: settings.isHolding ? `可考慮下一筆 1/${tranche}，最多 ${tranche} 筆。` : `尚未持有，第一筆以 1/${tranche} 為上限。`
    };
  }

  if (latest.k > 80 && latest.macdHistogram > 0 && redShrinking) {
    return {
      type: "exit",
      label: "🔴 獲利退場",
      message: "市場短線過熱，MACD 紅柱開始縮短，多頭力道減弱。建議分批停利，避免獲利回吐。",
      action: settings.isHolding ? "可分批停利，避免獲利回吐。" : "沒有持倉，不追高。"
    };
  }

  if (latest.k >= 40 && latest.k <= 70) {
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

function volumeNote(latest) {
  if (!latest || !Number.isFinite(latest.volumeRatio20)) return "資料不足";
  if (latest.volumeRatio20 >= 1.5 && latest.k < 20) return "恐慌量放大";
  if (latest.volumeRatio20 >= 1.5 && latest.k > 80) return "追價量放大";
  if (latest.volumeRatio20 < 0.8) return "量能不足，訊號可信度下降";
  return "量能中性";
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "資料不足";
  return Number(value).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function normalizeRows(rows) {
  let normalized = rows || [];
  const needsKdj = normalized.some((row) => !Number.isFinite(row.k));
  const needsMacd = normalized.some((row) => !Number.isFinite(row.macdHistogram));
  if (needsKdj) normalized = calculateKDJ(normalized);
  if (needsMacd) normalized = calculateMACD(normalized);
  const ratio5 = calculateVolumeRatio(normalized, 5);
  const ratio20 = calculateVolumeRatio(normalized, 20);
  return normalized.map((row, index) => ({
    ...row,
    volumeRatio5: Number.isFinite(row.volumeRatio5) ? row.volumeRatio5 : ratio5[index],
    volumeRatio20: Number.isFinite(row.volumeRatio20) ? row.volumeRatio20 : ratio20[index]
  }));
}

function getActiveAsset() {
  const asset = appState.data.assets[appState.selectedSymbol] || appState.data.assets["00738U"];
  const rows = normalizeRows(asset?.prices || []);
  return { ...asset, prices: rows };
}

function renderMetrics(asset, latest, signal, pnl) {
  const previous = asset.prices[asset.prices.length - 2];
  const changePercent = previous ? ((latest.close - previous.close) / previous.close) * 100 : null;
  const cards = [
    ["最新價格", formatNumber(latest.close), latest.currency || asset.currency || ""],
    ["今日漲跌幅", `${formatNumber(changePercent, 2)}%`, latest.date],
    ["K / D / J", `${formatNumber(latest.k)} / ${formatNumber(latest.d)} / ${formatNumber(latest.j)}`, "日線 9,3,3"],
    ["MACD histogram", formatNumber(latest.macdHistogram, 4), "histogram = macdLine - signalLine"],
    ["MACD 最近三日", asset.prices.slice(-3).map((row) => formatNumber(row.macdHistogram, 3)).join(" → "), "柱狀圖方向"],
    ["成交量 / 5 日均量", `${formatNumber(latest.volumeRatio5, 2)}x`, formatNumber(latest.volume, 0)],
    ["成交量 / 20 日均量", `${formatNumber(latest.volumeRatio20, 2)}x`, volumeNote(latest)],
    ["是否持有", appState.settings.isHolding ? "是" : "否", ""],
    ["平均成本", formatNumber(Number(appState.settings.averageCost || 0)), ""],
    ["帳面損益 %", pnl.pnlPercent === null ? "未持有" : `${formatNumber(pnl.pnlPercent, 2)}%`, pnl.pnlAmount === null ? "" : `損益 ${formatNumber(pnl.pnlAmount)}`],
    ["建議動作", signal.action, "需人工確認"],
    ["資料狀態", asset.dataDelay ? "資料延遲" : "mock data", asset.source || "adapter mock"]
  ];
  document.getElementById("metricsGrid").innerHTML = cards
    .map(([label, value, note]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><p>${note || "&nbsp;"}</p></article>`)
    .join("");
}

function resizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = Number(canvas.getAttribute("height"));
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  return { ctx, width, height };
}

function drawPriceChart(asset) {
  const canvas = document.getElementById("priceCanvas");
  const { ctx, width, height } = resizeCanvas(canvas);
  const rows = asset.prices;
  ctx.clearRect(0, 0, width, height);
  if (!rows.length) return;
  const pad = 28;
  const highs = rows.map((row) => row.high);
  const lows = rows.map((row) => row.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const xStep = (width - pad * 2) / Math.max(rows.length - 1, 1);
  const y = (value) => height - pad - ((value - min) / (max - min || 1)) * (height - pad * 2);
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
    const up = row.close >= row.open;
    ctx.strokeStyle = up ? "#168a4a" : "#c63838";
    ctx.fillStyle = up ? "#168a4a" : "#c63838";
    ctx.beginPath();
    ctx.moveTo(x, y(row.low));
    ctx.lineTo(x, y(row.high));
    ctx.stroke();
    ctx.fillRect(x - 4, Math.min(y(row.open), y(row.close)), 8, Math.max(2, Math.abs(y(row.open) - y(row.close))));
  });
  ctx.fillStyle = "#667085";
  ctx.font = "12px sans-serif";
  ctx.fillText(`${asset.name} close ${formatNumber(rows.at(-1).close)}`, pad, 16);
}

function drawIndicatorChart(asset) {
  const canvas = document.getElementById("indicatorCanvas");
  const { ctx, width, height } = resizeCanvas(canvas);
  const rows = asset.prices;
  ctx.clearRect(0, 0, width, height);
  if (!rows.length) return;
  const pad = 28;
  const xStep = (width - pad * 2) / Math.max(rows.length - 1, 1);
  const kdY = (value) => pad + (100 - value) / 100 * (height * 0.45);
  const histValues = rows.map((row) => row.macdHistogram);
  const histMax = Math.max(...histValues.map((value) => Math.abs(value)), 1);
  const histBase = height - 44;

  ctx.strokeStyle = "#d9dee8";
  ctx.beginPath();
  ctx.moveTo(pad, kdY(80));
  ctx.lineTo(width - pad, kdY(80));
  ctx.moveTo(pad, kdY(20));
  ctx.lineTo(width - pad, kdY(20));
  ctx.stroke();

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
    const barHeight = (row.macdHistogram / histMax) * 44;
    ctx.fillStyle = row.macdHistogram >= 0 ? "#c63838" : "#168a4a";
    ctx.fillRect(x - 5, histBase - Math.max(barHeight, 0), 10, Math.abs(barHeight));
  });

  ctx.fillStyle = "#667085";
  ctx.font = "12px sans-serif";
  ctx.fillText("KD + MACD histogram", pad, 16);
}

function renderNews(news) {
  const now = new Date();
  const items = (news || []).map((item) => ({ ...item, timeValue: new Date(item.time) }));
  const in24h = items.filter((item) => now - item.timeValue <= 24 * 60 * 60 * 1000).length;
  const in7d = items.filter((item) => now - item.timeValue <= 7 * 24 * 60 * 60 * 1000).length;
  document.getElementById("news24h").textContent = in24h;
  document.getElementById("news7d").textContent = in7d;
  document.getElementById("newsList").innerHTML = items.slice(0, 5).map((item) => `
    <article class="news-item">
      <strong>${item.title}</strong>
      <div class="news-meta">
        <span>${item.source}</span>
        <span>${item.time.replace("T", " ").slice(0, 16)}</span>
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
  const container = document.getElementById("tradingview_chart");
  container.innerHTML = "";
  if (!window.TradingView) {
    container.textContent = "TradingView widget 載入中或被瀏覽器阻擋。";
    return;
  }
  new window.TradingView.widget({
    autosize: true,
    symbol: map[symbol] || "OANDA:XAGUSD",
    interval: "D",
    timezone: "Asia/Taipei",
    theme: "light",
    style: "1",
    locale: "zh_TW",
    enable_publishing: false,
    hide_side_toolbar: false,
    allow_symbol_change: true,
    container_id: "tradingview_chart"
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
  document.getElementById("currentTarget").textContent = `${asset.symbol} ${asset.name}`;
  document.getElementById("updatedAt").textContent = `更新 ${appState.data.updatedAt || latest?.date || "--"}`;
  document.getElementById("dataDelayBadge").textContent = asset.dataDelay ? "資料延遲" : "mock data";
  renderMetrics(asset, latest, signal, pnl);
  drawPriceChart(asset);
  drawIndicatorChart(asset);
  renderNews(appState.data.news);
  renderTradingView(appState.selectedSymbol);
}

function bindSettingsForm() {
  const form = document.getElementById("settingsForm");
  const syncForm = () => {
    form.symbol.value = appState.settings.symbol || appState.selectedSymbol;
    form.isHolding.checked = Boolean(appState.settings.isHolding);
    form.averageCost.value = appState.settings.averageCost || "";
    form.quantity.value = appState.settings.quantity || "";
    form.plannedCapital.value = appState.settings.plannedCapital || "";
    form.buyTranches.value = appState.settings.buyTranches || 3;
    form.stopLossRatio.value = appState.settings.stopLossRatio || 10;
  };
  syncForm();
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
  bindSettingsForm();
  document.querySelectorAll(".target-tab").forEach((button) => {
    button.addEventListener("click", () => {
      appState.selectedSymbol = button.dataset.symbol;
      appState.settings.symbol = appState.selectedSymbol;
      saveSettings(appState.settings);
      updateTabs();
      renderDashboard();
    });
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
