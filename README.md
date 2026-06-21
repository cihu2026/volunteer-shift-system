# 志工／老師選班安全版

這是一個 GitHub Pages + Google Sheets + Apps Script 的安全版選班系統。

## 安全版原則

公開 GitHub 只放前端程式，不放真實志工姓名清單、不放完整班表資料。

真實資料放在 Google Sheets，前端透過 Apps Script Web App 查詢與寫入。

## 已建立檔案

- `index.html`：安全版首頁與畫面結構
- `style.css`：頁面樣式
- `app.js`：前端與 Apps Script API 串接
- `apps-script/Code.gs`：Google Apps Script 後端程式

## Google Sheets 後端工作表

Apps Script 會建立三張後端工作表：

### Teachers

| 欄位 | 說明 |
|---|---|
| teacher_id | 個人代碼／學號 |
| display_name | 顯示姓名 |
| email | Email，下一版寄信可用 |
| active | 是否啟用，填 TRUE |

### Shifts

| 欄位 | 說明 |
|---|---|
| shift_id | 班別代碼 |
| date | 日期 |
| duty | 班別名稱 |
| time | 服務時間 |
| report_time | 報到時間 |
| place | 地點 |
| quota | 名額 |
| visible | 是否開放，填 TRUE |

### Selections

| 欄位 | 說明 |
|---|---|
| selection_id | 選班紀錄 ID |
| teacher_id | 選班人員代碼 |
| shift_id | 班別代碼 |
| confirmed | 是否已按「我知道了」 |
| selected_at | 選班時間 |
| confirmed_at | 確認時間 |

## 設定步驟

1. 打開 Google 試算表。
2. 點「擴充功能」→「Apps Script」。
3. 把 `apps-script/Code.gs` 的內容貼進 Apps Script。
4. 修改 `ADMIN_TOKEN`，不要使用預設的 `CHANGE_ME_ADMIN_TOKEN`。
5. 執行 `setupBackend` 一次並授權。
6. 部署 → 新增部署作業 → 網路應用程式。
7. 執行身分選「我」。
8. 存取權選「知道連結的任何人」。
9. 複製 Web App URL。
10. 打開 GitHub Pages 前端，把 Web App URL 貼到「連接 Google Sheets 後端」。
11. 輸入管理員 token，按「建立後端工作表」。
12. 可按「從原表匯入學號姓名」，將原本表內的學號／姓名匯入 Teachers。

## 重要限制

這版比把姓名寫進 GitHub 安全很多，但還不是完整登入系統。

因為老師是用個人代碼查詢，所以請不要使用容易猜到的代碼。正式上線可改成：

1. 每人一組亂數查詢碼。
2. Email 驗證。
3. Firebase Authentication。
4. Google 帳號限定網域。
