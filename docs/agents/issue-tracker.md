# Issue tracker: Local Markdown

本仓库的 Issue 和 PRD 使用 `.scratch/` 下的本地 Markdown 文档管理。

## Conventions

- 每个功能使用独立目录：`.scratch/<feature-slug>/`
- PRD 位于：`.scratch/<feature-slug>/PRD.md`
- 实现任务位于：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号
- 每个任务在文件开头附近使用 `Status:` 记录状态，状态值见 `triage-labels.md`
- 评论和过程记录追加到文件末尾的 `## Comments` 下

## When a skill says "publish to the issue tracker"

在 `.scratch/<feature-slug>/` 下创建对应 Markdown 文件；目录不存在时一并创建。

## When a skill says "fetch the relevant ticket"

读取用户给出的本地文件路径或任务编号对应的 Markdown 文件。
