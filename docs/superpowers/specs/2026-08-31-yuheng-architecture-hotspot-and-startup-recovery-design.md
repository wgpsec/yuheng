# 玉衡架构热点拆分与数据迁移、启动恢复设计

状态：设计已确认，待分 Slice 实施

目标版本：`0.4.x`

## 1. 背景

玉衡当前功能已覆盖会话、Agent Run、Provider、任务、笔记、完整备份、桌面 Pet、提醒和多种本地工具。功能增长主要集中在少数入口文件中：

- `electron/main.ts` 同时承担 Electron 生命周期、资源初始化、窗口、托盘、协议、Run、审批、提醒、备份和约 80 个 IPC 注册。
- `electron/store.ts` 中的 `AppStore` 同时承担数据库打开、建表、兼容迁移、种子数据、搜索索引、全部领域 CRUD 和备份快照。
- `frontend/src/production/ProductionRenderer.tsx` 同时承担窗口状态、多个工作区状态、事件订阅和界面组合。
- `frontend/src/styles/global.css` 集中保存全局、窗口和各功能样式。

热点集中本身不会立即造成用户故障，但会持续放大以下长期风险：

1. 修改一个领域时需要理解并验证多个无关领域，局部改动缺少局部性。
2. 生命周期、资源所有权和关闭顺序依赖隐式全局变量，异常路径难以验证。
3. 数据库迁移夹在 `AppStore` 构造函数中，没有独立接口、迁移历史和恢复接缝。
4. 启动期间一旦数据库打开、迁移或资源初始化失败，正常窗口尚未创建，也没有恢复入口。
5. 当前 `.yuheng` 备份是逻辑数据的合并导入格式，不是数据库升级前的原始回滚快照。

本设计只解决两个优先事项：

1. 数据迁移和启动恢复安全。
2. 架构热点拆分和资源所有权收口。

其他长期运维问题在这两个事项完成后再单独设计。

## 2. 设计目标

### 2.1 数据安全目标

- 所有生产数据库迁移都有确定顺序、迁移历史和可验证的迁移前快照。
- 任一迁移失败都不会打开正常工作区，也不会继续初始化 Agent、提醒或业务 IPC。
- 新版本数据库不会被旧版本迁移逻辑静默降级或覆盖。
- 迁移失败、进程崩溃或初始化失败后，用户始终有明确、可操作的恢复界面。
- 恢复操作不会覆盖唯一数据库副本；失败数据库必须先隔离保存。

### 2.2 架构目标

- `main.ts` 只负责 Electron 生命周期、依赖组装和启动结果分流。
- 数据库启动、迁移、完整性验证和恢复形成一个深模块，对调用者暴露小而稳定的接口。
- IPC 按领域注册，每个注册模块只接收所需依赖。
- Run、审批、窗口、协议和关闭流程拥有明确状态及资源所有者。
- `AppStore` 先保留兼容接口，再逐步委托给领域 repository，避免一次性改动全部调用者。
- `ProductionRenderer` 回到窗口级组合职责，功能状态和异步生命周期归属各自 controller。
- 用户可见功能、现有数据格式、Desktop Bridge 合同和界面行为保持不变。

## 3. 不变边界

- 继续使用 Electron 主进程独占写入的 SQLite，不更换数据库、不引入 ORM、不并行维护第二套驱动。
- Renderer 不直接访问 SQLite、文件系统、Provider 或 Electron 任意 IPC。
- 不借架构拆分重新设计产品界面、修改交互语义或更换样式技术。
- 不把 schema 变更与无关功能开发混入同一个提交。
- 不自动恢复、不自动覆盖失败数据库、不自动执行数据库降级。
- 不恢复未完成的 Agent Run，也不在恢复过程中调用 Provider、工具或发送提醒。
- 不创建只有转发作用的浅模块；只有能隐藏状态、顺序、错误模式或事务细节的模块才值得抽取。
- 永远不创建或使用独立分支、Git Worktree。全部工作在当前工作区完成，只暂存和提交本设计范围内的文件或 hunk，不处理、不回退同事的未提交修改。

## 4. 总体实施顺序

实施必须先完成数据迁移和启动恢复底座，再拆主进程和 Store 热点：

