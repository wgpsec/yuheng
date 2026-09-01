# 玉衡本地数据备份与恢复设计

状态：已按 TDD 实施，待最终审计

## 1. 目标

把当前仅支持“单会话 JSON 导出”的能力升级为可迁移、可校验、可恢复的完整本地备份。

第一版只面向 macOS 本地客户端，不引入云同步、账号体系、服务端接口或新的数据库实体。

## 2. 已确认范围

备份包含：

- 会话、消息、运行摘要、工具活动；
- 任务看板、任务类型、任务、提醒信息及来源会话关系；
- Provider 的非敏感配置（协议、地址、模型、显示名称、上下文窗口）；
- 应用设置（主题、能力开关、推理偏好等非敏感设置）；
- `task-assets/` 中由玉衡管理的任务附件；
- Browser Use / Computer Use 的受控 run artifacts；
- Pi session 文件，用于尽量保留 Agent 上下文。

第一版不包含：

- `workspace/` 普通工作文件；
- API Key、MCP 凭据、OAuth token 或任何 Keychain 内容；
- 临时附件缓存、未完成上传和临时目录；
- 备份文件密码加密。用户可在玉衡外部使用磁盘或压缩包加密。

## 3. 文件格式

备份是一个 ZIP 文件（实现时使用无原生依赖的流式 ZIP 库，不调用 shell），扩展名使用 `.yuheng`，例如 `yuheng-backup-2026-08-28.yuheng`。

```text
manifest.json
data/conversations.json
data/messages.json
data/runs.json
data/run-activities.json
data/tasks.json
data/task-boards.json
data/task-types.json
data/providers.json
data/app-settings.json
files/task-assets/<asset-id>/<safe-name>
files/run-artifacts/<artifact-id>.<ext>
sessions/<conversation-id>/<pi-session-files>
```

`manifest.json` 必须包含：

- `format: "yuheng-backup"`；
- 整数 `version`，第一版为 `1`；
- 导出时间、应用版本和平台标识；
- 每个条目的相对路径、字节大小和 SHA-256；
- 数据集计数（会话、消息、任务、附件、artifact、session）。

ZIP 内路径只能是相对路径，禁止绝对路径、`..`、符号链接和重复目标路径。单个文件和整个压缩包都必须有大小上限，防止解压炸弹。

## 4. 导出流程

1. 用户从设置页选择“导出完整备份”。
2. 主进程暂时拒绝新的 Run 创建；已有 Run 继续自然完成。界面显示“等待当前运行完成”，用户可取消本次导出，但不能在导出过程中强制杀掉 Run。
3. 只有当活动 Run 数为零时才建立快照；不满足时不生成备份文件。这样 SQLite、Pi session、artifact 和运行记录来自同一稳定时点。
4. 在 SQLite 事务快照中读取全部业务数据；不直接复制正在写入的 WAL 文件。
5. 复制受控附件、run artifacts 和 Pi session。只复制 manifest 允许的应用目录，不跟随符号链接。
6. 生成清单并校验大小、路径和 SHA-256。
7. 先写入同目录临时文件，关闭 ZIP 后原子重命名为用户选择的目标路径。
8. 任一步失败都删除临时文件，不修改数据库、不改变运行状态，并恢复新 Run 创建。

导出不读取或序列化应用目录中的 `secrets.json`；Provider 只写非敏感配置。Pi session 在写入前按允许的文件清单复制，禁止把环境变量、SecretStore 或临时 token 文件打包。

## 5. 恢复流程

第一版只支持“合并导入”，不覆盖、不删除当前数据：

1. 用户从设置页选择 `.yuheng` 文件。
2. 主进程先检查扩展名、ZIP 结构、路径安全、总大小、manifest 版本和每个文件的 SHA-256；失败时不写入任何数据。
3. 展示导入预览：会话、消息、任务、附件、artifacts 和 session 数量，以及缺失 Provider 数量。
4. 在单个 SQLite 事务中创建新的会话、消息、运行摘要、工具活动、任务、看板和任务类型 ID；所有外部 ID 都重新生成，避免与现有数据冲突。
5. 恢复关系时使用导入映射表：消息归属新会话，运行输入消息、任务来源会话、工具活动和 artifact 关联均指向新 ID。导入的运行统一为只读历史状态，不保留 `running` 状态。
6. Provider 仅按原 ID 匹配现有配置；不存在时绑定当前默认 Provider，并在导入报告中标记“需要重新配置”。完整备份可包含用户明确授权导出的 Provider API Key，导入后写回本机加密 SecretStore。
7. 附件和 artifacts 复制到当前应用受控目录，使用新文件名或新 UUID；禁止覆盖已有文件。
8. Pi session 只在校验通过后复制。若 session 文件缺失或版本不兼容，会话和消息仍可恢复，并在报告中标记“上下文不可恢复”。
9. 数据库事务提交成功后再发布刷新事件；文件复制失败或事务失败时回滚数据库并清理本次已复制文件。

导入不会自动启动 Run、调用 Provider、执行工具、发送通知或恢复未完成的运行。导入的历史 Run 仅作为只读摘要；继续对话时由用户显式发送新消息。

