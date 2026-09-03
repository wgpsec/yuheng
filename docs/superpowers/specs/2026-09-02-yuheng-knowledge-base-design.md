# 玉衡多知识库设计 Spec

状态：设计确认，按 Slice 分阶段实施

当前进度：Slice 1–5 已实现。

目标版本：`0.4.x`

## 1. 背景与目标

当前知识库模式中的所有页面共用一棵全局页面树。用户需要将运维、开发、安全等内容分开管理，同时保留页面层级、块编辑器、搜索、AI 和备份能力。

本设计在现有 `notes` 页面模型之上增加一层“知识库”容器：一个知识库包含多个根页面和子页面；页面仍然是可编辑、可归档、可移动的最小内容单元。

### 1.1 目标

- 支持创建、切换、重命名、归档和删除多个知识库。
- 每个页面明确归属一个知识库，页面树只在同一知识库内组织。
- 现有页面 ID、父子关系、页面链接和正文格式保持兼容。
- 侧栏以“库”展示知识库，以“页面”展示当前知识库的页面树。
- 页面可以在知识库之间移动或复制。
- 搜索、AI 上下文、备份和恢复包含知识库信息。
- 所有知识库操作共享现有 SQLite 连接和事务边界。

### 1.2 非目标

- 第一阶段不实现多人协作、权限、云同步或团队共享。
- 不引入独立的“空间/Teamspace”实体；未来需要权限隔离时再在知识库之上增加空间层。
- 不改变现有 `notes` 表名、页面 Markdown 格式或 `yuheng-note://` 链接协议。
- 不将对话项目与知识库强行合并；项目仍属于对话领域。

## 2. 术语与层级

| 术语 | 定义 |
| --- | --- |
| 知识库 | 页面集合的顶层容器，例如“运维知识库”“开发知识库”。 |
| 页面 | 可独立打开、编辑、搜索、归档和删除的内容实体。 |
| 页面树 | 知识库内部通过 `parent_id` 和 `position` 组织的根页面及子页面。 |
| 当前知识库 | 当前侧栏和编辑器正在展示的知识库，按用户保存。 |
| 默认知识库 | 迁移旧数据时自动创建的容器；用于兼容省略知识库参数的旧调用。 |

## 3. 数据模型

### 3.1 知识库表

新增 `knowledge_bases`：

```sql
CREATE TABLE knowledge_bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_knowledge_bases_position
  ON knowledge_bases(archived, position, id);
```

在 `notes` 增加 `knowledge_base_id TEXT`，迁移完成后设为非空，并引用 `knowledge_bases(id) ON DELETE RESTRICT`。页面排序索引升级为：

```sql
CREATE INDEX idx_notes_knowledge_base_parent_position
  ON notes(knowledge_base_id, parent_id, archived, position, id);
```

`parent_id` 仍然引用 `notes(id) ON DELETE CASCADE`。Repository 在创建和移动时必须验证父页面属于同一知识库，禁止跨库形成父子关系。

### 3.2 迁移与兼容

- 新增下一版本迁移（当前 schema 版本为 5）。
- 创建名为“默认知识库”的种子记录。
- 所有历史页面的 `knowledge_base_id` 指向默认知识库。
- 空库也必须存在默认知识库，保证旧的 `createNote()`、`listNotes()` 调用仍可工作。
- 保留页面 ID、`parent_id`、position、正文、版本记录和页面链接。
- 旧备份没有知识库数据集时，导入到当前默认知识库。
- 迁移失败必须由现有启动恢复机制处理，不能部分写入。

## 4. Repository 与 Store 接口

新增窄接口 `KnowledgeBaseRepository`，负责知识库 CRUD、归档和排序。`NoteRepository` 增加显式知识库参数，同时保留兼容门面：

```ts
knowledgeBases.list(includeArchived?: boolean): KnowledgeBase[];
knowledgeBases.get(id: string): KnowledgeBase | null;
knowledgeBases.create(input?: CreateKnowledgeBaseInput): KnowledgeBase;
knowledgeBases.update(id: string, patch: UpdateKnowledgeBaseInput): KnowledgeBase;
knowledgeBases.delete(id: string): void;
knowledgeBases.reorder(id: string, targetId: string): KnowledgeBase[];

notes.list(knowledgeBaseId?: string, includeArchived?: boolean): Note[];
notes.get(id: string): Note | null;
notes.create(knowledgeBaseId: string, input?: CreateNoteInput | string, parentId?: string | null): Note;
notes.move(id: string, knowledgeBaseId: string, parentId: string | null, targetId?: string): Note;
notes.copy(id: string, knowledgeBaseId: string, parentId?: string | null): Note;
```

兼容门面在省略知识库参数时解析默认知识库；新代码必须使用显式知识库接口。知识库删除、页面批量迁移和默认知识库调整在同一个事务中完成。删除知识库时，页面及其历史版本会在用户确认后原子删除。

知识库删除规则：

