# 笔记页面图标与 Cover

状态：已按 TDD 实施，待最终审计

## 目标

为笔记页面提供 Notion 风格的页面图标和横幅 Cover。操作入口默认隐藏，仅在页面标题区域悬停或聚焦时出现。

## 范围

- 图标保存为单个 emoji 字符串，显示在页面标题、笔记树和子页面块。
- 内置 Cover 使用稳定的应用内封面 ID，点击后随机选择且避免立即重复；图库使用随应用打包的本地 WebP 位图，包含山景、海岸、森林、城市和抽象纹理。
- 用户可从本地选择 PNG、JPEG 或 WebP 图片作为自定义 Cover。
- 自定义图片复制到受控 `note-covers` 目录，Note 只保存 `yuheng-note-cover://local/...` 引用。
- Cover 占位、上传和删除均不依赖网络。
- 全量备份包含图标、内置 Cover ID 和自定义 Cover 文件；恢复时重新映射受控资源 URL。

## 安全与兼容

- 自定义 Cover 单文件不超过 15 MB，仅接受 PNG、JPEG、WebP。
- IPC 仅接受内置 Cover ID 或格式严格校验的受控 Cover URL，拒绝任意 URL 和路径穿越。
- 删除或替换页面 Cover 时尽力清理旧受控文件；数据库删除和文件清理保持现有 best-effort 资源策略。
- 旧数据库通过幂等迁移增加可空 `icon`、`cover` 列；旧备份缺少字段时按空值恢复。
- 不接入 Unsplash 或其他远程图片服务，不新增 endpoint、表或独立资源服务。

## 交互

- “添加图标”打开轻量 emoji 选择器，支持搜索和清除。
- “添加 Cover”使用内置 Cover；已有 Cover 显示“更换封面”“上传图片”“移除封面”。
- 标题输入、装饰操作和上传控件均处于 `no-drag` 交互区，避免 macOS 窗口拖拽区域拦截点击。

## 实施与验证

- `tests/notes.test.ts`：图标、Cover 持久化及快照导出。
- `tests/note-covers.test.ts`：受控目录写入、类型/路径校验和删除。
- `tests/full-backup.test.ts`：自定义 Cover 文件备份、恢复与 URL 重映射。
- `npm run typecheck`：通过。
- 专项笔记与备份测试：通过。