## 6. Pi session 边界

- session 文件不是恢复真相，SQLite 会话和消息始终是权威数据；
- 只允许复制当前应用生成的 session 文件，未知扩展名和可执行文件拒绝打包；
- 恢复后 session 使用新的会话目录和新的会话 ID；
- 如果 Pi SDK/session schema 版本不兼容，保留消息并放弃 session 恢复，不阻断整个备份导入；
- 不把 `workspace/` 文件或外部路径作为 session 的依赖自动带入。

## 7. 自动备份

第一版提供可选的本地自动备份：

- 设置中开启或关闭；
- 默认关闭，由用户明确开启；备份文件未加密，设置页需提示其包含本地敏感数据；
- 每个自然日最多一次；
- 默认目录：`~/Library/Application Support/yuheng/backups`；
- 默认保留最近 7 份，删除前先按 manifest 校验目标确实是玉衡自动备份；
- 自动备份发现活动 Run 时跳过本轮并记录原因，下一次计划周期再尝试；不阻断应用退出或正常对话；
- 应用退出时不等待自动备份，避免拖慢关闭；
- 自动备份使用同一 `.yuheng` 格式，并按用户已授权的完整备份策略包含 Provider API Key；`secrets.json` 和原始密钥文件不复制。

## 8. UI 与 IPC

设置页新增“数据备份”区域：

- 导出完整备份；
- 导入备份；
- 自动备份开关、目录、保留数量；
- 最近一次成功/失败时间和错误摘要；
- 导入预览和完成报告。

继续使用主进程 dialog 和 typed preload bridge。Renderer 不读取 SQLite、备份文件内容或任何密钥。

## 9. 失败与安全边界

- 恶意或损坏 ZIP 必须在写库前拒绝；
- 所有路径经过规范化和受控根目录校验；
- 文件大小、条目数量和解压后总大小有界；
- manifest 哈希不匹配时整包失败，不接受部分静默恢复；
- 导入过程不得覆盖现有会话、任务、附件或 session；
- MCP 凭据和 token 不进入 JSON、ZIP、日志、错误提示或导入报告；完整备份中的 Provider API Key 是唯一例外，且只在用户明确导出时写入未加密 ZIP，导入后写回可移植 `secrets.json`，不进入数据库或日志；
- 备份中的 Markdown、消息和工具输出按不可信文本处理，不在导入阶段执行。

## 10. TDD 验收矩阵

### 格式与导出

- 空数据库可导出合法 `.yuheng` 包；
- 完整数据导出后 manifest 计数和 SHA-256 正确；
- 备份不包含 API Key、SecretStore 或 `workspace/` 文件；
- 活动 Run 时不会产生不一致的半成品；
- 活动 Run 时手动导出会等待或允许用户取消，自动备份跳过本轮；
- 导出失败会清理临时文件且不改变应用状态。

### 恢复

- 合法备份导入后生成全新的会话、消息、任务和附件 ID；
- 缺失 Provider 回退默认 Provider 并生成明确报告；
- 缺失/不兼容 Pi session 不阻断消息恢复；
- 损坏哈希、路径穿越、符号链接、超大条目在写库前拒绝；
- 任意文件复制或事务失败都会回滚数据库并清理已复制文件；
- 导入不会自动运行 Agent、调用 Provider、执行工具或发送通知。

### 自动备份

- 同一天只生成一份；
- 超过保留数量时只删除已识别的自动备份；
- 自动备份失败不影响应用正常使用和退出；
- 重启后可继续执行下一次应到的自动备份。

## 11. 实施顺序

1. 抽取 ZIP/manifest 的纯逻辑模块和安全校验；
2. 增加 AppStore 一致性快照与导入事务；
3. 接入受控文件复制和 Pi session 兼容处理；
4. 接入 Electron dialog、typed IPC 和设置页；
5. 增加自动备份调度与保留策略；
6. 运行聚焦测试、类型检查、构建和 `git diff --check`。

## 12. 非目标

- 云同步、远程备份和跨设备冲突解决；
- 普通 workspace 文件备份；
- 在玉衡内实现密码加密；
- 覆盖式恢复、数据库降级和跨大版本自动迁移；
- 自动恢复未完成 Run 或继续执行工具。

## 13. 实施记录

- 已实现纯 JavaScript ZIP/manifest 构建与校验（路径、大小、条目数、SHA-256），归档扩展名为 `.yuheng`。
- 已实现 SQLite 全量快照与合并导入：关系重映射为新 ID，运行中的记录导入为 `interrupted` 历史状态，Provider 不携带密钥。
- 已接入受控 task-assets、run artifacts 的备份与恢复；workspace、secrets.json 不进入归档。Pi session 在缺少可兼容映射时标记为上下文不可恢复，不阻断消息导入。
- 已接入设置页“数据备份”入口、手动导出/导入 IPC，以及默认关闭的每日自动备份和保留策略。
- 验证：备份归档、快照合并、敏感文件排除专项测试通过；`npm run typecheck`、`npm run build` 通过。
