# 玉衡 0.1 实现架构与技术选型

状态：已确认，进入 0.1 脚手架阶段

本文参考 `grok-bot-0.18-reconstructed-main` 的 React 渲染器、功能目录和界面层级，定义玉衡 0.1 的最小实现边界。参考其交互组织方式，不复制其源码、品牌、上游渲染器或重建工程。

## 1. 目标

玉衡 0.1 是一个面向个人的桌面秘书客户端，第一版应让用户可以：

- 在会话工作区中与模型持续对话；
- 管理多个会话，并从侧边栏快速切换、搜索和新建；
- 上传文件，让模型在明确授权范围内处理；
- 配置多个模型服务商并选择路由；
- 连接受用户信任的 MCP 服务，在调用前展示授权；
- 将对话中确认过的事项整理成待办或提醒；
- 在本地保留会话、设置、用量和待办，不依赖玉衡云端服务才能启动。

## 2. 选型结论

| 层 | 选择 | 原因 |
| --- | --- | --- |
| 桌面容器 | Electron | 与参考项目一致，Node 生态适合 MCP、流式 HTTP、子进程和文件处理；Mac arm64 开发和发布路径成熟。 |
| UI | React 19 + TypeScript | 与参考项目保持一致，便于复用其交互设计、组件组织和 Electron 渲染器边界；生态和桌面端案例成熟。 |
| 构建 | Vite | 开发反馈快，生产资源可使用相对路径打包进 `app.asar`。 |
| 本地数据库 | SQLite，优先使用 Electron 所带 Node 的 `node:sqlite` | 不引入额外数据库服务；主进程独占写入，便于备份和迁移。若目标 Electron 版本不提供稳定 `node:sqlite`，再评估 `better-sqlite3`，不得在首轮同时引入两套驱动。 |
| 密钥 | Electron `safeStorage` + 主进程文件 | Renderer 不接触明文密钥；密钥文件由主进程权限和系统用户边界保护。 |
| MCP | `@modelcontextprotocol/sdk`，主进程统一管理 stdio/HTTP 连接 | 复用成熟协议实现；工具发现、调用、超时、取消和审批集中在可信边界。 |
| 测试 | Vitest、Playwright、Node 原生测试 | UI 用公开行为测试；主进程和协议用单元/合同测试；关键流程再用 Playwright。 |
| 首发平台 | macOS 13+ arm64 | 0.1 只发布 Apple Silicon 构建；Windows、Linux、macOS x64、Universal Binary 均不在本版范围。 |

Electron 是 0.1 的确定选择。Tauri、Windows、Linux、macOS x64 和 Universal Binary 均留到后续版本评估，不在首版引入额外平台边界。

## 3. 前端架构参考

玉衡前端应直接借鉴参考项目的这些组织方式：

- `ProductionRenderer` 式根组合：只由一个根组件负责窗口级状态、当前会话、overlay 路由、连接状态和 feature controller 的组装；
- feature-first 目录：按 `conversation/workspace`、`settings/overlay`、`tasks`、`mcp` 等用户能力分目录，而不是按 Button、Modal 等纯视觉类型平铺；
- `model`、`controller`、`view` 分离：model 负责投影和校验，controller 负责异步生命周期，view 只接收 props 和回调；
- typed desktop bridge：Renderer 只依赖 `DesktopBridge`、`MainRpc` 等显式合同，不能直接导入 Electron 或 Node；
- 外部事件采用订阅源：会话流、连接状态、设置变更和提醒都通过可取消的 source/store 暴露，组件卸载时必须解除订阅；
- UI primitives 统一收口：按钮、图标、菜单、弹层、状态徽标和 spinner 由 `ui/` 提供，业务 feature 不重复实现桌面交互细节。

玉衡不复制参考项目的 `recovered/`、证据注释或上游 renderer overlay 机制；这些属于重建工程，不是产品架构。

建议的源码布局：

```text
frontend/src/
  main.tsx
  production/ProductionRenderer.tsx       # 根组合与窗口级状态
  contracts/desktop-bridge.ts              # preload -> renderer 合同
  contracts/main-rpc.ts                    # 主进程 RPC 合同
  features/
    conversation/workspace/
      model.ts controller.ts view.tsx
      sidebar.tsx transcript.tsx composer.tsx
    settings/overlay/
      model.ts desktop.ts panels.tsx view.tsx
    tasks/                                  # 今日待办与提醒
    mcp/                                    # 服务器与工具审批
  ui/                                       # Button、IconButton、Menu、Dialog 等基础控件
  styles/                                   # 主题 token、窗口和工作区 CSS
```

