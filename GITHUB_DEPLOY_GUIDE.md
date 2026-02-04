# 🚀 GitHub Pages 部署指南

為了讓其他裝置（手機/平板）能存取遊戲，您需要將專案部署至 GitHub Pages。

## 1. 準備工作
我已經幫您安裝了 `gh-pages` 套件，並在 `package.json` 加入了自動化部署腳本。

## 2. 建立 GitHub 儲存庫與推送
如果您還沒有將代碼上傳至 GitHub：
1. 在 GitHub 上建立一個新的儲存庫 (Public)。
2. 在終端機執行：
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <您的儲存庫 URL>
   git push -u origin main
   ```

## 3. 一鍵部署
現在您只需要在終端機執行：
```bash
npm run deploy
```
這會自動完成以下動作：
- 執行 `npm run build` (編譯專案)
- 將產生的 `dist` 資料夾內容上傳到 GitHub 的 `gh-pages` 分支。

## 4. 設定 GitHub Pages
1. 開啟您的 GitHub Repository 網頁。
2. 點擊 **Settings** > **Pages**。
3. 在 **Build and deployment** > **Branch** 下，確認選擇的是 `gh-pages` 分支。
4. 儲存後，GitHub 會提供一個網址（例如 `https://<username>.github.io/<repo-name>/`），點開即可開始遊戲！

## 5. 重要事項
- **HTTPS 環境**：MediaPipe 手勢辨識必須在 HTTPS 環境下運作，GitHub Pages 已預設開啟。
- **手機使用**：建議橫屏使用，並確保光線充足，以便相機精確捕捉手勢。
- Richmond **路徑問題**：我已將 `vite.config.ts` 的 `base` 設為 `./`，這能確保網頁在子路徑下也能平滑運行。
