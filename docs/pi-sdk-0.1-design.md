# 玉衡 0.1 Pi SDK 接入设计

状态：已按 TDD 实施，待最终验收

## 1. 目标

将玉衡当前的一次性 `streamProvider()` 调用替换为 Pi Agent SDK，作为 0.1 唯一的 Agent runtime。玉衡继续负责桌面产品层，Pi 负责 Agent loop、Provider 调用、默认工具、session 和事件流。

本次只接入 Pi SDK，不实现 MCP、秘书任务、提醒或云同步。

## 2. 采用的包

- `@earendil-works/pi-coding-agent`：使用其 SDK 的 `createAgentSession()`、`AgentSession` 和 session 管理能力；
- 由 SDK 间接使用 `@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai`；
- 依赖使用发布版本并固定精确版本号，实施时记录实际版本和 lockfile 变更。

Pi 当前要求 Node `>=22.19.0`。玉衡 Electron 42 当前内置 Node `24.18.1`，满足运行要求。

## 3. 运行边界

```text
React Renderer
  ↓ typed preload
Electron Main
  ↓ PiRuntime adapter
Pi AgentSession
  ├─ Agent loop
  ├─ Provider/model
  ├─ read / write / edit / bash
  └─ session/event stream
```

### Pi 负责

- 多轮模型调用和工具调用循环；
- `read`、`write`、`edit`、`bash` 默认工具；
- Provider 请求、流式输出、thinking 和 token usage；
- Agent session 的消息状态、continue、abort 和 compaction；
- Agent 生命周期与工具执行事件。

### 玉衡负责

- Electron 窗口、preload 白名单和 React UI；
- SQLite 中的会话、消息和运行投影；
- API Key 的主进程 `secrets.json` 管理；
- 附件选择、大小校验、主进程内存生命周期；
- 将 Pi 事件转换为现有 `run:event` 合同；
- 运行取消、错误展示和应用重启后的本地状态恢复。

Pi 不直接访问玉衡 SQLite，不直接向 Renderer 发送 IPC，也不持有玉衡的产品状态写入权限。

## 4. PiRuntime adapter

新增主进程模块 `electron/pi-runtime.ts`，只定义玉衡需要的最小边界：

```ts
type PiRuntime = {
  start(input: StartInput): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
};
```

`StartInput` 包含：

- 当前会话消息；
- 当前 Provider 配置和 API Key resolver；
- 当前运行的附件；
- `AbortSignal`；
- Pi session 目录或内存 session 配置；
- 向玉衡发布规范化事件的 callback。

adapter 只做三件事：

1. 创建或恢复 Pi session；
2. 把 Pi 事件映射成玉衡事件；
3. 在终态后释放 Pi session 和临时资源。

不抽象第二种 Agent runtime，不在本次引入通用插件系统。

## 5. 工具策略

0.1 默认启用 Pi 的：

- `read`；
- `write`；
- `edit`；
- `bash`。

不增加逐工具审批弹窗，不修改 Pi 默认工具实现。工作目录由玉衡传入，默认使用用户明确选择的工作区；未选择工作区时使用玉衡专用本地工作目录。

API Key 通过 Pi 的运行时配置或 resolver 传入，不写入环境变量，避免被 `bash` 工具读取。

Pi 默认的 `AGENTS.md`、skills、extensions 发现必须在 adapter 中显式配置范围。0.1 默认不从用户 Home 目录加载隐式资源，只加载玉衡明确允许的工作区资源。

## 6. Provider 映射

现有设置页继续保留：

- 协议；
- Base URL；
- 模型；
- 显示名称；
- API Key。

adapter 将现有 Provider 配置转换为 Pi model。优先使用 Pi 已支持的内建 Provider；自定义 OpenAI-compatible 地址使用 Pi 的 custom provider/model 配置能力。不能映射的配置在启动运行前返回明确错误，不再回退到旧 `fetch` 实现。

当前支持的 OpenAI-compatible 和 Anthropic Messages 都必须保留。

## 7. 消息、附件和 session

### 消息

- SQLite 仍保存玉衡自己的 user/assistant 消息；
- Pi session 是运行时上下文，不取代玉衡消息表；
- Pi 产生的 tool call 和 tool result 先由 adapter 转为事件，是否展示由玉衡 Renderer 决定；
- 旧 SQLite 数据可直接加载，不要求一次性迁移历史消息。

### 附件

- 文本附件转换为 Pi user message 的文本内容；
- 图片附件转换为 Pi 支持的 image content；
- 附件内容只保留在主进程内存中；
- Pi session 文件不得持久化 API Key 或未授权的附件原始内容；
- 运行完成、失败、取消时清理附件内存。

### Session

- 一个玉衡会话对应一个稳定的 Pi session identity；
- 一个玉衡 run 对应一次 `prompt()`；
- 运行中取消调用 Pi `abort()`；
- 运行失败不自动重放 Provider；
- 应用重启后先将玉衡 `running` 标记为 `interrupted`，不自动重放 Pi prompt；
- 后续显式重试再基于原始 user message 创建新的 run。