```text
现状行为固化
  -> 迁移 registry 与兼容迁移
  -> 原始快照与完整性检查
  -> StartupCoordinator 与 RecoveryWindow
  -> IPC 领域拆分
  -> Run / Window / Protocol 生命周期拆分
  -> AppStore 内部 repository 拆分
  -> Renderer controller 与 CSS 拆分
```

原因是迁移系统决定数据库和资源的启动所有权。如果先拆 `main.ts` 和 `AppStore`，随后再引入启动状态机，会重复移动同一批代码并扩大回归面。

Slice 1 至 Slice 4 是同一发布门槛。在 Slice 4 完成前，Slice 2 和 Slice 3 的新能力只通过测试和内部接口验证，不单独发布半完成的迁移路径。

## 5. 目标模块结构

```text
electron/
  app/
    startup-coordinator.ts
    startup-result.ts
    app-context.ts
    shutdown-coordinator.ts
  storage/
    database.ts
    schema.ts
    migration-runner.ts
    migration-backup.ts
    integrity-check.ts
    recovery-store.ts
    migrations/
      001-baseline.ts
      002-normalize-legacy-v1.ts
    repositories/
      conversation-repository.ts
      run-repository.ts
      task-repository.ts
      note-repository.ts
      provider-repository.ts
      settings-repository.ts
      search-repository.ts
      backup-repository.ts
  ipc/
    register-app-ipc.ts
    register-conversation-ipc.ts
    register-note-ipc.ts
    register-task-ipc.ts
    register-run-ipc.ts
    register-provider-ipc.ts
    register-backup-ipc.ts
    register-pet-ipc.ts
  runs/
    run-coordinator.ts
    approval-coordinator.ts
  windows/
    main-window.ts
    recovery-window.ts
    pet-window.ts
  protocols/
    register-managed-protocols.ts
```

Frontend 后续目标结构：

```text
frontend/src/
  production/
    ProductionRenderer.tsx
    use-window-shell.ts
  features/
    conversation/use-conversation-workspace.ts
    tasks/use-task-workspace.ts
    notes/use-notes-workspace.ts
    settings/use-settings-controller.ts
  styles/
    tokens.css
    base.css
    shell.css
    themes.css
```

功能样式优先与功能放在一起，例如 `features/tasks/tasks.css`。CSS 通过一个稳定入口按固定顺序导入，避免拆分后层叠顺序变化。

## 6. 数据库模块设计

### 6.1 Database 所有权

`DatabaseOwner` 是 SQLite 连接和事务的唯一所有者。它负责：

- 打开和关闭连接。
- 设置 `journal_mode`、`foreign_keys`、`busy_timeout` 等固定 pragma。
- 提供同步事务执行入口。
- 禁止 repository 自行创建连接。
- 在迁移、恢复和正常运行之间保证同一时间只有一种数据库模式。

正常业务 repository 接收已经完成迁移和验证的数据库句柄。调用者不能通过 repository 触发 schema 变更。

### 6.2 迁移定义

每个迁移使用不可变定义：

```ts
type Migration = {
  version: number;
  name: string;
  checksum: string;
  up(db: DatabaseConnection): void;
};
```

约束：

- 版本必须从 1 开始连续递增，不能跳号、重复或动态排序。
- 已发布迁移文件不可修改。需要修正时新增下一版本迁移。
- `checksum` 在构建或测试中由稳定迁移内容计算，用于检测发布文件被修改。
- 不提供自动 `down()`。桌面本地数据降级必须通过恢复迁移前快照完成。
- 一次迁移只负责一组关联的 schema 或数据归一化，不混入功能初始化。

### 6.3 迁移账本

新增表：

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  app_version TEXT NOT NULL,
  source TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

`source` 区分 `applied` 和 `adopted`：

- `applied` 表示由新迁移执行器实际执行。
- `adopted` 表示旧版数据库已被识别为历史 baseline，迁移执行器接管其版本记录。

`PRAGMA user_version` 继续作为快速版本标记，但不再是唯一事实来源。迁移完成后必须同时满足：

- `user_version` 等于最高账本版本。
- 账本版本连续。
- 已发布迁移的名称和 checksum 与账本一致。
- schema invariants 全部通过。