根组件只组装依赖和路由，不承载每个 feature 的业务细节。会话切换时由 workspace controller 变更 scope，先取消旧订阅，再加载新 snapshot；流式事件必须通过 `conversation_id + run_id` 校验后才进入 Transcript。Settings overlay 按 section 懒加载，加载失败提供原地 Retry，不让整个窗口崩溃。

参考项目的可复用交互细节：

- 侧栏顶部固定 New/Search，列表按最近活动排序，支持置顶、归档和快捷操作；
- 会话头部显示身份和 Working 状态，右侧按钮打开详情/工具/设备面板；
- Transcript 保持稳定滚动容器，Composer 固定在底部，附件和语音等扩展不改变主布局高度；
- Settings 使用左侧 section 导航、右侧内容面板和统一 notice/error surface；
- Command Palette 作为跨 feature 的键盘入口，命令只调用 controller，不直接修改组件状态；
- 空工作区、连接中、连接断开、加载失败和运行中都有独立的可访问状态，不用同一个 spinner 代替所有状态。

## 4. 进程边界

```text
React Renderer
  | 仅通过类型化 preload API
  v
Electron Preload
  | 白名单 IPC，不暴露 node/eval/任意发送器
  v
Electron Main
  |-- SQLite store（会话、待办、设置、用量）
  |-- Secret store（safeStorage 加密后的 provider/MCP 凭据）
  |-- Pi Agent SDK runtime（Provider 适配、Agent loop、工具执行和流式输出）
  |-- MCP supervisor（后续版本；0.1 尚未接入）
  |-- Attachment service（文件校验、临时目录、清理）
  |-- Reminder scheduler（本地提醒，不执行隐式外部写操作）
  `-- 可选 utility process（仅用于长任务或不可信解析）
