# 玉衡 Computer Use 观察、执行与验证闭环设计

日期：2026-09-04
状态：已实施，待 fork 发布与真机回归
涉及仓库：`yuheng`、`No-Github/pi-computer-use`

## 1. 背景

玉衡 `0.3.8` 已能稳定启动并连接 `pi-computer-use` helper，macOS 辅助功能和屏幕录制权限也能读取到真实授权状态。会话 `ea7eed6d-b82c-4a10-b1ac-e597156d6deb` 暴露的剩余问题不在 helper 生命周期：目标窗口返回了 `windowId: 0`、`isOnscreen: false` 和 `0x0` 视觉捕获；坐标动作在派发前因截图刷新失败而终止，但 Agent 仍声称输入已经完成，并错误归因为权限不足。

现有实现已经具备根生命周期、动作事务、视觉目标和 successor verification。本设计只补齐尚未闭合的契约，不为 Zed 或任何具体应用增加特判。

## 2. 设计原则

- 遵循 `observe -> act -> observe -> verify`，UI 状态未知时不得执行坐标动作。
- 区分动作是否派发和效果是否验证，不能从错误文本或模型陈述推断成功。
- AX 语义能力不能自动升级为视觉坐标能力。
- 窗口恢复依据 PID、稳定根引用、标题和几何等通用身份信息，不依据应用名称或 bundle ID 特判。
- Skill 只指导模型选择工具；正确性由 fork 和玉衡运行时的结构化契约保证。
- 保持现有工具名、参数和成功结果兼容。

## 3. 公开结果契约

`act_ui` 的 `details.actionOutcome` 使用以下联合类型：

```ts
type ActionOutcome =
  | { status: "not_dispatched"; reason: ActionOutcomeReason; dispatchedActions: 0 }
  | { status: "dispatched_unverified"; reason: ActionOutcomeReason; dispatchedActions: number }
  | { status: "verified"; reason: "successor" | "postcondition" | "helper_evidence"; dispatchedActions: number };
```

其中 `ActionOutcomeReason` 至少区分：

- `visual_observation_unavailable`
- `target_unavailable`
- `delivery_failed`
- `delivery_unknown`
- `post_action_observation_failed`
- `postcondition_failed`
- `effect_not_verified`

约束：

- 派发前失败必须是 `not_dispatched`，且 `dispatchedActions` 为 `0`。
- helper 已收到动作、但没有可靠 successor evidence 时为 `dispatched_unverified`。
- 只有后置条件、successor state 或 helper 的可信结构化证据成立时才是 `verified`。
- `isError` 与 `actionOutcome` 一致：前两种状态均作为失败或未确认结果交给模型，不能表现为成功工具调用。

## 4. 能力与目标模型

一次观察分别声明：

- `semantic`：存在可操作 AX/UIA 元素引用；
- `visual`：存在非零截图、稳定窗口身份和明确坐标变换；
- `hybrid`：同时具备两者。

坐标动作或 `visualTarget` 只接受 `visual`/`hybrid` 状态。只有 `semantic` 时仍允许引用元素的语义动作，但不得使用裸坐标。`windowId <= 0`、截图缺失或尺寸为零时不建立视觉能力。

## 5. macOS 通用目标恢复

当视觉观察缺少有效 `windowId` 时：

1. 激活并抬升目标窗口；
2. 等待一次短暂的窗口状态稳定期；
3. 重新枚举同 PID 的 AX 根和可捕获窗口；
4. 优先匹配稳定根引用，其次使用标题和几何的一致性；
5. 只接受唯一且可见、尺寸有效、带正数 `windowId` 的候选；
6. 匹配仍不可靠时返回结构化 `visual_observation_unavailable`，不猜坐标。

该过程只执行一次受控恢复。语义树仍可用时保留语义操作能力；否则提示用户切换到目标 Space 或接管。

## 6. 玉衡运行时约束

玉衡在 Pi 会话边界读取 `act_ui` 的结构化结果，并维护本轮最后一次 Computer Use outcome：