### 6.4 版本 1 兼容策略

当前 `CURRENT_SCHEMA_VERSION = 1`，但实际版本 1 数据库可能因为历史补列逻辑具有不同结构。因此不能把“版本号为 1”当成“结构完全相同”。

迁移接管规则：

1. 空数据库从版本 0 执行 `001-baseline`，再执行 `002-normalize-legacy-v1`。
2. 现有 `user_version = 1` 且没有账本的数据库，先验证它属于玉衡可识别的旧 schema。
3. 验证通过后，在事务中写入版本 1 的 `adopted` 账本记录。
4. 执行版本 2 兼容归一化，补齐或重建旧 Provider、Run、Task、Note、Artifact 等结构。
5. 版本 2 不引入与当前功能无关的新业务字段，只把当前实际 schema 固化为可验证基线。
6. 无法识别的版本 1 结构进入恢复模式，禁止猜测性修改。

### 6.5 单次迁移事务

每个迁移执行以下原子流程：

```text
BEGIN IMMEDIATE
  -> 执行 migration.up
  -> 验证该版本的局部 schema invariants
  -> 插入 schema_migrations
  -> 更新 PRAGMA user_version
COMMIT
```

任一步抛错立即 `ROLLBACK`。迁移执行器关闭当前连接，并把稳定错误分类返回 StartupCoordinator，不继续执行后续迁移。

不把所有迁移包在一个超大事务中。单迁移事务便于定位错误，也避免大数据库升级时长期持有不可解释的整体事务。

## 7. 迁移前原始快照

### 7.1 与 `.yuheng` 备份的区别

`.yuheng` 是经过校验的逻辑导出和合并导入格式，适合用户迁移数据，但不会覆盖当前数据库。迁移前快照是 SQLite 原始恢复点，只用于升级失败后的本机回滚。两者不能互相替代。

### 7.2 创建条件

只有以下条件全部满足时才能创建迁移前快照：

- 当前 schema 版本低于应用支持版本，确实存在待执行迁移。
- 数据库可以打开并完成预迁移完整性检查。
- 数据目录可写。
- 可用空间足以同时保存数据库、WAL、临时快照和安全余量。
- 当前没有正常业务资源、Run、提醒或自动备份被初始化。

如果数据库已损坏，可以额外复制一份 `unhealthy` 隔离副本用于诊断，但不得把它标记为 known-good 快照。

### 7.3 创建协议

```text
打开唯一启动连接
  -> PRAGMA quick_check
  -> PRAGMA foreign_key_check
  -> checkpoint WAL
  -> 使用 SQLite backup 能力创建临时快照
  -> 关闭并重新打开快照做只读校验
  -> 计算 SHA-256
  -> fsync 文件和目录
  -> 原子重命名
  -> 写入快照 metadata
```

如果当前 Electron 所带 `node:sqlite` 不提供可用 backup 接口，则允许在成功 checkpoint 且关闭连接后复制主数据库文件。这个适配器必须有独立故障注入测试，不能直接复制仍可能写入的 DB、WAL 和 SHM 组合。

### 7.4 快照目录与保留

建议目录：

```text
userData/recovery/
  snapshots/
    2026-08-31T120000Z-v1-to-v2.sqlite
    2026-08-31T120000Z-v1-to-v2.json
  failed/
  diagnostics/
  migration-attempt.json
```

metadata 至少包含：

- 快照文件名和 SHA-256。
- 来源 schema 版本、目标 schema 版本。
- 应用版本、创建时间和原数据库大小。
- `quick_check` 和外键检查结果。
- 快照状态：`verified`、`restored`、`unhealthy` 或 `invalid`。

默认保留最近 5 份已验证快照。清理时遵守：

- 永远不删除唯一一份已验证快照。
- 不删除当前未完成迁移所引用的快照。
- 只删除 metadata 与文件哈希匹配、且路径位于受控目录内的目标。
- 清理失败不阻断正常启动，但必须记录脱敏诊断。

## 8. 完整性检查

### 8.1 预迁移检查