```

硬边界：

- Renderer 不读取密钥、不直接访问 Provider/MCP URL、不直接写 SQLite；
- Main 是所有外部网络、子进程和本地持久化的写入所有者；
- 每次模型运行都有不可变 `run_id`，事件携带 `run_id`，旧事件不得覆盖新会话状态；
- MCP 工具默认需要用户确认，读操作和写操作使用不同的审批文案；
- 失败、取消、超时都必须产生终态事件，不能让界面永久显示运行中。

0.1 不建立类似参考项目的远程 coordinator、box daemon、Docker sandbox 或多节点 Worker。需要隔离的本地执行先使用独立 utility process；只有出现真实资源或安全需求时再拆分服务。

## 5. 功能模块

### 5.1 会话工作区

- 左侧会话列表：搜索、新建、置顶、归档、未读/运行状态；
- 顶部会话身份和运行状态；
- 中央消息流：流式文本、思考状态、Markdown、代码、文件卡片、工具调用卡片；
- 底部 Composer：文本、拖拽附件、取消运行、重试和继续；
- 右侧上下文面板：待办、会话大纲、运行详情，默认可收起。

参考项目的深色紧凑三段式布局适合作为信息架构，但玉衡不复制其视觉资产。默认采用克制的中性色、清晰的运行/等待/失败语义和可键盘操作的控件。

0.1 当前已实现附件选择和发送：支持文本类文件（txt、md、csv、json、js、ts、py、html、css）和常见图片（png、jpg、jpeg、gif、webp），单文件不超过 10 MB、单次选择总量不超过 20 MB。附件内容只在主进程内存中保留到本次运行结束，不写入 SQLite、不向 Renderer 暴露本地路径；移除附件、切换会话或运行终态会释放对应内容。附件元数据持久化和拖拽导入留到后续版本。

### 5.2 秘书域

首版只做轻量本地秘书能力：

- 从用户明确确认的消息生成待办；
- 待办支持状态、截止时间、提醒时间和来源会话；
- 今日视图展示即将到期事项；
- 提醒到期只做系统通知和应用内提示；
- 不自动发送邮件、修改第三方日历或执行不可逆外部操作。

### 5.3 Provider 与 MCP

- Provider profile 与会话解耦；会话保存使用的 profile 快照标识；
- 0.1 支持 OpenAI-compatible 和 Anthropic Messages 两种协议；
- 路由器只负责选择已配置 Provider，不把 Provider 选择写进秘书业务数据；
- MCP 管理包含连接测试、工具目录、按工具审批和运行中取消；
- 连接失败只影响对应 MCP，不阻断普通无工具对话。

## 6. 推荐界面布局

```text
+----------------------+-----------------------------------+------------------+
| 玉衡 / 会话列表       | 会话标题 + 运行状态                | 上下文（可选）      |
| 搜索                  +-----------------------------------+------------------+
| + 新会话              | 消息时间线                         | 今日待办           |
| 最近 / 已归档          |                                   | 会话大纲           |
| 会话行（状态、预览）   |                                   | 工具/运行详情       |
|                       +-----------------------------------+------------------+
| 设置 / Provider / MCP | Composer + 附件 + 发送/取消         |                  |
+----------------------+-----------------------------------+------------------+
```

桌面最小窗口建议 `1120 x 720`；侧栏可收缩到图标轨；上下文面板在窄窗口自动变成抽屉。布局稳定优先于装饰，不使用持续动画表达状态，运行状态必须同时有文字和语义色。

## 7. 本地数据模型

0.1 只需要以下实体，不新增独立服务：

- `conversations`：会话身份、标题、归档/置顶和更新时间；
- `messages`：角色、内容、运行标识和创建时间；0.1 附件不作为持久化实体，仅在运行请求中传递；
- `runs`：`run_id`、Provider profile、状态、错误分类、开始/结束时间；
- `tasks`：待办内容、状态、截止时间、提醒时间、来源消息；
- `provider_profiles`：协议、地址、模型和非敏感显示信息；
- `mcp_servers`：连接类型、地址/命令、启用状态和工具审批策略；
- `usage_events`：请求、输入/输出 token、Provider 和时间；
- `app_settings`：主题、布局、默认 Provider 和通知偏好。

密钥、OAuth refresh token 和 MCP 环境变量不进入上述普通表的 JSON 字段，统一存放在主进程拥有的加密 secret store。所有表都使用迁移版本，启动时执行有界迁移和 SQLite quick check。

## 8. 运行事件合同

主进程向 Renderer 发布类型化事件：

- `run:accepted`：已创建 `run_id`；
- `run:delta`：增量文本或思考片段；
- `run:tool-requested`：待用户确认的 MCP 工具调用；
- `run:tool-result`：工具结果或稳定错误；
- `run:completed`、`run:failed`、`run:cancelled`：唯一终态；
- `task:changed`、`reminder:due`、`settings:changed`：本地领域更新。

所有事件都包含 `conversation_id`；运行事件还包含 `run_id`。Renderer 只接受当前会话、当前运行代次的事件，重启后通过 snapshot 重新投影，不依赖事件日志恢复全部状态。

## 9. 0.1 实施顺序

1. Electron 壳、preload 白名单、React 工作区静态布局和主题。
2. SQLite 迁移、会话列表、消息持久化和本地搜索。
3. Provider profile、流式对话、取消/重试和终态投影。
4. 文件附件校验、临时文件生命周期和 Markdown/代码渲染。
5. MCP 连接、工具目录、审批卡片和调用取消。
6. 待办/提醒的确认式提取、今日视图和系统通知。
7. 设置、用量、导入导出、崩溃恢复和 macOS arm64 打包。

每一步都先补公开行为测试，再扩大到跨进程 Playwright 流程。没有经过真实使用验证的 Provider、MCP 或秘书自动化不提前抽象成平台框架。

## 10. macOS 发布与安全边界

- 目标系统为 macOS 13 Ventura 及以上，发布 Apple Silicon arm64 `.dmg`；
- 发布包使用 Apple Developer ID 签名并 notarize；开发阶段允许未签名运行；
- 0.1 使用 Electron Hardened Runtime，但暂不启用完整 App Sandbox，以保留用户配置的本地 stdio MCP 子进程能力；
- MCP 命令只能由主进程按用户明确配置启动，Renderer 不得启动任意进程；
- 凭据使用 macOS Keychain-backed `safeStorage`，应用数据位于用户的 Application Support 目录；
- 暂不实现自动更新，先完成手动安装、升级和卸载验证。

## 11. 非目标与风险

- 不复刻参考项目的上游 renderer、反编译产物或专有服务；
- 不在 0.1 引入账号体系、云同步、团队协作、远程执行和 Docker 沙箱；
- 不允许模型默认执行发送消息、删除数据、修改日历等高影响动作；
- Electron 的体积和安全更新是持续维护成本，发布前必须固定版本、签名并运行依赖审计；
- 不为 Windows、Linux 或 Intel Mac 添加条件分支；后续扩展平台时单独建立构建和验证矩阵；
- `node:sqlite` 的 Electron 运行时支持需在脚手架阶段验证，若不满足再单独评估数据库驱动，不并行维护两套实现。

## 12. 验收门槛

- 断网时可打开应用、查看本地会话和待办；
- 一次运行从 accepted 到 completed/failed/cancelled 必有终态；
- Provider/MCP 密钥不会出现在 Renderer、普通日志、SQLite 业务表或导出文件中；
- 旧运行事件不会覆盖新运行，应用重启后不会重复发送消息或重复调用工具；
- macOS 13+ arm64 可安装、启动、升级和卸载；
- 关键键盘路径、窗口缩放和 `prefers-reduced-motion` 通过 Playwright 验证。
