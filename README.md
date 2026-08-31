# 玉衡（Yuheng）

玉衡是一个面向个人的客户端秘书项目，负责把日程、提醒、任务和对话式协作集中到一个轻量入口中。

当前仓库进入 0.1 脚手架阶段，目录名和代码标识统一使用拼音 `yuheng`。首版固定为 macOS 13+ Apple Silicon（arm64）桌面客户端，采用 Electron + React 19 + TypeScript + Vite，Agent runtime 使用 Pi SDK。

## 产品定位

- 面向个人的事务整理与执行入口
- 支持自然语言记录、查询和提醒
- 将待办、日程、笔记和后续行动保持在同一上下文中
- 优先保证本地可用、可控和可恢复

## 项目边界

玉衡是客户端产品，不直接承担 PoJun、贪狼或天枢的服务端职责。与其他项目的集成通过明确的 API 或协议完成，不共享数据库和内部模块。

0.1 明确不承诺：

- Windows、Linux、Intel Mac 或 Universal Binary
- 自动更新和云端同步
- 多人协作、组织权限和复杂工作流
- 自动执行高风险外部操作
- 在没有用户确认时替用户发送消息、修改数据或触发任务

## 目录

- `docs/`：产品、架构和集成文档

## 本地开发

推荐直接双击项目根目录的 `start-mac.command`。它会自动检查 Node.js、安装缺失依赖，并从国内镜像下载 Electron 后启动开发客户端。

也可以在终端运行：

```bash
npm install
npm run dev
```

## 打包 macOS 应用

玉衡支持打包为 Apple Silicon（arm64）的 macOS 应用，发给同事时不需要安装 Node.js。先在 macOS arm64 机器上安装依赖，然后运行：

```bash
npm install
npm run package:mac
```

产物会写入 `release/`：

- `玉衡-<版本>-arm64.dmg`：推荐分发，双击后将玉衡拖入“应用程序”目录
- `玉衡-<版本>-arm64.zip`：适合通过网盘或内部文件系统传输

完整的资源边界、图标生成、签名、公证和发布检查清单见 [`docs/macos-packaging.md`](docs/macos-packaging.md)。

需要先检查未压缩的应用时，运行 `npm run package:mac:dir`，然后打开 `release/mac-arm64/玉衡.app`。打包会把前端资源、Electron 主进程和 `electron/prompts` 一起放入应用，不会使用开发环境的 `start-mac.command`。

除 Browser Use 外，应用运行不需要 Node.js。Browser Use 目前仍通过 `uvx` 启动 Python sidecar；同事要使用该可选能力，需要另外安装 `uv` 并保证命令在 `PATH` 中。Computer Use 的 native helper 已随应用打包，但 macOS 14+ 仍需要授予 Accessibility 和 Screen Recording 权限。将 Browser Use 做成完全自包含的正式发行包，还需要单独集成固定的 Python 运行时和依赖。

当前构建没有配置 Apple Developer ID 签名和公证。首次打开时若 macOS 提示“无法验证开发者”，可在 Finder 中右键玉衡选择“打开”；仅在确认文件来源可信时，也可以执行：

```bash
xattr -dr com.apple.quarantine "/Applications/玉衡.app"
```

`package:mac` 为本地分发显式关闭了自动签名，避免误用开发机钥匙串中的证书。面向外部用户正式发布时，应使用 Developer ID Application 证书签名并完成 notarization，例如先设置 `CSC_NAME`，再执行 `npm run build && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --publish never`，避免上述提示。

会话运行需要先在应用设置中配置 OpenAI-compatible 或 Anthropic Provider 与 API Key。设置支持保存多个 Provider；新会话可在左侧选择 Provider，已有会话可在标题栏切换，后续运行和重试都会使用该会话绑定的配置。Pi 默认启用 `read`、`write`、`edit`、`bash` 工具，工作目录位于应用数据目录。

玉衡的产品级系统提示词维护在 [`electron/prompts/yuheng-system.md`](electron/prompts/yuheng-system.md)。运行时会把它追加到 Pi 根据当前工具动态生成的基础系统提示词中，使玉衡身份、个人秘书行为和安全边界保持版本可追踪，同时保留 Browser Use、Computer Use 与任务工具各自的动态说明。

Pi 同时可以通过 `task_list`、`task_create`、`task_update` 操作本地任务看板：查询看板和任务、创建任务、修改标题或 Markdown 详情、设置优先级和截止日期，以及在已有任务类型之间移动。写操作只在用户明确要求时执行；看板和任务类型的结构管理仍由界面完成。

任务可以在详情中设置提醒时间，也可以让 Pi 通过 `remind_at` 设置或清除。到点后由 Electron 主进程发送 macOS 通知，点击通知会打开对应看板和任务；完成或归档任务不会继续提醒。提醒在应用进程运行时触发，完全退出后的未触发提醒会在下次启动时恢复。

Browser Use 和 Computer Use 是默认关闭、且互斥的可选能力，设置中只能开启其中一个。Browser Use 通过 `uvx` 启动锁定的 `browser-use==0.13.8` MCP sidecar；Computer Use 作为 `@injaneity/pi-computer-use` Pi extension 接入，提供桌面控制和 managed browser 的 `launch_browser`、`navigate_browser`、`evaluate_browser` 工具。两者都只对新运行注入工具，高风险操作逐次请求确认。

Browser Use 截图会显示在对应的工具执行记录中，点击缩略图可以放大查看。图片文件保存在应用 `userData/browser-use/screenshots` 受控目录，SQLite 只记录图片 ID、类型、大小和受控 URL，不保存 base64；应用重启后仍可查看，超过 30 天会自动清理。升级前已经执行过但未保存为 artifact 的历史截图无法回溯恢复，需要重新截取。

Computer Use 的截图同样显示在工具执行记录中，并保存为受控 artifact。Computer Use 会话在 Electron 进程内串行运行，以避免上游 native helper 的全局状态互相污染。macOS 需要 14+，并授予 Accessibility 与 Screen Recording 权限。

开发 Browser Use 功能前需要安装 [`uv`](https://docs.astral.sh/uv/) 并保证 `uv --version` 可用。首次调用需要联网下载 Python 依赖，耗时可能较长。当前这是开发/MVP 运行方式；正式 macOS 安装包必须把固定的 Python 3.12 运行时和依赖作为 Electron resources 一起发布，不能要求最终用户预装 `uv` 或依赖首次联网安装。

项目已通过 `.npmrc` 使用 `registry.npmmirror.com`，启动脚本同时设置 Electron 二进制镜像。不会修改机器的全局 npm 配置。

0.1 的实现架构和技术选型见 [`docs/architecture-0.1.md`](docs/architecture-0.1.md)。