- 数据库文件是普通文件，不是符号链接。
- 数据目录权限和文件权限符合应用要求。
- `PRAGMA quick_check` 返回 `ok`。
- `PRAGMA foreign_key_check` 无记录。
- `user_version` 是非负整数且不高于应用支持版本。
- schema 中没有与关键玉衡表同名但形状不可识别的对象。
- 账本存在时版本、名称和 checksum 一致。

### 8.2 迁移后检查

- 再次执行 `quick_check` 和 `foreign_key_check`。
- 验证必需表、列、索引、外键和 CHECK 约束。
- 验证默认会话项目、任务看板和任务类型等种子数据 invariants。
- 验证 FTS 可创建或明确降级为无全文索引模式，不能让搜索初始化异常污染迁移结果。
- 验证账本最高版本和 `user_version` 等于应用支持版本。

迁移后验证失败与迁移执行失败等价，必须进入恢复模式。即使 SQLite 事务已经提交，也不能开放正常工作区；用户可以恢复迁移前快照。

## 9. 启动状态机

### 9.1 状态定义

```text
starting
  -> preflight
  -> checking
  -> snapshotting       仅有待执行迁移时
  -> migrating          仅有待执行迁移时
  -> verifying
  -> initializing
  -> ready

任一状态失败 -> recovery_required
```

`StartupCoordinator.start()` 返回类型化结果：

```ts
type StartupResult =
  | { status: 'ready'; context: AppContext }
  | { status: 'recovery_required'; failure: StartupFailure };
```

`StartupFailure` 使用稳定分类而不是把底层异常文本直接暴露给 Renderer：

- `storage_unavailable`
- `database_corrupt`
- `schema_too_new`
- `snapshot_failed`
- `migration_failed`
- `verification_failed`
- `initialization_failed`
- `interrupted_migration`

每个错误携带失败阶段、可重试性、当前版本、目标版本、诊断 ID 和安全用户文案。SQL、路径、密钥和工具输入不直接进入 UI。

### 9.2 初始化门禁

进入 `ready` 前禁止：

- 注册正常业务 IPC。
- 创建主窗口、Pet、托盘和系统通知。
- 启动 Agent runtime、Browser Use、Computer Use 或 MCP。
- 注册受控文件协议。
- 恢复运行中 Run、调度任务提醒或启动自动备份。

进入 `ready` 后由 `AppContext` 按固定顺序初始化资源。任何资源初始化失败都触发逆序关闭；如果数据库已经验证成功但非数据库资源失败，恢复界面应提示“应用初始化失败”，不能误报为数据库损坏。

### 9.3 迁移中断记录

`migration-attempt.json` 位于数据库外部，记录：

- attempt ID。
- 应用版本、来源和目标 schema 版本。
- 当前迁移版本和阶段。
- 快照文件及哈希。
- 开始时间、最后更新时间和完成状态。

写入使用临时文件加原子重命名。成功进入 `ready` 后标记完成，再按保留策略清理。启动时发现未完成记录，先验证数据库和快照状态，并返回 `interrupted_migration`，不得直接假设事务回滚已经足够。

## 10. 恢复窗口

### 10.1 安全接口

RecoveryWindow 使用独立 preload，只暴露：

- `recovery:get-status`
- `recovery:retry`
- `recovery:list-snapshots`
- `recovery:restore-snapshot`
- `recovery:export-diagnostics`
- `recovery:open-data-directory`
- `recovery:open-log-directory`
- `recovery:quit`

恢复模式不注册任何会话、任务、笔记、Provider、Run、备份导入或工具审批 IPC，也不加载正常 Desktop Bridge。

### 10.2 恢复操作

#### 重试启动

- 先关闭上一次残留的启动资源。
- 重新执行完整 preflight、检查和状态机。
- 不跳过快照、迁移或迁移后验证。
- 同一错误重复发生时保留每次诊断 ID，但避免重复生成内容相同的原始快照。

#### 恢复迁移前快照

1. 用户明确选择快照并确认。
2. 关闭所有数据库连接。
3. 将当前失败数据库、WAL 和 SHM 移入 `recovery/failed/<timestamp>/`。
4. 验证快照路径、metadata、SHA-256 和只读完整性检查。
5. 将快照复制到同目录临时文件并再次校验。
6. 原子替换正式数据库文件。
7. 标记快照为 `restored`，保留失败数据库。
8. 默认返回恢复结果并退出；后续启动重新按正常状态机处理。

