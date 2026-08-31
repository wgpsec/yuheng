# Issue tracker: GitHub

本仓库的 Issue 和 PRD 使用 GitHub Issues 管理，通过 `gh` CLI 操作。

## Conventions

- 创建：`gh issue create --title "..." --body "..."`
- 读取：`gh issue view <number> --comments`
- 列表：`gh issue list --state open --json number,title,body,labels,comments`
- 评论：`gh issue comment <number> --body "..."`
- 添加或移除标签：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- 关闭：`gh issue close <number> --comment "..."`

仓库信息从 `git remote -v` 推断。在仓库目录内运行时，`gh` 会自动使用当前 GitHub 仓库。

当技能要求“发布到 issue tracker”时，创建 GitHub Issue；要求“读取相关 ticket”时，使用 `gh issue view <number> --comments`。
