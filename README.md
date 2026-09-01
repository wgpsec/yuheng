# 玉衡（Yuheng）

玉衡是基于 Electron、React、TypeScript 和 Pi SDK 的 macOS 个人秘书客户端，提供对话、任务看板、笔记、提醒和本地数据备份。

当前发行目标：macOS 13+、Apple Silicon（arm64）。Windows、Linux、Intel Mac 和 Universal Binary 不在支持范围内。

## 环境要求

- Node.js 20+（开发和构建需要）
- macOS Apple Silicon
- npm 依赖通过项目 `.npmrc` 使用国内镜像，安装时不会修改全局 npm 配置

## 开发启动

在项目根目录执行：

```bash
npm install
./start-mac.command
```

启动脚本会检查 Node/macOS 环境、安装缺失依赖、设置 Electron 镜像并启动 Vite、Electron 和 TypeScript watch。

也可以直接运行：

```bash
npm run dev
```

如果脚本没有执行权限：

```bash
chmod +x start-mac.command scripts/*.sh
```

## 数据目录

应用会在启动早期显式选择数据目录：

- 安装包启动：`~/Library/Application Support/yuheng`
- `./start-mac.command` 或 `npm run dev`：默认使用 `~/Library/Application Support/yuheng-dev`
- `./start-mac.command --production-data`：开发客户端显式使用正式数据
- `./start-mac.command --development-data`：显式使用开发数据

不要同时用开发数据和正式数据启动多个实例。数据目录包含 SQLite、Pi Session、任务附件、笔记封面、截图、恢复快照和窗口偏好。Provider API Key 保存在数据目录的 `secrets.json` 中，文件权限为 `0600`；该文件是可迁移的明文 JSON，请妥善保护。

旧版 `Electron` 数据目录不会自动迁移。跨版本迁移请使用应用内“设置 → 数据备份”导出和导入完整 `.yuheng` 备份，不要在应用运行时直接复制 SQLite 文件。

## macOS 打包

标准发布包（Apple Silicon）：

```bash
npm run package:mac
```

该命令会清理 `release/` 中旧的玉衡安装包和临时目录，重新构建并生成：

```text
release/玉衡-<version>-arm64.dmg
release/玉衡-<version>-arm64.zip
```

标准打包完成后会自动移除 `release/mac-arm64` 解压目录。需要检查未压缩应用时使用：

```bash
npm run package:mac:dir
```

输出为 `release/mac-arm64/玉衡.app`。`release/` 已加入 `.gitignore`，安装包不应提交到源码仓库。

图标修改后先运行：

```bash
npm run build:mac-icon
```

当前安装包未配置 Developer ID 签名和公证，适合内部 macOS arm64 分发。正式对外发布需要配置证书并完成 notarization。完整清单见 [`docs/macos-packaging.md`](docs/macos-packaging.md)。

## 常用检查

```bash
npm run typecheck
npm test
npm run build
```

Browser Use 是可选能力，需要额外安装 `uv`；Computer Use 在 macOS 14+ 需要 Accessibility 和 Screen Recording 权限。运行时 Provider、API Key 和可选能力均在应用设置中配置。

更多架构和产品约束见 [`docs/architecture-0.1.md`](docs/architecture-0.1.md)，版本记录见 [`CHANGELOG.md`](CHANGELOG.md)。