恢复失败时不得删除失败数据库或原快照，正式数据库路径也不得留下半写入文件。

#### 导出诊断

诊断包包含：

- 应用、Electron、Node、平台和架构版本。
- 启动状态、稳定错误分类和脱敏错误链。
- schema 版本、迁移账本摘要和 migration attempt。
- 快照 metadata、文件大小和哈希，不包含数据库内容。
- `quick_check`、外键检查和 schema invariant 结果。

诊断包不包含消息、笔记、任务正文、API Key、MCP 环境变量、Provider 请求、绝对用户目录或原始数据库。

### 10.3 第一阶段非目标

恢复窗口第一阶段不直接导入 `.yuheng` 逻辑备份，也不创建新空库覆盖损坏库。后续若需要该能力，应设计为“隔离原库、创建新库、验证逻辑导入、原子切换”的独立 Slice。

## 11. AppContext 与关闭流程

`AppContext` 持有正常运行所需资源，并提供幂等 `close()`：

```text
停止接收新 Run
  -> 拒绝并结束待审批请求
  -> 取消活动 Run，等待有限超时
  -> 停止提醒和自动备份定时器
  -> 关闭 Browser / Computer / MCP runtime
  -> 注销协议和 IPC
  -> 关闭窗口相关资源
  -> 关闭 Store 和 SQLite
```

要求：

- 资源按初始化的逆序关闭。
- `close()` 可重复调用，不重复释放、不抛出二次关闭错误。
- 每个资源只有一个所有者；窗口或 IPC handler 不直接关闭共享数据库。
- `before-quit`、初始化失败和恢复模式切换复用同一个关闭流程。
- 超时资源记录错误后继续关闭剩余资源，不能因一个 sidecar 卡住而永久阻塞退出。

## 12. 主进程架构拆分

### 12.1 IPC 注册

保留现有安全 `handleMain` 包装及发送者校验，将注册按领域移动。每个注册函数只接收窄依赖：

```ts
registerTaskIpc({ ipc, tasks, assets, reminders, events });
registerRunIpc({ ipc, runs, approvals });
```

IPC 模块负责：

- 输入解析和公开错误映射。
- 调用领域接口。
- 必需的 Renderer 事件发布。

IPC 模块不负责：

- 创建数据库连接。
- 管理全局 Run Map。
- 直接创建窗口或 sidecar。
- 复制领域实现中的业务判断。

### 12.2 Run 与审批

`RunCoordinator` 隐藏活动 Run、取消、终态保证、资源租约和关闭等待。`ApprovalCoordinator` 隐藏审批身份、发送者归属、超时、拒绝和关闭清理。

两个模块的接口必须保证：

- 每个 Run 只有一个终态。
- 旧 sender 不能批准其他窗口或其他 Run 的请求。
- 关闭时所有待审批均按拒绝处理。
- 取消、超时和异常都释放 Browser/Computer 租约。

### 12.3 Window 与 Protocol

MainWindow、PetWindow 和 RecoveryWindow 分别拥有自己的创建、显示和销毁逻辑。共享窗口状态通过明确接口传递，不继续增长 `main.ts` 顶层变量。

受控文件协议集中注册和注销，各协议 adapter 只接收对应受控文件 Store。Recovery 模式不注册这些协议。

## 13. AppStore 拆分策略

### 13.1 兼容门面

第一阶段保留 `AppStore` 公共方法，避免同时修改全部 IPC、Agent 工具和测试。构造函数改为接收已经初始化完成的数据库所有者，不再建表或迁移。

```ts
const store = new AppStore({
  conversations,
  runs,
  tasks,
  notes,
  providers,
  settings,
  search,
  backup,
});
```

门面内部逐步委托给 repository。删除测试适用于每次抽取：如果删除该 repository 会让查询、事务和映射复杂度重新散落到多个调用者，模块有足够深度；如果只是重命名一次函数调用，则不抽取。

### 13.2 Repository 所有权