## 8. 事件映射

Pi 事件映射到现有玉衡事件：

| Pi 事件 | 玉衡事件 |
| --- | --- |
| prompt accepted / agent_start | `accepted` |
| assistant text delta | `delta` |
| tool execution start/update/end | 0.1 先映射为运行状态，不新增 Renderer IPC 类型 |
| agent_end (`willRetry=false`) | `completed` |
| provider/agent error | `failed` |
| abort | `cancelled` |

所有事件必须携带当前 `runId` 和 `conversationId`。旧 session 或旧 run 的事件不得更新当前会话 UI。

0.1 暂不新增独立的 tool card、usage card 或 thinking card；先保证文本流和终态稳定。

## 9. 失败与兼容策略

- Pi 初始化失败：不创建 Worker/Provider 请求，run 进入 `failed`；
- Provider 配置不能映射：返回可读错误，保留用户输入和附件以便重试；
- Pi 工具失败：交给 Pi 继续其既定 Agent loop，最终由 agent 事件决定终态；
- 用户取消：调用 `abort()`，等待 Pi 结束后再写入 `cancelled`；
- Pi 运行时异常：写入 `failed`，清理 session 和附件，不回退旧 `streamProvider()`；
- 同一会话同时只允许一个 active run。

## 10. 实施结果

- `electron/pi-runtime.ts` 已提供 Pi SDK session factory，并通过动态 ESM 加载兼容 Electron CommonJS 主进程；
- `electron/main.ts` 的 `runs:start` 已切换到 Pi，保留现有 SQLite 与 `run:event` 合同；
- OpenAI-compatible 与 Anthropic 模型均通过 `ModelRuntime.registerProvider()` 注册；
- 默认 `read`、`write`、`edit`、`bash` 工具启用，资源 loader 关闭隐式 extensions、skills、prompt templates 和 themes；
- 文本附件以内联文本传入，图片附件以 Pi image content 传入；
- 取消、失败、重启 interrupted 和终态资源清理语义已保留。

## 11. 实施顺序

1. 固定并安装 Pi SDK 依赖，验证 Electron 主进程可加载 ESM 包；
2. 新增 PiRuntime adapter 和最小 text-only prompt；
3. 将现有 `runs:start` 切换到 Pi，保留现有 run/event/SQLite 合同；
4. 接入默认工具和工作目录；
5. 接入文本、图片附件；
6. 接入 abort、失败和重启 interrupted 语义；
7. 移除旧 `streamProvider()` 调用路径及不再使用的 SSE 解析代码；
8. 更新架构文档和本地运行说明。

## 12. 验收矩阵

- 纯文本 prompt 能收到连续 `delta` 并最终 `completed`；
- Pi 调用 `read/write/edit/bash` 时，UI 不崩溃，运行有明确终态；
- OpenAI-compatible 和 Anthropic 配置均可运行；
- 图片和文本附件均能到达 Pi；
- 取消运行不会留下 `running`；
- Provider 错误、Pi 初始化错误、工具错误均能展示可读失败信息；
- 应用重启后遗留 run 显示 `interrupted`，不会自动重复调用模型；
- API Key 不出现在 Renderer、SQLite、环境变量和普通日志；
- session、附件和 active run 在终态后释放；
- `npm run typecheck`、`npm run build`、`git diff --check` 通过；
- 使用 mock Provider 完成 SDK event、tool event、abort 和 attachment 回归。

当前回归记录：`npm test` 11 passed；`npm run typecheck`、`npm run build`、`git diff --check` 通过。另有本地 mock OpenAI-compatible
请求验证路由、认证头、模型字段、默认工具和流式文本事件。

## 13. 本次不做

- MCP 连接和工具目录；Pi 本身不内置 MCP，后续另行设计 Pi extension/tool bridge；
- 新增数据库表或字段；
- 云端 session 同步；
- 多 Agent、子 Agent、计划模式；
- 自动审批高风险工具；
- Windows、Linux、Intel Mac 或 Universal Binary；
- Pi CLI/RPC 子进程模式；0.1 先在 Electron 主进程内通过 SDK 集成。

## 14. 主要风险

1. Pi SDK 是 ESM 包，而玉衡 Electron 主进程当前使用 CommonJS 编译，需要通过动态 `import()` 或调整主进程构建配置解决。
2. Pi 的 coding-agent 默认偏向代码工作流，资源发现和系统提示必须显式限制，避免本地隐式指令污染秘书会话。
3. Pi 运行时具备 shell 和文件写入能力，工作目录和 API Key 注入方式必须保持可控。
4. Pi session 与玉衡 SQLite 是两套状态，adapter 必须保证终态和取消时不会出现一边完成、一边永久运行的投影分歧。

若以上风险在最小 Spike 中无法闭合，停止替换，不保留双 runtime 长期并行。
