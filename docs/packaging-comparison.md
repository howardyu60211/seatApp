# 打包路線比較：electron-forge vs electron-builder

專案目前**同時**維護兩套打包路線，而且產出的東西在安全性與體積上不一致。這份文件整理兩者的實際差異與收斂建議，供決策參考；本文件不修改任何設定。

|                | `npm run make`                        | `npm run dist`                     |
| -------------- | ------------------------------------- | ---------------------------------- |
| 工具           | electron-forge 7.11.2                 | electron-builder 24.13.3           |
| 設定位置       | [forge.config.ts](../forge.config.ts) | `package.json` 的 `build` 區塊     |
| Windows 產物   | Squirrel 安裝檔（setup exe + nupkg）  | portable 單一 exe                  |
| 其他平台       | macOS ZIP、Linux deb                  | 未設定                             |
| Electron Fuses | **有套用**（6 項）                    | **完全沒有**                       |
| 語系裁剪       | 無（含全部 locale）                   | `en-US` + `zh-TW`                  |
| 壓縮           | 預設                                  | `maximum`                          |
| asar           | 有                                    | 有，且 `files` 排除 `node_modules` |

---

## 1. 安全性落差（最重要的一條）

[forge.config.ts](../forge.config.ts) 的 `FusesPlugin` 在打包時把六個 Electron Fuse 寫進二進位檔：

```ts
[FuseV1Options.RunAsNode]: false,
[FuseV1Options.EnableCookieEncryption]: true,
[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
[FuseV1Options.EnableNodeCliInspectArguments]: false,
[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
[FuseV1Options.OnlyLoadAppFromAsar]: true,
```

這些是在**封裝階段**改寫 Electron 執行檔的位元開關，效果包括：關掉「把自己當成 Node.js 直譯器執行」、擋掉 `NODE_OPTIONS` 與 `--inspect` 這類可以從外部注入程式碼的入口、開啟 asar 完整性驗證讓程式碼被竄改時拒絕啟動。

**`FusesPlugin` 是 Electron Forge 的 plugin，`npm run dist` 走的是 electron-builder，完全不會執行到它。** 也就是說目前實際發佈給老師使用的 portable exe，這六項全是 Electron 預設值：

- `RunAsNode` 開著 → 設定 `ELECTRON_RUN_AS_NODE=1` 就能把這支 exe 當作任意 Node 直譯器執行
- `EnableNodeCliInspectArguments` 開著 → 可用 `--inspect` 掛上除錯器讀取執行期記憶體
- 沒有 asar 完整性驗證 → 替換 `app.asar` 即可植入任意程式碼

以這個 app 的性質（本機離線、不處理帳密、無網路請求）來說，實際風險不高；但「設定檔裡寫了安全強化、實際產物沒有」這種落差本身是誤導，值得統一。

## 2. 產物形式對使用情境的影響

|                       | Squirrel（forge）                     | portable（builder）  |
| --------------------- | ------------------------------------- | -------------------- |
| 安裝                  | 需要跑安裝程式，寫入 `%LOCALAPPDATA%` | 免安裝，單檔複製即用 |
| 管理員權限            | 通常不需要，但企業環境常被政策擋      | 不需要               |
| 自動更新              | 支援（Squirrel.Windows）              | 不支援               |
| 開始功能表捷徑        | 有                                    | 無                   |
| USB 隨身碟 / 共用磁碟 | 不適合                                | 適合                 |

使用者是老師、常在校園公用電腦上跑、且未必有安裝軟體的權限——**portable 對這個 app 有明確優勢**。這也解釋了為什麼最近的 commit（`chore: config env and package for smaller file size`）是在調 electron-builder 而不是 forge。

專案目前沒有任何自動更新機制（`src/main.ts` 沒有 `autoUpdater` 相關程式碼），所以 Squirrel 唯一的獨有優勢並未被使用。

## 3. 體積

electron-builder 那側做了三件 forge 沒做的事：

- `electronLanguages: ["en-US", "zh-TW"]` — 移除其餘數十個 locale 檔
- `compression: "maximum"`
- `files` 只收 `.vite/**` 與 `package.json`，明確排除 `node_modules/**`