- Conversation repository：项目、会话、消息和会话级查询。
- Run repository：Run、活动、artifact 和中断状态恢复。
- Task repository：看板、类型、任务、提醒原子认领。
- Note repository：页面树、历史、属性和内部关系。
- Provider repository：非敏感 Provider 配置。
- Settings repository：有类型的设置读写和默认值。
- Search repository：FTS 建立、刷新、降级和统一搜索投影。
- Backup repository：一致性快照和单事务逻辑导入。

跨领域操作仍在数据库层统一事务中完成。完整备份不能通过多个独立连接分别读取，否则会失去一致时间点。

### 13.3 种子数据

建表和 schema 迁移归迁移模块；默认项目、默认看板等种子数据归显式 bootstrap 步骤。种子写入必须幂等，并在 schema 验证后、正常业务初始化前执行。

## 14. Renderer 与样式热点

Renderer 拆分排在主进程和 Store 之后，不与启动恢复首个发布合并。

每个 feature controller 负责：

- 初始快照加载。
- 异步取消和卸载清理。
- 当前 conversation、run、board 或 note scope 校验。
- Desktop Bridge 事件过滤。
- 将稳定 state 和 command 交给 view。

`ProductionRenderer` 只保留窗口级导航、overlay 路由和 controller 组装。不得为了减少行数把大量 state 原样搬进一个新的 `useProductionState` 浅模块。

CSS 按 tokens、base、shell、feature、theme 顺序拆分。拆分只移动规则并修正稳定导入，不重命名 class、不调整颜色、不改变优先级。每次移动后比较构建 CSS 和真实窗口视觉结果。

## 15. 实施切片

### Slice 1：行为刻画与 schema 基线

内容：

- 固化当前空库和真实版本 1 schema。
- 建立经过脱敏的旧 Provider、Task、Note、Run 和 Artifact 数据库 fixture。
- 为当前 AppStore 公开行为、备份和启动顺序补足刻画测试。
- 定义 canonical schema invariants 和预期索引清单。
- 记录当前 `main.ts`、`AppStore`、`ProductionRenderer` 和 CSS 热点基线。

验收：

- 测试只刻画既有行为，不修改生产启动路径。
- 所有 fixture 可重复打开并得到确定结果。
- 当前版本 1 的多种历史结构均有明确样本。
- `npm run typecheck`、`npm test`、`npm run build` 通过。

### Slice 2：迁移 registry 与版本 2 兼容迁移

内容：

- 实现 `MigrationRunner`、`schema_migrations` 和迁移文件校验。
- 实现 `001-baseline` 与 `002-normalize-legacy-v1`。
- 将 schema 建立、历史补列和表重建逻辑从 `AppStore` 迁入迁移模块。
- 新路径先在测试入口运行，生产仍使用旧启动路径。

验收：

- 空库、当前 v1 和全部旧结构 fixture 均升级到同一 canonical schema。
- 迁移重复运行无副作用。
- 迁移中途抛错时 schema 和账本均回滚。
- 账本缺口、checksum 不一致和更高 schema 版本被稳定拒绝。

### Slice 3：原始快照、完整性检查与恢复引擎

内容：

- 实现 preflight、快照创建、metadata、哈希、保留策略和故障注入点。
- 实现迁移前后完整性检查与 schema invariants。
- 实现失败数据库隔离和快照原子恢复。
- 实现外部 migration attempt 记录和脱敏诊断导出。

验收：

- 没有已验证快照时迁移接口拒绝执行。
- 快照写入、校验、重命名任一阶段失败都不修改正式数据库。
- 恢复前必定保留失败数据库，恢复失败不损坏原文件和快照。
- 只读目录、空间不足、损坏 DB、外键错误和哈希错误都有稳定结果。

### Slice 4：StartupCoordinator 与 RecoveryWindow

内容：

- 实现启动状态机、类型化失败和 AppContext。
- 将生产启动切换到新迁移、快照和验证路径。
- 增加独立 RecoveryWindow 与最小 preload。
- 移除 `AppStore` 构造函数中的 schema 迁移。
- 将正常 IPC、窗口、协议、Run、提醒和自动备份放到 `ready` 门禁之后。

验收：

