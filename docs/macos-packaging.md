# macOS 打包与分发规范

状态：已启用

本文是玉衡 macOS 安装包的唯一操作说明。当前发行目标为 macOS 13+、Apple Silicon（arm64）。Windows、Linux、Intel Mac 和 Universal Binary 不在本配置范围内。

## 构建工具链

- Electron 42.10.1
- electron-builder 26.15.3
- Node.js 20+（仅构建机需要）
- macOS arm64 构建机

依赖通过 `package-lock.json` 固定。项目根目录的 `.npmrc` 只影响项目内 npm 安装，不修改全局配置。

## 标准命令

在项目根目录执行：

```bash
npm install
npm run package:mac
```

`package:mac` 先执行 Electron 和 Vite 生产构建，再生成未签名的 DMG 与 ZIP。产物目录为 `release/`：

```text
release/
  玉衡-<version>-arm64.dmg
  玉衡-<version>-arm64.zip
```

只需要检查应用目录时使用：

```bash
npm run package:mac:dir
```

输出为 `release/mac-arm64/玉衡.app`。`release/` 已加入 `.gitignore`，安装包不应提交到源码仓库。

## 应用资源边界

`package.json` 的 `build.files` 明确包含以下运行时资源：

- `dist-electron`：Electron 主进程和 preload
- `dist-renderer`：Vite 前端静态资源
- `electron/prompts`：玉衡系统提示词和 Agent Profile 提示词
- `package.json`：运行时版本读取和 Electron 应用元数据

图标源文件是 [`assets/yuheng-icon.png`](../assets/yuheng-icon.png)，发布图标是 `assets/yuheng-icon.icns`。修改图标后必须重新生成 `.icns` 并重新运行 `npm run package:mac`。

## 图标生成

macOS 应用使用 1x/2x 多尺寸 iconset。对于 PNG 源文件，直接执行：

```bash
npm run build:mac-icon
```

脚本默认读取 1024×1024 的 PNG；如需传入 SVG，可通过 `YUHENG_ICON_SOURCE` 指定，并安装 Homebrew 的 `librsvg`（提供 `rsvg-convert`）。中间 PNG 与 iconset 目录是构建产物，不需要提交。

## 分发、签名与公证

当前 `package:mac` 显式关闭自动签名并设置 `--publish never`，适合内部同事试用，不会读取发布凭据或上传文件。将 DMG 发给同事后，双击并把玉衡拖入“应用程序”目录。

未签名应用首次打开可能出现“无法验证开发者”。确认文件来源可信后，可以在 Finder 中右键选择“打开”，或执行：

```bash
xattr -dr com.apple.quarantine "/Applications/玉衡.app"
```

正式对外发布必须使用 Developer ID Application 证书签名并完成 notarization。示例：

```bash
npm run build
CSC_NAME="Developer ID Application: <Team Name> (<TEAM_ID>)" \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  npx electron-builder --mac --arm64 --publish never
```

签名、公证和 native helper 必须在同一条正式发布流水线中完成，并保留构建日志和许可证清单。

## 功能运行时前提

- Browser Use 仍通过 `uvx` 启动 `browser-use==0.13.8` Python sidecar；当前安装包不会替同事提供 `uv`。要实现完全自包含的 Browser Use 安装包，需要另行集成固定的 Python 3.12、依赖和启动器。
- Computer Use 的 native helper 已被 electron-builder 放入应用包，但 macOS 14+ 需要用户授予 Accessibility 和 Screen Recording 权限。
- 应用在初始化最早阶段将 `app.getPath('userData')` 显式固定为 `~/Library/Application Support/yuheng`，密钥、附件、截图和运行记录不会写入应用包目录。源码开发默认使用隔离的 `~/Library/Application Support/yuheng-dev`；仅 `./start-mac.command --production-data` 会让开发客户端连接正式目录。

## 发布检查清单

1. 更新 `package.json` 的版本，并同步 `CHANGELOG.md` 和应用内 release notes。
2. 执行 `npm run typecheck`。
3. 执行 `npm test`，确认失败项已判断为本次变更相关或无关。
4. 执行 `npm run package:mac`。
5. 检查 `玉衡.app/Contents/Info.plist` 的应用名称、`com.yuheng.desktop`、版本号和 `LSMinimumSystemVersion=13.0`。
6. 检查 `Contents/Resources/app.asar` 中存在 `dist-electron/main.js`、`dist-renderer/index.html`、`electron/prompts/yuheng-system.md` 和 `package.json`。
7. 在干净的 macOS 用户目录启动一次 `.app`，再验证 DMG 安装路径和首次启动行为。
8. 对外发布时完成签名、公证，并在另一台干净的 macOS 13+ arm64 机器上安装验证。