- `not_dispatched`：执行记录明确显示“未执行”，最终答复不得表述为已完成；
- `dispatched_unverified`：显示“已发送但未确认”，最终答复必须保留不确定性；
- `verified`：允许表述完成；
- 同类不可恢复失败连续出现两次后停止自动重试，要求用户接管或重新观察目标窗口。

首期通过 Pi `tool_result` 扩展把约束写入模型可见结果，并在玉衡事件投影中保存 outcome。不得依靠解析自然语言错误来决定状态。

## 7. Skill 边界

Skill 只保留以下通用策略：

- 操作前使用最近的观察状态；
- 优先语义引用，视觉不可用时不猜坐标；
- 每个短动作组后检查 successor state；
- 严格按照 `actionOutcome.status` 描述结果；
- 连续不可恢复失败后停止并请求用户接管。

不包含应用专属坐标、快捷键、bundle ID 或 Zed 专属流程。

## 8. 实施 Slice

### Slice 1：fork 执行结果契约

- 为 `act_ui` 所有出口生成统一 `actionOutcome`。
- 覆盖派发前截图失败、helper 拒绝、未知投递、后置观察失败、验证失败和验证成功。
- 工具错误保留机器可读 details，模型可见文本明确说明是否执行了零个动作。

### Slice 2：macOS 通用视觉目标恢复

- 提取纯候选选择函数并通过 PID、根引用、标题、几何和可见性测试。
- 激活后重新枚举一次，拒绝 `windowId: 0`、零尺寸、不可见或歧义候选。
- 捕获错误区分权限、跨 Space/不可见、窗口匹配失败和窗口消失。

### Slice 3：玉衡运行时约束

- 增加 Computer Use outcome 解析和 Pi `tool_result` 适配器。
- 工具活动记录并展示未派发、未确认或已验证状态。
- 同类不可恢复失败限次，不影响 Browser Use 和普通工具。

### Slice 4：Skill 与诊断收口

- 更新内置 Computer Use Skill 使用结构化状态。
- 环境诊断明确区分 TCC 授权与单个窗口可捕获性。
- 补充打包后真实 helper 的手工回归步骤。

## 9. 验收矩阵

- 有效 AX 元素、无截图：语义点击/输入可执行，裸坐标不执行。
- 截图刷新在派发前失败：`not_dispatched`、零动作、不得声称完成。
- helper 返回 `didnt`：`not_dispatched` 或按已完成前缀准确计数，禁止整体成功。
- helper 返回 `unknown`：`dispatched_unverified`。
- 动作已发送、后置观察失败：`dispatched_unverified`，不得自动重放。
- successor 或后置条件验证成功：`verified`。
- 跨 Space 后重新枚举得到唯一可见窗口：恢复视觉操作。
- 仍为 `windowId: 0`、不可见、零尺寸或多候选歧义：停止坐标操作并给出准确诊断。
- Electron、原生 App、Chromium/GPU 编辑器共享同一协议，无应用名称特判。

## 10. 验证与发布

每个 Slice 使用单个行为测试完成 RED -> GREEN，再增加下一个行为。完成后分别运行 fork 定向测试与 typecheck、玉衡定向测试与 typecheck/build，并执行两个仓库的 `git diff --check`。未经用户明确要求不提交、不推送、不发布。

## 11. 实施记录

- Slice 1：`act_ui` 已统一返回 `details.actionOutcome`，并在 Pi 工具边界将未派发和未确认结果标记为错误。
- Slice 2：macOS 已按 PID、根引用、标题、几何和可见性恢复唯一捕获窗口，拒绝无效或歧义候选。
- Slice 3：玉衡运行时已阻止未派发/未确认后的完成宣称；fork 已加入连续同类失败两次后的动作熔断，并允许成功观察解除。
- Slice 4：内置 Skill 已改用结构化状态；设置诊断和打包文档已区分 TCC 权限与单窗口捕获能力。
- 发布边界：fork 的本地改动在提交并推送、玉衡更新完整 commit SHA 前，不会进入正式安装包。