- 正常数据库无感启动，现有功能行为不变。
- 迁移或初始化失败只打开恢复窗口。
- 恢复模式中普通 IPC 和受控业务协议不可用。
- 重试、恢复快照、导出诊断、打开目录和退出均可用。
- Slice 1 至 Slice 4 的完整测试矩阵通过后才能发布。

### Slice 5：IPC 领域注册拆分

内容：

- 按 App、Conversation、Note、Task、Run、Provider、Backup、Pet 抽取 IPC 注册。
- 保留现有 channel、输入校验、安全包装和错误语义。
- 为每组注册函数提供显式窄依赖。
- `main.ts` 继续负责组装，不引入全局依赖容器框架。

验收：

- Desktop Bridge 合同和 Renderer 调用无需修改或只发生类型等价移动。
- 每个 IPC 注册模块可以通过其公开接口独立测试。
- 正常和恢复模式的 IPC 可用集合有自动化验证。
- 现有用户功能和跨进程事件顺序不变。

### Slice 6：Run、审批、窗口、协议与关闭协调

内容：

- 抽取 RunCoordinator 和 ApprovalCoordinator。
- 抽取 MainWindow、PetWindow、RecoveryWindow 和托盘生命周期。
- 抽取受控协议注册模块。
- 统一幂等、逆序的 ShutdownCoordinator。

验收：

- 每个 Run 仍保证唯一终态。
- 取消、审批超时、窗口销毁和应用退出均释放资源。
- 重复退出、初始化中途失败和强制超时不会二次关闭崩溃。
- `main.ts` 只剩生命周期入口、依赖组装和启动结果分流，目标约 250 至 350 行。

### Slice 7：AppStore 内部 repository 拆分

内容：

- 保留 AppStore 兼容门面，逐领域迁移实现。
- 共享单一 DatabaseOwner 和事务入口。
- 将跨领域完整备份、恢复映射和搜索投影留在能保证一致性的深模块中。
- 调用者逐步改为依赖窄 repository；在全部迁移前不删除门面。

验收：

- AppStore 构造函数不包含 schema、迁移或隐式资源初始化。
- 领域测试通过 repository 的公开接口验证，不读取私有 DB 实现。
- 完整备份仍来自单一一致性快照。
- 同一功能变更通常只涉及对应 IPC 和 repository。

### Slice 8：Renderer controller 与 CSS 拆分

内容：

- 抽取 Conversation、Task、Note、Settings controller。
- 将订阅、取消、scope 过滤和异步错误归属对应 feature。
- `ProductionRenderer` 收口为窗口级组合。
- 按稳定顺序拆分 `global.css`，不改变视觉设计。

验收：

- 会话切换、流式事件、任务提醒、笔记保存和设置更新不存在旧 scope 事件污染。
- 组件卸载后所有订阅和异步任务正确清理。
- 深色、浅色、窗口缩放和现有关键交互视觉无回归。
- 不以“文件行数下降”作为唯一成功标准；接口深度、局部性和测试面必须实际改善。

## 16. 测试矩阵

### 16.1 迁移 fixture

- 空数据库。
- 当前应用生成的版本 1 数据库。
- 旧单 Provider schema。
- 缺少 Provider context window 的数据库。
- 缺少 Run usage、input message 或 Artifact 字段的数据库。
- 缺少 Task description、reminder 字段或旧看板结构的数据库。
- 缺少 Note icon、cover、properties、history 字段的数据库。
- 已有部分目标表但结构不完整的数据库。
- 数据库版本高于应用支持版本。
- 账本缺号、重复、名称或 checksum 不一致。

### 16.2 故障注入

- 迁移第一条、居中和提交前抛错。
- 迁移事务提交后、迁移后验证前进程中断。
- WAL checkpoint 失败。
- 快照临时写入、fsync、重命名或哈希校验失败。
- 磁盘空间不足和只读目录。
- 损坏数据库和外键违规。
- 恢复时失败数据库隔离失败。
- 快照被修改、metadata 丢失或路径越界。

### 16.3 启动集成

