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
3. 宏觀與題材分數：顯示 0～100 分、環境標籤、綜合操作提示與 8 個評分細項。
4. 精簡技術面儀表板：用數值卡與條件檢查清單取代大型圖表。
5. 小型技術圖表：價格圖顯示最近 60 日，KD/MACD 圖顯示 80/20 線、最新值與最近三日 histogram。
6. TradingView 參考圖：桌機高度較小，手機版預設收合，點擊後才載入。

條件檢查清單會清楚顯示「是 / 否」：

- `K < 20`
- `K > 80`
- `MACD 為綠柱`
- `MACD 綠柱縮短`
- `MACD 紅柱縮短`
- `成交量放大`
- `停損觸發`

## 宏觀與題材分數

`macroThemeScore` 是白銀大環境的信心加權指標，範圍為 `0～100` 分：

- `80～100`：強多環境
- `65～79`：偏多環境
- `45～64`：中性觀望
- `30～44`：偏空環境
- `0～29`：高風險環境

分數由 8 個項目加總：

- 美元指數 DXY：15 分
- 美國10年實質利率：15 分
- Fed 降息預期：10 分
- SLV / 白銀 ETF 資金流：15 分
- 白銀期貨未平倉量：10 分
- CFTC 投機淨部位：10 分
- 金銀比：10 分
- 白銀供需 / 題材熱度：15 分

宏觀與題材分數不直接觸發買賣，只用於判斷技術燈號的信心強弱與部位大小參考。原本 KD / MACD 燈號與持倉停損邏輯不會被宏觀分數改寫。

資料不足時，該項目給中性分，並在畫面顯示「資料不足，暫以中性處理」或「需要人工確認」。停損仍是最高優先，若觸發停損，宏觀分數不會覆蓋停損提示。

## Taylor Silver Index

Taylor Silver Index，簡稱 `TSI`，是白銀綜合判斷分數，範圍為 `0～100`。它是第二層確認濾網，不會取代原本 KD / MACD 技術燈號，也不會覆蓋停損規則。

TSI 由三個子指數組成：

- `Silver Trend Index`：趨勢分數，檢查收盤價與 MA20、MA5/MA10/MA20 多頭排列、MACD柱狀圖、近20日區間位置與成交量。
- `Silver Panic Buy Index`：恐慌低接分數，檢查 K 值、RSI、MACD綠柱縮短、布林通道下緣、日K收盤位置與是否跌破前低。
- `Silver Risk Index`：風險分數，檢查 RSI 過熱、價格遠離 MA20、短線漲幅過大、金銀比快速下降，以及 CFTC / 溢價資料待接入欄位。

TSI 公式：

```text
TSI = 0.35 * TrendScore + 0.40 * PanicBuyScore + 0.25 * (100 - RiskScore)
```

`Silver Risk Index` 是風險分數，不會直接加到 TSI；風險越高，`100 - RiskScore` 越低，TSI 會被壓低。CFTC COT 與 ETF 溢價等「資料待接入」條件暫不參與分數計算，避免用 0 分造成失真。

TSI 燈號：

- `TSI >= 75`：綠燈，顯示「可分批買進」
- `TSI 60～74`：黃綠燈，顯示「小量試單」
- `TSI 45～59`：黃燈，顯示「觀察」
- `TSI 30～44`：橘燈，顯示「暫停加碼」
- `TSI < 30`：紅燈，顯示「不買 / 降低部位」

TSI 使用 JavaScript 在前端依現有日線資料計算，不使用通達信公式語法。CFTC COT 與 ETF 溢價欄位第一版先顯示「資料待接入」。

若原始技術燈號觸發 `⚠️ 紀律停損`，畫面會顯示「停損優先 / 暫停買進 / 降低部位」。即使 TSI 分數高於 75，也不會顯示可分批買進。

TSI 是輔助判斷工具，不是單獨買賣訊號，不構成投資建議；所有操作仍需人工確認。

## 驗收測試情境

可執行以下指令驗收 TSI 情境：

```bash
node scripts/verify_tsi_scenarios.mjs
```

目前驗收情境與預期結果：

1. `TSI >= 75`，但原始技術燈號觸發紀律停損  
   預期：畫面與最終操作建議必須顯示「停損優先 / 暫停買進 / 降低部位」，不可顯示「可分批買進」。

2. 趨勢分數高、低接分數低、風險分數低  
   預期：`Silver Trend Index` 應偏高，TSI 反映趨勢加分，但仍不覆蓋原始技術燈號。

3. 低接分數高、趨勢分數低、風險分數低  
   預期：`Silver Panic Buy Index` 應偏高，TSI 可提高低接信心，但仍需 KD / MACD 原始燈號確認。

4. 風險分數高  
   預期：`Silver Risk Index` 越高，`100 - RiskScore` 越低，TSI 必須下降。

5. CFTC / 溢價資料待接入  
   預期：`available:false` 的條件不參與分數計算，不以 0 分扭曲 TSI。

6. K線資料少於 20 日  
   預期：不計算 TSI，顯示「資料不足 / 需要人工確認」，不可亂給分數。

## 本機驗收指令

部署前可在專案根目錄執行：

```bash
npm test
```

也可以分開執行：

```bash
node --check docs/assets/app.js
node scripts/verify_tsi_scenarios.mjs
```

`npm test` 會先檢查 `docs/assets/app.js` 語法，再執行 TSI 六大情境測試。

## 部署前檢查清單

- `app.js` 語法檢查通過。
- TSI 六大情境測試通過。
- 停損優先沒有被覆蓋。
- CFTC / 溢價待接入條件不參與分數計算。
- 少於 20 日 K 線時顯示「資料不足」。
- 手動開啟 `docs/index.html` 或本機 server，確認瀏覽器 Console 無紅色錯誤。

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
5. `python scripts/update_macro_theme.py`
6. 若 `docs/data` 有更新，自動 commit 回 `main`
7. 部署 `docs/` 到 GitHub Pages

## 免責聲明

本系統僅供投資紀律追蹤與風險提示，不構成買賣建議，不得自動下單，所有決策需人工確認。
