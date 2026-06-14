# Taylor Silver Dashboard

白銀投資進退場監控 Dashboard。第一版是純靜態 GitHub Pages MVP，不需要後端、不需要登入、不寫死 API Key。使用者設定儲存在瀏覽器 `localStorage`。

本專案只監控：

- `00738U`：元大道瓊白銀ER
- `SLV`：iShares Silver Trust
- `XAG/USD`：白銀現貨參考

不包含股票健檢，不分析 PE、PB、ROE，也不分析財報三張表。

## 如何使用

1. 直接打開 `docs/index.html` 檢視 MVP。
2. 在上方切換 `00738U`、`SLV`、`XAG/USD`。
3. 在設定區輸入是否持有、平均成本、持有數量、預計投入總資金、分批買進份數、停損比例。
4. 按下「儲存設定」，資料會保存在目前瀏覽器的 `localStorage`。

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

目前保留三個 adapter placeholder：

- `fetch_00738u_from_finmind_or_fugle()`
- `fetch_slv_from_free_source()`
- `fetch_xagusd_from_free_source()`

API Key 必須從環境變數讀取，不要寫死在前端，也不要提交到 GitHub。

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

如果外部資料沒有提供 KDJ、MACD 或量比，前端會用 `calculateKDJ()`、`calculateMACD()`、`calculateVolumeRatio()` 補算。

## 如何手動更新資料

第一版先保留 mock data，不會讓畫面空白。手動更新時間戳可執行：

```bash
python scripts/update_silver_data.py
```

之後接入真實資料源時，請在 `scripts/update_silver_data.py` 補上 adapter，並輸出同樣格式到 `docs/data/silver.json`。

## 如何部署 GitHub Pages

本專案已包含：

```text
.github/workflows/deploy.yml
```

部署方式：

1. 建立 GitHub repo，例如 `taylor-silver-dashboard`。
2. 將本專案推到 `main` branch。
3. 到 GitHub repo 的 `Settings > Pages`，Source 選擇 `GitHub Actions`。
4. 手動執行 `Deploy GitHub Pages` workflow，或推送到 `main` 後自動部署。

部署內容來源是 `docs/`。

## 免責聲明

本系統僅供投資紀律追蹤與風險提示，不構成買賣建議，不得自動下單，所有決策需人工確認。