- 无迁移正常启动。
- 有迁移时创建一次快照并成功启动。
- 迁移失败进入 RecoveryWindow。
- Recovery 模式无法调用正常 IPC。
- 修复外部条件后重试成功。
- 恢复快照前保存失败数据库。
- 未完成 migration attempt 在下次启动被识别。
- 非数据库资源初始化失败时正确关闭已创建资源。
- ShutdownCoordinator 多次调用保持幂等。

### 16.4 架构回归

- 保留全部现有公开行为测试。
- IPC 输入校验、发送者校验和错误分类测试。
- Run 唯一终态、取消和审批归属测试。
- 备份一致性、提醒恢复和受控协议测试。
- 真实 Electron 正常启动和恢复路径冒烟测试。
- Renderer scope 切换和事件取消测试。

不得只使用源代码正则测试证明架构正确。源码约束测试可以作为辅助，但最终以模块公开接口、跨进程行为和真实启动结果为准。

## 17. 可观测性与错误策略

- 所有启动阶段记录结构化、脱敏日志：attempt ID、阶段、耗时、结果和稳定错误码。
- 不记录 SQL 参数中的用户正文、Provider Key、MCP 环境变量、工具敏感输入或数据库内容。
- 用户文案稳定、简短、可操作；底层异常只进入脱敏诊断。
- 迁移耗时应记录但不设置危险的固定短超时。长迁移显示明确进度阶段，不能让用户误以为应用卡死。
- RecoveryWindow 不展示堆栈或原始 SQLite 错误，诊断导出中只保留必要技术摘要。

## 18. 发布、回滚与协作规则

### 18.1 发布门禁

Slice 1 至 Slice 4 完成后运行：

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

此外必须完成：

- 在正式打包 Electron 中验证正常启动和 RecoveryWindow。
- 使用用户数据副本验证版本 1 到版本 2 的真实升级。
- 验证升级失败后恢复快照，再由旧版本应用读取恢复数据库的人工流程。
- 验证未启用 Provider、断网和无可选 sidecar 时仍可恢复启动。

### 18.2 回滚原则

- 代码回滚不等于数据库降级。
- 回滚到旧应用前，用户必须先恢复对应迁移前快照。
- 不执行反向 SQL 猜测性撤销已经提交的数据变化。
- 发现发布级迁移缺陷时，优先发布只修复迁移或验证逻辑的新版本；原迁移文件保持不可变。

### 18.3 当前工作区协作

- 永远不创建分支或 Worktree。
- 开始每个 Slice 前记录 `git status --short`，识别同事已有修改。
- 如果目标文件有同事修改，先读取并基于现状编辑，不覆盖、不回退。
- 使用精确文件或 hunk 暂存，只提交本 Slice 产生的内容。
- 提交前检查 `git diff --cached`，确保不包含同事文件、生成物或无关格式化。
- 不使用 `git reset --hard`、`git checkout --` 等破坏性命令处理共享工作区。

## 19. 总体验收标准

- 没有可恢复且已验证的迁移前快照时，生产数据库不执行迁移。
- 迁移、完整性检查或初始化失败时，正常工作区、Agent runtime 和提醒均不启动。
- 更高 schema 版本被明确拒绝，数据库不发生写入。
- 恢复操作始终保留失败数据库，且不会覆盖唯一快照。
- AppStore 构造函数不再承担迁移和隐式 schema 修补。
- `main.ts` 成为组合入口，而不是全部领域状态的所有者。
- IPC、Run、存储和 Renderer 的接口可以作为真实测试面使用。
- 新增或修改一个领域功能时，主要改动具有局部性，不再要求编辑多个巨型入口文件。
- 当前会话、任务、笔记、Provider、备份、提醒、Pet、权限模式和工具行为保持兼容。
- 类型检查、全量测试、生产构建、真实 Electron 启动和恢复冒烟全部通过。

## 20. 非目标

- 更换 Electron、SQLite、Pi runtime 或 Desktop Bridge 技术路线。
- 引入 ORM、依赖注入框架、远程数据库、云同步或后台守护进程。
- 自动恢复、自动降级或自动删除失败数据库。
- 在第一阶段 RecoveryWindow 中导入 `.yuheng` 或提供正常业务只读模式。
- 将所有函数机械拆成小文件，或单纯追求行数指标。
- 与本设计无关的 UI 改版、功能开发、格式化和依赖升级。

