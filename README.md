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

会话运行需要先在应用设置中配置 OpenAI-compatible 或 Anthropic Provider 与 API Key。Pi 默认启用 `read`、`write`、`edit`、`bash` 工具，工作目录位于应用数据目录。

项目已通过 `.npmrc` 使用 `registry.npmmirror.com`，启动脚本同时设置 Electron 二进制镜像。不会修改机器的全局 npm 配置。

0.1 的实现架构和技术选型见 [`docs/architecture-0.1.md`](docs/architecture-0.1.md)。