- 默认知识库不可删除；可以重命名和归档，但必须始终有一个可用容器。
- 非默认知识库允许连同其中的页面和历史版本一起删除；默认知识库不可删除。
- 删除前必须明确确认，删除失败时知识库、页面和默认设置保持不变。

## 5. IPC 与前端合同

在 Desktop Bridge 增加 `knowledgeBases` 命名空间，并扩展 `notes` 的知识库参数。IPC 层负责字符串、长度、ID 关系和未知参数校验；Renderer 不直接访问数据库。

当前知识库 ID 保存在应用设置中，例如 `active_knowledge_base_id`。读取到已删除或归档的 ID 时回退到第一个可用知识库，并更新设置。

旧 `notes:list`、`notes:create` 等 endpoint 暂时保留，省略知识库参数时使用默认知识库；新增 endpoint 用于显式按库操作，避免一次性破坏现有调用方。

## 6. 侧栏交互

侧栏结构：

```text
页面                                      [+]
  收藏
  最近访问
  库                                      [+]
    运维知识库                            […]
      发布流程
      故障处理
    开发知识库                            […]
      API 规范
```

- 顶部标题保持“页面”；底部分类标题为“库”。
- “库”右侧加号创建知识库；知识库行右侧加号创建根页面，省略号打开管理菜单。
- 点击知识库行切换当前知识库，编辑区显示该库的页面或空状态。
- 知识库可展开/收起；页面树只显示当前库，避免多个大页面树挤在一起。
- 页面拖拽到其他知识库时显示有效投放态；右键菜单提供“移动到”和“复制到”。
- 当前知识库、展开状态和最近访问状态持久化到本地。
- 知识库归档后不出现在默认列表，可从归档入口恢复。

## 7. 搜索、AI、备份

### 7.1 搜索

搜索结果继续使用 `note` 类型，但 `context` 增加知识库名称和页面路径，例如：`开发知识库 / API 规范`。点击结果时自动切换到对应知识库并展开祖先页面。

### 7.2 AI 上下文

知识库页面的 AI 请求增加结构化上下文：知识库名称、页面路径、当前页面标题和正文。只发送当前页面或用户明确选择的页面，不自动发送整个知识库。

### 7.3 备份与恢复

备份新增 `data/knowledge-bases.json`。恢复时先建立知识库 ID 映射，再建立页面 ID 和父页面映射；旧备份缺少该文件时使用默认知识库。恢复不得覆盖已有知识库或页面。

## 8. 分 Slice 实施

### Slice 1：数据层

- 新增类型、表、索引和迁移。
- 新增 `KnowledgeBaseRepository`。
- 扩展 `NoteRepository` 的知识库过滤和同库父子校验。
- 覆盖空库、历史页面迁移、跨库父页面、删除约束、事务回滚测试。

### Slice 2：IPC 与兼容门面

- 接通 Store、IPC、preload 和 Desktop Bridge。
- 保留旧 notes endpoint 的默认知识库兼容行为。
- 增加当前知识库设置读写。
- 补充 IPC 参数校验和重启持久化测试。

### Slice 3：侧栏和切换

- 展示知识库列表、展开/收起和当前库状态。
- 当前页面树按知识库过滤。
- 新建知识库、切换知识库和空状态。
- 补充切换、刷新和旧数据兼容的组件行为测试。

### Slice 4：管理和跨库操作

- 知识库重命名、归档、删除和排序。
- 页面跨知识库移动/复制，保留页面链接和版本语义。
- 拖拽投放态及菜单操作。
- 覆盖非空删除、跨库移动回滚和复制 ID 重映射测试。

### Slice 5：周边能力与收尾

- 搜索、AI 上下文、备份恢复和标签页适配。
- 更新用户可见文案和版本日志。
- 运行全量测试、typecheck、build、`git diff --check`，并进行桌面 UI 验收。

实现记录：知识库管理 UI（重命名、归档/恢复、删除、排序和页面投放）、搜索知识库路径与自动切换、笔记 AI 知识库上下文、知识库备份恢复及旧备份兼容已接通。全量测试中仅保留既有的 `releases.test.ts` 更新日志缺项失败，与本 Slice 无关。

## 9. 验收矩阵

| 行为 | 验收标准 |
| --- | --- |
| 旧数据迁移 | 所有历史页面进入默认知识库，页面 ID 和父子关系不变 |
| 新建知识库 | 创建后可切换，页面树为空且可新建页面 |
| 页面隔离 | 当前库只展示本库页面，跨库页面不会混入树中 |
| 页面移动 | 移动后页面及子树归属目标库，父页面关系合法 |
| 页面复制 | 生成新页面 ID，正文、图标和页面层级正确复制 |
| 删除知识库 | 二次确认后连同页面和历史版本原子删除，默认库始终可用 |
| 搜索跳转 | 结果显示知识库路径，点击后切换到正确知识库和页面 |
| 备份恢复 | 新旧备份均可恢复，知识库和页面关系完整 |
| 重启 | 当前知识库和默认知识库设置持久化 |
| 失败回滚 | 迁移、移动、删除任一步失败，数据库保持操作前状态 |
