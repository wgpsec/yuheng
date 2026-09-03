# 玉衡 Agent 对话可靠性收口设计

## 状态

已按 TDD 实施，待最终审计。

## 背景

Agent 对话已经具备本地 Run、Pi session、工具审批、附件工作区和实时事件投影。现有链路仍有若干边界会让用户看到“已结束”但后台继续运行、旧事件污染新状态，或让不支持图片的模型收到图片输入。本 Spec 只收口这些行为，不改变 OODA、Provider 路由、会话持久化和现有工具权限模型。

## 目标与非目标

目标：

- 页面/看板临时 AI 超时、主动取消和卸载都能取消真实 Run；
- 已终态 Run 的迟到事件、跨会话事件和过期授权不能污染当前会话；
- Provider 显式声明是否支持多模态，未声明或关闭时图片读取不生成 image content；
- 运行崩溃后的临时工作区可在后续启动时定向回收；
- 工具活动在缺少上游调用 ID 时仍保持唯一历史记录；
- 保持普通文本、诊断 Trace、usage、最终结果和现有会话复用行为不变。

非目标：

- 不新增 Worker/IPC endpoint、Run 状态或远端同步；
- 不恢复附件扩展名或大小白名单；
- 不把附件正文预读到 Electron prompt；
- 不强行改变 Provider 切换后的历史上下文语义；
- 不替换 Pi SDK 的通用 `read` 实现，本期只在玉衡边界正确声明图片能力。

## 设计

### 1. 临时 AI 取消

`runTemporaryAi()` 使用统一的 `cancelRunAndReject` 路径处理 AbortSignal、组件卸载和 180 秒超时。超时发生在 `runs.start()` 返回前时记录待取消标记；启动完成后立即取消该 Run。Promise 只 settle 一次，成功路径归档临时会话，取消/超时路径也必须取消真实 Run 后再清理订阅。

### 2. Run 事件与授权隔离

每个 conversation 维护明确的 Run scope：`pending`（等待 accepted）、`active`、`terminal`。只有 pending 允许匹配首次 accepted；active 只接受相同 `runId`；terminal 拒绝所有迟到事件。终态保留最近终态 Run 身份，直到下一次 accepted 替换。

`approval_required` 和 `approval_resolved` 同样执行 conversation + run scope 校验。跨会话或终态授权不得弹窗，也不得调用 approve。

### 3. Provider 多模态能力

Provider 配置增加 `supportsImages: boolean`：

- 设置页在创建/编辑 Provider 时提供“支持图片输入”选项；
- 旧数据迁移为 `false`，默认 fail-closed；
- Provider 列表、会话绑定和现有 provider save/list 合同透传该值；
- Pi model 的 `input` 由该值决定：始终包含 `text`，仅 `supportsImages=true` 时包含 `image`；
- 不支持图片时，Pi `read` 返回文本说明/错误提示，不向 Provider 发送 image content；
- 非图片附件继续按路径读取，保持现有 staging 与 promptContext 语义。

### 4. 工作区恢复清理

启动 `recoverRunningRuns()` 后，按数据库中已恢复为 `interrupted` 的 Run ID，定向删除其 `.yuheng/runs/<runId>` 目录。未知目录不盲目删除；清理失败只记录诊断，不阻塞应用启动。

### 5. 工具活动唯一性

Pi 缺少 `toolCallId` 时由玉衡生成 Run 内唯一 ID（不能使用 `toolName`）。同一上游事件的 start/end 必须共享该映射，确保数据库活动不被覆盖。

## 验收矩阵

- 临时 AI 超时后 Run 最终为 cancelled，Provider/工具不再继续；`runs.start()` 延迟超过超时阈值时也成立；
- 临时 AI Abort、卸载和超时均只触发一次取消和一次清理；
- 终态后迟到 delta/tool/approval 被丢弃；新 Run 只接收新 runId；
- 跨会话 approval 不显示、不允许批准；
- Provider `supportsImages=false` 时图片读取不会产生 image content，`true` 时行为保持兼容；
- 旧 Provider 数据迁移后默认为 `false`，文本附件不受影响；
- 重启恢复后中断 Run 的工作区被清理，活动 Run 的目录不误删；
- 缺失 toolCallId 的两次同名工具调用各自保留 start/end 历史；
- 现有 Pi、附件工作区、外链和普通对话回归测试继续通过。

## 实施顺序

1. 临时 AI 取消与回归测试；
2. Run/approval scope 与迟到事件回归测试；
3. Provider 多模态字段、迁移、设置 UI、Pi runtime 与回归测试；
4. 工作区恢复清理与崩溃恢复测试；
5. 工具调用 ID 映射与历史完整性测试；
6. 定向回归、typecheck、build 和 diff 检查。

## 实施结果

- 临时 AI 的超时、Abort、卸载均会取消真实 Run，并覆盖启动响应晚于取消的竞态。
- Conversation + Run scope 已隔离 accepted、终态迟到事件和 approval 事件；会话重新加载时恢复 running Run。
- Provider 增加 `supports_images` 配置及迁移，设置页可逐 Provider 选择多模态能力；旧数据默认关闭。Pi model 仅在明确开启时声明 image 输入，并在请求序列化前再次拦截图片。
- 会话附件改为由主进程保留源路径，启动 Run 时复制到 `.yuheng/runs/<runId>/attachments`，通过 promptContext 告知 Agent 按路径读取，不预读附件正文到 Electron prompt；Run 收尾后删除暂存目录。
- 启动时只按数据库中本次恢复为 interrupted 的 Run 身份清理对应工作区，不扫描或删除未知目录。
- 缺失上游 `toolCallId` 时生成 Run 内唯一 ID，并按工具名 FIFO 关联 start/end。
- Pi SDK 内建 `read` 仍由 SDK 负责文件读取和图片处理；其内部 `readFile()` 可能先将超大文件整体载入内存。本轮不替换该 SDK 工具，以免改变 offset/limit、图片识别和输出合同；该项作为后续上游升级或独立适配项跟踪。

## 测试记录

- `node --import tsx --test tests/temporary-ai.test.ts tests/renderer-controller-scope.test.ts`：5 passed。
- `node --import tsx --test tests/storage-migrations.test.ts tests/storage-repositories.test.ts tests/store.test.ts tests/pi-session-factory.test.ts`：75 passed。
- `node --import tsx --test tests/project-run-workspace.test.ts tests/storage-repositories.test.ts tests/store.test.ts`：59 passed。
- `node --import tsx --test tests/pi-runtime.test.ts`：11 passed。
- `npm run typecheck`：通过。
- `git diff --check`：通过。