第三項能成立，是因為 [vite.base.config.ts](../vite.base.config.ts) 已經把所有 npm 套件 bundle 進 `main.js`（該檔註解寫得很清楚）：

> 只外部化 Node/Electron 內建模組，dependencies 一律 bundle 進 main.js。打包後的 asar 只含 .vite 與 package.json、沒有 node_modules，外部化任何 npm 套件都會讓正式版啟動時 MODULE_NOT_FOUND。

**這是兩條路線共同的硬前提**：無論最後保留哪一套，都不能把 npm 套件加進 `external`，否則 portable 版會在啟動時直接掛掉。forge 的 `packagerConfig` 目前只有 `asar: true`，沒有對應的體積優化，所以 `npm run make` 的產物會明顯比 `npm run dist` 大。

## 4. 版本健康度

- **electron-forge 7.11.2** — 當前版本，對 Electron 43 支援完整。
- **electron-builder 24.13.3** — 2024 年初的版本，最新已到 26.x。24.x 早於 Electron 40+，對新版的 asar integrity metadata、Windows 簽章流程等支援不完整。這是目前正式發佈路線上最老的一個環節，值得優先升級。
- **@electron/fuses 1.8.0** — 最新為 2.x。只在 forge 路線上生效。

## 5. 三種收斂方案

### 方案 A：只留 electron-builder（建議）

**理由**：portable 才是實際交付形式，Squirrel 的自動更新從未被使用，維護兩套設定沒有回報。

要做的事：

1. `electron-builder` 升到 26.x，跑一次 `npm run dist` 確認 Electron 43 產物正常。
2. 在 `package.json` 的 `build` 補上等效的安全設定。electron-builder 26 支援 `electronFuses` 欄位，可以直接對應 forge 的六個 fuse：
    ```json
    "electronFuses": {
        "runAsNode": false,
        "enableCookieEncryption": true,
        "enableNodeOptionsEnvironmentVariable": false,
        "enableNodeCliInspectArguments": false,
        "enableEmbeddedAsarIntegrityValidation": true,
        "onlyLoadAppFromAsar": true
    }
    ```
3. 移除 [forge.config.ts](../forge.config.ts) 的 `makers` 與 `FusesPlugin`（`VitePlugin` 必須保留，`npm start` 的 dev server 靠它）。
4. 移除 devDeps：`@electron-forge/maker-squirrel`、`maker-zip`、`maker-deb`、`maker-rpm`、`@electron-forge/plugin-fuses`、`@electron/fuses`。順帶清掉 `@electron-forge/plugin-auto-unpack-natives`——它在 devDeps 但 `forge.config.ts` 從未引用。
5. `package.json` 移除 `make` 與 `publish` script。

**代價**：失去 macOS ZIP 與 Linux deb 的產出能力。若之後要跨平台，electron-builder 本來就支援 `mac` / `linux` target，補設定即可。

### 方案 B：保留兩套並補齊差異

`electron-builder` 升級 + 補 `electronFuses`（同方案 A 的 1、2 步），forge 的 `packagerConfig` 補上語系裁剪，讓兩邊產物一致。

**代價**：兩份設定要長期同步，安全選項改一邊忘另一邊的風險會反覆出現——這正是現在的問題。除非真的需要 deb / macOS 產物，否則不建議。

### 方案 C：只留 electron-forge

移除 `electron-builder` 與 `package.json` 的 `build` 區塊，Fuses 自然生效。

**代價**：交付形式從 portable 變回 Squirrel 安裝檔，對「校園公用電腦、可能無安裝權限」的使用情境是退步；且要另外在 `packagerConfig` 重做語系裁剪與壓縮才能追回體積。**不建議。**

---

## 建議

**採方案 A**，並把「electron-builder 升到 26.x」排在最前面——它同時是目前正式發佈路線上最老的環節，以及 `electronFuses` 設定可用的前提。

執行後的驗收：跑 `npm run dist`，在 Windows 上確認 (1) portable exe 能正常開啟並走完匯入 → 分配 → 匯出流程，(2) 設 `ELECTRON_RUN_AS_NODE=1` 執行該 exe 不再進入 Node 模式（代表 fuse 生效），(3) 檔案大小沒有比升級前明顯膨脹。
