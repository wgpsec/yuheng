# 玉衡 Skills

玉衡对话使用受控的 Skills。默认不扫描用户目录、项目目录或 `~/.pi/agent/skills`，避免外部提示词未经授权进入会话。

当前内置 Skill：

- `computer-use`：桌面能力开启时按会话注入，约束窗口根引用刷新、权限/窗口错误区分和有限恢复。

Skill 通过 Pi 的 `DefaultResourceLoader` 的 `additionalSkillPaths` 加载，`noSkills: true` 仍保持开启，因此只有玉衡明确传入的目录会被读取。系统提示只展示 Skill 的名称、说明和路径；模型在任务匹配时使用 `read` 读取完整 `SKILL.md`。

设置中的 “Skills” 页面用于检查内置文件是否存在和查看加载条件；对话输入区的 “桌面” 菜单会明确提示 Computer Use Skill 是否会随能力开启。

用户 Skill 通过设置页显式选择目录或 `SKILL.md` 导入。导入后默认关闭，启用后仍需在具体会话的 “Skills” 菜单中选择；只有已启用且被当前会话选中的 Skill 才会传给 Pi runtime。用户 Skill 的路径、名称、说明和启用状态保存在 `app_settings`，删除注册不会删除磁盘上的原文件。

发布应用时，`electron-builder` 必须包含 `electron/skills/**/*`。开发环境和打包环境都通过应用路径解析该目录，缺失时在设置页显示不可用。
