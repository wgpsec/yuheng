# Electron 桌面端交互区域约束

玉衡使用 Electron 的无边框窗口和自定义标题栏。窗口拖拽区域会优先处理鼠标事件，因此普通网页中可以正常工作的菜单，在桌面端可能出现“看得见但点不到”的问题。

## 典型现象

- 右键菜单可以显示，但只有靠近顶部的一小部分能悬停或点击。
- 菜单项文字存在，鼠标移动到下方选项没有 hover 样式。
- 左键点击被当成窗口拖拽，输入框、下拉菜单或上下文菜单无法获得焦点。
- 菜单看似没有被遮罩，实际命中区域被父级容器裁剪。

## 根因

通常是以下两个问题之一，或同时存在：

1. 菜单或其父级位于 `-webkit-app-region: drag` 区域，没有声明为交互区。
2. 菜单挂在 `overflow: hidden`、`overflow: auto` 或固定高度的滚动容器中。菜单视觉上溢出后，溢出部分可能无法接收鼠标事件。
3. 菜单祖先使用了 `transform`、`filter`、`contain` 或 `isolation`，形成独立层叠上下文。此时只提高菜单自身的 `z-index` 仍无法越过同级列表项。

## 实现规则

### 1. 所有交互元素必须是 `no-drag`

标题栏、侧栏顶部等区域可以使用拖拽：

```css
.window-drag-region {
  -webkit-app-region: drag;
}
```

按钮、输入框、下拉菜单、菜单项和菜单容器必须显式覆盖：

```css
.window-interactive,
.window-interactive button,
.window-interactive input,
.window-interactive [role='menu'] {
  -webkit-app-region: no-drag;
  pointer-events: auto;
}
```

不要只给菜单项设置 `no-drag`，父级菜单容器也必须设置。

### 2. 上下文菜单不能被滚动容器裁剪

优先将菜单渲染到工作区根节点或 `document.body`，使用 `position: fixed` 定位。若菜单暂时挂在标签栏、列表等容器内，必须确认祖先没有 `overflow: hidden/auto` 裁剪菜单区域。

```css
.context-menu {
  position: fixed;
  z-index: 1000;
  pointer-events: auto;
  -webkit-app-region: no-drag;
}
```

标签栏这类需要弹出菜单的容器不能使用会裁剪纵向溢出的 `overflow`。如果确实需要横向滚动，应增加独立的滚动包裹层，把菜单放在包裹层外。

### 3. 父级层叠上下文必须一起处理

如果菜单位于项目组、列表分区或带展开动画的容器中，先检查祖先是否存在 `transform`、`filter`、`contain` 或 `isolation`。菜单打开时，应让承载它的父级同步提升层级：

```css
.project-group.has-open-menu,
.sidebar-section.has-open-menu,
.conversation-row.has-open-menu {
  position: relative;
  z-index: 1000;
}
```

展开动画不要在结束后保留无意义的 `transform`。如果动画确实需要变换效果，优先使用 portal 将菜单渲染到 `document.body`，从 DOM 层级上脱离列表容器。

### 4. 事件冒泡和关闭逻辑

全局点击关闭菜单时，菜单内部必须阻止冒泡，否则点击菜单项会先触发全局关闭，再丢失目标事件：

```tsx
<div className="context-menu" onClick={(event) => event.stopPropagation()}>
  <button onClick={runAction}>操作</button>
</div>
```

右键事件应调用 `preventDefault()`，并将菜单坐标限制在窗口可视范围内。

## 开发检查清单

- [ ] 菜单容器和所有菜单项都有 `-webkit-app-region: no-drag`。
- [ ] 菜单及其祖先没有裁剪菜单溢出的 `overflow`。
- [ ] 菜单层级高于标题栏和内容层（通常 `z-index >= 80`）。
- [ ] 菜单容器 `pointer-events: auto`，菜单项不是意外的 `disabled`。
- [ ] 菜单内部点击不会冒泡到全局关闭处理器。
- [ ] 菜单打开时，承载它的项目组/分区父级也处于足够高的层级。
- [ ] 菜单祖先没有因展开动画残留的 `transform` 层叠上下文。
- [ ] 在窗口顶部、中部和底部右键打开菜单，逐项验证 hover 和 click。
- [ ] 窗口拖拽仍只发生在明确的拖拽区域，不会影响按钮和输入框。

## 相关修复

右侧工作区标签页菜单曾因标签栏的滚动裁剪和 Electron 拖拽区域叠加，出现只有第一项可命中的问题。会话菜单还曾因项目会话容器的层叠上下文被后续会话覆盖。修复方式是解除菜单祖先的纵向裁剪/残留 `transform`，并在菜单打开时同步提升项目组、分区和会话行层级。
