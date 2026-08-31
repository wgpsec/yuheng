# 玉衡安装包体积优化设计

状态：Slice 1-2 已实施，Slice 3 已评估（保持不改）
目标版本：`0.3.x` 后续补丁

## 1. 背景与基线

当前 macOS arm64 未压缩应用约 442 MB，ZIP/DMG 约 149–151 MB。Electron Framework 约 274 MB，属于 Electron 运行时固定成本；Renderer 构建产物约 2.3 MB，不是主要问题。

`app.asar` 约 142 MB，主要来源是生产依赖目录。Vite 已将 React、Tiptap、Markdown 和图标代码打入 Renderer，但 electron-builder 仍会把它们作为 production dependency 原样带入应用。

## 2. 目标与约束

- 在不改变用户功能、Pi runtime、Provider 协议和数据格式的前提下减少安装包体积。
- macOS arm64 是当前唯一发布架构；不得影响开发、测试和 `npm run build`。
- 不手工删除依赖文件，不引入新的打包服务或运行时下载依赖。
- 每个切片都可独立回滚，并通过构建、启动和现有测试验证。

## 3. 实施切片

### Slice 1：分离 Renderer 依赖

将仅由 Vite Renderer 使用的依赖移到 `devDependencies`：React、ReactDOM、Lucide、Tiptap、React Markdown、remark-gfm 和 thinking-orbs。Electron 主进程依赖（Pi、MCP、TypeBox、备份压缩和 Computer Use）继续保留在 `dependencies`。

验收：

- `npm install`、`npm test`、`npm run typecheck`、`npm run build` 通过。
- `npm run package:mac:dir` 启动后主窗口、笔记、任务、对话和设置页面可用。
- 打包应用中不再包含上述纯 Renderer 依赖的完整 `node_modules` 目录。
- Renderer chunk 体积和运行时行为不回退。

实施记录：已将 Renderer-only 依赖移入 `devDependencies`，npm lockfile 与构建验证通过。该切片使 `app.asar` 从约 142 MB 降至约 94 MB。

### Slice 2：macOS arm64 原生资源裁剪

在 electron-builder 文件过滤中排除 Computer Use 的 Linux 和 macOS x64 预编译桥接程序，保留 macOS arm64 版本。过滤规则只作用于当前 arm64 打包目标，不修改 npm 包和开发目录。

验收：

- macOS arm64 打包应用仍可加载 Computer Use 扩展；未启用时启动不受影响。
- 应用内不包含 Linux/x64 bridge；构建不报缺失文件。
- arm64 `.app`、ZIP/DMG 体积较基线下降。

实施记录：electron-builder 过滤 Linux 与 macOS x64 bridge，保留 macOS arm64 bridge。未压缩 `.app` 从约 442 MB 降至约 382 MB，`app.asar.unpacked` 从约 21 MB 降至约 9.5 MB；v0.3.0 arm64 ZIP 约 140 MB、DMG 约 141 MB。

### Slice 3：依赖重复评估

仅做测量和运行时依赖图审查，评估 Pi 嵌套依赖是否可通过官方 npm dedupe 或上游打包方式减少。除非有明确运行时覆盖，否则不手工合并或删除嵌套依赖。

评估记录：electron-builder 报告 Pi/Provider 依赖存在多版本引用，但这些依赖由 Pi SDK 和 MCP/Provider 运行时共同使用；当前没有足够安全的官方 dedupe 边界，故本轮不改动，避免破坏模型调用、Computer Use 或会话恢复。

## 4. 发布门禁

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run package:mac:dir`
- 记录 `.app`、`app.asar` 和 ZIP/DMG 体积，与基线对比。
- macOS arm64 人工启动检查对话、笔记、任务、备份和设置。

## 5. 非目标

- 不替换 Electron 或 Pi runtime。
- 不改变应用架构、数据模型、Provider、Worker 或备份协议。
- 不引入在线按需下载依赖。
