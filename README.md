# Taylor Silver Dashboard

白銀投資進退場監控 Dashboard。第二版會每日更新真實日線資料，仍維持純靜態 GitHub Pages 架構，不需要後端、不需要登入、不寫死 API Key。使用者設定儲存在瀏覽器 `localStorage`。

本專案只監控：

- `00738U`：元大道瓊白銀ER
- `SLV`：iShares Silver Trust
- `XAG/USD`：白銀現貨參考

不包含股票健檢，不分析 PE、PB、ROE，也不分析財報三張表。

## 如何使用

1. 直接打開 `docs/index.html` 或部署後開啟 GitHub Pages 網址。
2. 首頁會顯示三張對照卡：`00738U`、`SLV`、`XAG/USD`。
3. 點擊任一標的卡片可展開條件檢查清單、最近三日 MACD、成交量比、停損資訊、新聞摘要與迷你價格圖。
4. 在設定區輸入是否持有、平均成本、持有數量、預計投入總資金、分批買進份數、停損比例。
5. 按下「儲存設定」，資料會保存在目前瀏覽器的 `localStorage`。

若用本機伺服器預覽，可在專案根目錄執行：

```bash
python -m http.server 8080
```

然後開啟：

```text
http://localhost:8080/docs/
```

## 燈號邏輯

燈號優先順序：

1. `⚠️ 紀律停損`
2. `🔴 獲利退場`
3. `🟢 準備進場`
4. `🟡 續抱觀望`
5. `⚪ 無明確訊號`

核心函式在 `docs/assets/app.js`：

- `calculateKDJ()`
- `calculateMACD()`
- `detectMacdGreenShrinking()`
- `detectMacdRedShrinking()`
- `calculateVolumeRatio()`
- `evaluateSilverSignal()`
- `calculatePositionPnl()`
- `renderDashboard()`

## UI 說明

首頁資訊層級：

1. 總燈號大卡：顯示目前標的、燈號、白話建議、最新收盤價、漲跌幅與最後更新時間。
2. 三標的對照卡：固定顯示收盤價、漲跌幅、K、MACD柱狀圖、成交量 / 20日均量與建議動作。
3. 精簡技術面儀表板：用數值卡與條件檢查清單取代大型圖表。
4. 小型技術圖表：價格圖顯示最近 60 日，KD/MACD 圖顯示 80/20 線、最新值與最近三日 histogram。
5. TradingView 參考圖：桌機高度較小，手機版預設收合，點擊後才載入。

條件檢查清單會清楚顯示「是 / 否」：

- `K < 20`
- `K > 80`
- `MACD 為綠柱`
- `MACD 綠柱縮短`
- `MACD 紅柱縮短`
- `成交量放大`
- `停損觸發`

## 如何修改停損比例

預設停損比例是 `10%`。

使用者可在網頁設定區修改「停損比例」。儲存後會寫入 `localStorage`，只影響目前瀏覽器。

若要修改系統預設值，請調整：

- `docs/assets/app.js` 的 `defaultSettings.stopLossRatio`
- `config/silver_watchlist.json` 的 `defaults.stopLossRatio`

## 如何新增資料源

資料源 adapter 骨架在：

```text
scripts/update_silver_data.py
```

目前資料源：

- `00738U`：優先使用 FinMind `TaiwanStockPrice`，`data_id=00738U`。
- `SLV`：優先使用 Stooq `slv.us`，失敗時改用 `yfinance` 的 `SLV`。
- `XAG/USD`：優先嘗試 Stooq，失敗時改用 `yfinance` 的 `XAGUSD=X`，再失敗則用 `SI=F` 白銀期貨作參考並標示。

FinMind API Key 可用 repo secret 或本機環境變數 `FINMIND_TOKEN` 提供。API Key 必須從環境變數讀取，不要寫死在前端，也不要提交到 GitHub。

前端讀取的正式格式是：

```text
docs/data/silver.json
```

每筆日資料需要包含：

- `date`
- `open`
- `high`
- `low`
- `close`
- `volume`
- `k`
- `d`
- `j`
- `macd`
- `macdSignal`
- `macdHistogram`
- `volumeRatio5`
- `volumeRatio20`
- `changePercent`

如果外部資料沒有提供 KDJ、MACD 或量比，前端會用 `calculateKDJ()`、`calculateMACD()`、`calculateVolumeRatio()` 補算。

## 如何手動更新資料

先安裝依賴：

```bash
pip install -r requirements.txt
```

手動更新真實資料：

```bash
python scripts/update_silver_data.py
```

更新後會寫入 `docs/data/silver.json`。如果某個資料源失敗，會保留該標的上一版資料，並在 `sourceStatus` 寫清楚失敗原因。

資料狀態規則：

- `live`：三個標的都成功抓到真實資料。
- `partial`：部分標的成功，部分標的保留上一版資料。
- `mock`：三個標的都失敗，僅能使用既有測試資料。

## 如何部署 GitHub Pages

本專案已包含：

```text
.github/workflows/deploy.yml
```

部署方式：

1. 建立 GitHub repo，例如 `taylor-silver-dashboard`。
2. 將本專案推到 `main` branch。
3. 到 GitHub repo 的 `Settings > Pages`，Source 選擇 `GitHub Actions`。
4. 手動執行 `Update Data and Deploy GitHub Pages` workflow，或推送到 `main` 後自動部署。

部署內容來源是 `docs/`。

## 每日自動更新

GitHub Actions 已設定：

- `push main`：部署 GitHub Pages。
- `workflow_dispatch`：手動更新資料並部署。
- `30 22 * * *` UTC：台灣時間每天 06:30，更新美股與白銀現貨參考。
- `30 6 * * *` UTC：台灣時間每天 14:30，更新 00738U 台灣收盤後資料。

workflow 會執行：

1. checkout
2. setup-python
3. `pip install -r requirements.txt`
4. `python scripts/update_silver_data.py`
5. 若 `docs/data/silver.json` 有更新，自動 commit 回 `main`
6. 部署 `docs/` 到 GitHub Pages

## 免責聲明

本系統僅供投資紀律追蹤與風險提示，不構成買賣建議，不得自動下單，所有決策需人工確認。
