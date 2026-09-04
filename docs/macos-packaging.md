# macOS 打包与分发规范

状态：已启用

本文是玉衡 macOS 安装包的操作说明，覆盖 macOS 13+、Apple Silicon（arm64）构建。Windows 安装包由 GitHub Actions 的 Windows runner 自动构建，具体流程见项目根目录 README；Linux、Intel Mac 和 Universal Binary 不在当前发行范围内。

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

## Computer Use fork 依赖更新规范

玉衡使用自维护的 `No-Github/pi-computer-use` fork。更新 fork 后，必须锁定完整 40 位 commit SHA；禁止使用短 SHA、浮动分支或 semver 范围。当前依赖格式：

```json
"@injaneity/pi-computer-use": "git+https://github.com/No-Github/pi-computer-use.git#<40位完整SHA>"
```

更新步骤：

1. 在 fork 仓库提交并推送，记录完整 SHA：

   ```bash
   git -C ../extension/pi-computer-use rev-parse HEAD
   git -C ../extension/pi-computer-use push origin main
   ```

2. 同时更新 `package.json` 和 `package-lock.json` 中的依赖 ref。不要只改其中一个文件。

3. 校验 `package.json`、lockfile 和实际安装目录一致：

   ```bash
   rg -n "pi-computer-use" package.json package-lock.json node_modules/.package-lock.json
   node -p "require('./node_modules/@injaneity/pi-computer-use/package.json').version"
   ```

   三份依赖记录必须指向同一个完整 SHA，安装目录版本必须符合目标 fork 版本。npm 的 Git 依赖目录通常不含 `.git`，不要在该目录运行 `git rev-parse`，否则 Git 会向上找到玉衡仓库并输出错误的 SHA。若 `node_modules` 仍是旧版本，不得继续打包。

   `npm run build` 已自动执行同一项门禁；也可以单独运行 `npm run check:computer-use-pin` 快速检查。门禁会拒绝短 SHA、浮动版本、`package.json`/lockfile 不一致，以及本地安装目录指向旧 commit。

4. 项目 `.npmrc` 使用镜像 registry 和 `replace-registry-host=always`。这可能把 Git 依赖错误改写成 registry URL，或复用旧 Git 缓存。遇到这种情况，不要只重复普通 `npm install`；使用临时 cache，并检查实际落地内容：

   ```bash
   npm install --force --cache "$(mktemp -d /tmp/yuheng-npm-cache.XXXXXX)"
   npm run postinstall
   ```

   如果镜像仍错误改写 Git URL，使用 HTTPS 直接 clone 完整 SHA 到 `node_modules/@injaneity/pi-computer-use`，再执行第 3 步校验。

5. 校验 fork 修复确实存在，而不是只看 npm 元数据：

   ```bash
   rg -n "source.sha256|helperInstallNeedsRefresh|invalidateDaemon" \
     node_modules/@injaneity/pi-computer-use/scripts/setup-helper.mjs \
     node_modules/@injaneity/pi-computer-use/src/platform/macos/helper.ts
   ```

6. 运行 `npm run build` 和 `npm run package:mac` 后，从最终 ZIP/APP 产物中再次检查 `setup-helper.mjs` 与 `prebuilt/macos/arm64/bridge`。不能只检查工作区的 `node_modules`。

7. 首次启动新包后，确认安装记录的源 helper hash 与包内 helper 一致：

   ```bash
   shasum -a 256 node_modules/@injaneity/pi-computer-use/prebuilt/macos/arm64/bridge
   cat "$HOME/Applications/pi-computer-use.app/Contents/Resources/source.sha256"
   ```

   两个 hash 必须一致。不要直接比较包内 helper 与安装后 `Contents/MacOS/bridge` 的文件 hash：`codesign` 会修改 Mach-O，二者正常情况下可以不同。helper daemon 是长驻进程，更新后必须停止旧 daemon，再由新包从用户 `Applications` 目录启动；不能只重启 Renderer。

8. 连续执行一次 `find_roots` 和一次 `observe_ui`，确认两次调用使用同一 helper PID，安装文件时间戳没有在调用之间变化，且没有 `ECONNREFUSED bridge.sock`。helper 安装、签名或替换逻辑有改动时，这项是强制回归检查。

### Helper 生命周期约束

- helper 是否需要更新，由包版本和 helper 来源标识共同判断。loose helper 使用 `Contents/Resources/source.sha256`；预签名 bundle 可以比较签名后的包内与安装后可执行文件。禁止拿签名前或不同签名身份的二进制 hash 与安装后的 Mach-O 直接比较。
- 只要准备停止、替换或重签 helper，就必须先清空 daemon 可用状态和诊断缓存。下一次工具调用必须重新探测或启动 daemon。
- `bridge.sock` 文件存在不代表 daemon 正在监听；`ECONNREFUSED` 应按 daemon 生命周期故障处理，不能归因于 TCC 权限或模型能力。

### TCC 权限注意事项

macOS Accessibility 和 Screen Recording 权限绑定到 helper 的签名身份及进程缓存。native binary 更新、重签或从 ad-hoc 签名切换后，系统设置中看起来“已授权”不代表新 helper 已获得权限。诊断必须以 helper 自己的实时结果为准：

```text
accessibility: true
screenRecording: true
```

如果任一项为 `false`：完全退出玉衡和 helper，在系统设置中对实际显示的 `pi-computer-use.app` 关闭并重新打开对应权限，然后重新启动 helper。

### Computer Use 观察与动作回归

系统权限显示正常后，还要验证具体目标窗口的观察与动作闭环；权限状态本身不证明每个窗口都能被当前 macOS Space 捕获。

1. 将目标窗口切到当前桌面并保持可见，调用 `find_roots` 和 `observe_ui`。
2. 确认观察结果包含正数 `windowId`、非零截图尺寸和可用 `stateId`。
3. 执行一个可逆的 `act_ui`，确认 `details.actionOutcome.status` 为 `verified`，再检查 successor state。
4. 将目标窗口移到其他 Space 或隐藏后重试坐标动作，确认返回 `not_dispatched`、`dispatchedActions: 0`，且玉衡不会声称操作完成。
5. 同类失败连续两次后，确认下一次 `act_ui` 被阻止；成功执行一次新的 `observe_ui` 后才允许继续。

出现 `capture_unavailable`、`windowId: 0` 或截图尺寸为零时，应报告“当前窗口不可捕获”，不能在 helper 已明确返回两项权限为 `true` 时再次归因为 TCC 授权失败。

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
