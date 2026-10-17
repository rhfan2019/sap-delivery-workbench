---
version: 1.1
name: SAP 智能交付工作台 · 中性白 + 海军蓝
date: 2026-10-16
description: >-
  面向 SAP 交付顾问的工作台。白色与浅灰构成层次，海军蓝只用于强调与操作；排版、留白与对话体验参考
  ChatGPT 与 Claude（用户 2026-10-16 选定），表格与表单保持企业应用的信息密度。

colors:
  canvas: '#FFFFFF' # 内容面：对话、表格、表单、文档
  page: '#F7F7F8' # 页面底色与侧边栏
  surface-muted: '#F2F3F5' # 用户气泡、表头、代码块、悬停
  surface-sunken: '#ECEDEF' # 选中行、按下
  hairline: '#E5E7EB' # 分隔线、卡片边框
  hairline-strong: '#D1D5DB' # 输入框边框、强调分隔
  control: '#9AA3AE' # 输入控件边框（对白底 ≥ 3:1 的非文字对比）
  ink: '#1F2328' # 正文与标题
  secondary: '#5F6672' # 次要文字（对白底 ≥ 4.5:1）
  tertiary: '#8B919A' # 占位、时间戳、脚注（只用于 12px 以上的辅助信息）
  primary: '#174B7A' # 海军蓝：主按钮、链接、选中、焦点
  primary-hover: '#0F3A61'
  primary-soft: '#EAF1F8' # 选中背景、强调标签底色
  on-primary: '#FFFFFF'
  focus: '#2F6FB3'
  success: '#1F7A4D'
  success-soft: '#E9F6EF'
  warning: '#8A5300'
  warning-soft: '#FFF5E1'
  danger: '#B42318'
  danger-soft: '#FEF0EF'

typography:
  family-sans: "Inter, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
  family-mono: "'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace"
  display: { size: 28px, line: 36px, weight: 600 } # 起始页问候语
  title-lg: { size: 20px, line: 28px, weight: 600 } # 页面标题、文档 H1
  title-md: { size: 17px, line: 26px, weight: 600 } # 区块标题、回复 H2
  title-sm: { size: 15px, line: 22px, weight: 600 } # 卡片标题、回复 H3
  reading: { size: 15px, line: 26px, weight: 400 } # 对话与文档正文
  body: { size: 14px, line: 22px, weight: 400 } # 界面默认
  caption: { size: 12px, line: 18px, weight: 400 } # 时间、计数、脚注
  code: { size: 13px, line: 20px, weight: 400 }
  sizes: { xs: 12px, sm: 13px, md: 14px, lg: 15px, xl: 17px, 2xl: 20px, 3xl: 28px } # --font-size-*
  weights: { regular: 400, medium: 500, semibold: 600 } # --font-weight-*；不用 700 及以上

# --space-N = N x 4px；页面区块间 24/32，组件内 8/12
spacing:
  {
    0-5: 2px,
    1: 4px,
    1-5: 6px,
    2: 8px,
    2-5: 10px,
    3: 12px,
    4: 16px,
    5: 20px,
    6: 24px,
    8: 32px,
    10: 40px,
    12: 48px,
    16: 64px,
  }

rounded: # --radius-*
  xs: 4px # 徽标、细小元素
  sm: 6px # 标签、小按钮
  md: 8px # 按钮、输入框、菜单项
  lg: 12px # 卡片、弹出层、表格外框
  xl: 16px # 大面板
  bubble: 18px # 用户气泡
  composer: 24px
  full: 9999px # 圆点、头像、胶囊

elevation:
  none: 'none' # 卡片默认无阴影，用边框分层
  raised: '0 1px 2px rgb(16 24 40 / 0.04), 0 4px 16px rgb(16 24 40 / 0.06)' # 输入框、浮动按钮
  popover: '0 8px 28px rgb(16 24 40 / 0.14)' # 下拉、弹出卡片

layout: # --layout-*
  sidebar: 246px
  sidebar-narrow: 220px # 1150px 以下
  sidebar-collapsed: 70px
  drawer: 480px # 右侧抽屉
  conversation: 760px # 对话列最大宽度，居中
  document: 820px # 文档阅读最大宽度
  page-gutter: 24px
  mobile-gutter: 16px
---

# 设计规范

本文件是全站界面风格的唯一规范。新增或修改页面前先读本文件；实现时只用这里的令牌（CSS 变量，见第 8 节），不写新的颜色值。需要新令牌时先改本文件。

## 1. 原则

1. **内容是主角，界面退后。** 白底、浅灰分层、细线分隔，不用重阴影、渐变和大面积色块。颜色只用来表达状态和可操作性。
2. **一个强调色。** 海军蓝只用于主操作、链接、选中和焦点；同一视图只有一个实心主按钮。
3. **层次靠字号与字重，不靠颜色和边框。** 标题 600、正文 400、辅助信息用次要色和 12px。
4. **过程默认收起，结论在前。** 智能助手的执行过程收成一行，回复先给结论；需要用户决定的事单独突出（见第 6 节）。
5. **企业密度。** 表格、表单、清单保持紧凑（行高 36–40px），对话与文档用阅读排版（15/26）。

## 2. 颜色

| 用途         | 令牌                                               | 说明                                       |
| ------------ | -------------------------------------------------- | ------------------------------------------ |
| 内容面       | `canvas` #FFFFFF                                   | 对话、表格、表单、文档                     |
| 页面与侧边栏 | `page` #F7F7F8                                     | 侧边栏与页面底色相同，内容面用白色浮在其上 |
| 浅灰面       | `surface-muted` #F2F3F5                            | 用户气泡、表头、代码块、悬停               |
| 分隔         | `hairline` #E5E7EB                                 | 1px；卡片边框、表格行线                    |
| 文字         | `ink` / `secondary` / `tertiary`                   | 三级，不再增加                             |
| 强调         | `primary` #174B7A                                  | 主按钮、链接、选中、焦点环                 |
| 状态         | `success` / `warning` / `danger` 及其 `-soft` 底色 | 文字用深色，底色用浅色；不用纯红、纯绿     |

- 状态色只表达状态：成功、需确认（琥珀）、错误。不用状态色做装饰。
- 链接用 `primary`，悬停加下划线；正文里不用彩色加粗。

## 3. 字体

- 界面统一无衬线：Inter + 苹方 / 微软雅黑。代码与 SAP 对象名（表、字段、函数）用等宽字体。
- 字号只用第 0 节的 8 级。界面默认 14px；对话与文档正文 15px、行高 26px。
- 字重只用 400 / 500 / 600。加粗正文只用于真正的关键词，一段里不超过一处。

## 4. 布局

- **应用框架**：左侧边栏（246px，与页面同色，细线分隔），右侧内容区。内容区顶部是页面标题行（高 56–64px，标题 17px/600）。
- **工作台页面**（开发清单、后台）：内容面白色，圆角 12px，细线边框；表格占满宽度。
- **对话页面**：对话列居中，最大 760px；输入框与对话列同宽；成果面板在右侧，可拖动宽度。
- **文档阅读**：正文最大 820px，目录在左。
- 间距用 4 的倍数；区块之间 24/32px，组件内部 8/12px。
- 窄屏（≤ 800px）：侧边栏收起为抽屉，页面边距 16px，头部按钮只留图标。

## 5. 组件

| 组件          | 规范                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| 主按钮        | `primary` 底、白字、圆角 8px、高 36px；每个视图最多一个                    |
| 次按钮        | 白底、`hairline-strong` 边框、`ink` 字；悬停 `surface-muted`               |
| 文字按钮      | 无边框，`secondary` 字，悬停 `surface-muted` 底                            |
| 输入框 / 下拉 | 高 36px、圆角 8px、`control` 边框；焦点为 2px `focus` 外框                 |
| 表格          | 表头 `surface-muted`、12–13px 次要色；行高 40px；行间 `hairline`；不画竖线 |
| 卡片          | 白底、`hairline` 边框、圆角 12px、内边距 16px；无阴影                      |
| 标签 / 徽章   | 圆角 6px、12px；状态用对应 `-soft` 底 + 深色字                             |
| 弹出层        | 白底、圆角 12px、`popover` 阴影；点击外部或 Esc 关闭                       |
| 提示条        | 浅色底 + 深色字 + 左侧图标；不用整块红色                                   |
| 空状态        | 一句标题 + 一句说明 + 一个操作，不道歉                                     |

## 6. 智能助手对话

参考 ChatGPT 与 Claude 的成熟做法：

- **起始页**（新对话）：页面中部是问候语（`display`，如“今天要梳理哪个需求？”），下方是大圆角输入框（圆角 24px、`raised` 阴影），输入框下方是 2–3 个建议入口（文字按钮）。不显示其他内容。
- **用户消息**：右对齐，`surface-muted` 底、圆角 18px、最大宽度 80%；作者与时间悬停时显示。
- **助手回复**：左对齐、无气泡、无“设计助手”标签；正文 15/26。回复下方一行操作图标（复制、时间）。
- **执行过程**：回复上方一行灰色文字（如“查阅 9 张表 · 编写 7 个章节 · 用时 3 分 57 秒 ›”），点击后展开为带边框的列表；运行中显示一行动态状态（见 [agent-conversation-ux.md](agent-conversation-ux.md)）。
- **回复排版**：H2 17px/600、H3 15px/600，段间距 12px；表格同第 5 节；SAP 对象名用等宽行内代码（`surface-muted` 底）。
- **需要用户决定**：提问卡片（白底、细线、圆角 12px），选项为单选列表，推荐项带“推荐”标签。已回答的问题收成“问题 → 选择”的紧凑记录。
- **成果**：回复末尾一行成果条（图标 + “功能说明书 · 第 n 版” + “打开”），点击在右侧成果面板打开。
- **输入框**：白底、圆角 24px、`raised` 阴影；左侧“添加文件”，右侧依次为 SAP 系统、模型、发送按钮（`primary` 圆形）。底栏文字统一 12px。

## 7. 可访问性

- 正文对比度 ≥ 4.5:1，控件边框与图标 ≥ 3:1。
- 所有可交互元素有可见焦点环（2px `focus`）；不能只用颜色区分状态。
- 尊重“减少动态效果”设置。

## 8. 实现映射（`apps/web/src/assets/theme.css`）

**强制规则（契约 1.13，`npm run check:architecture` 检查）**：`apps/web/src` 中只有 `theme.css` 可以写颜色、字体、字号、字重、间距和圆角的取值；其他样式一律引用下面的变量（可以用 `calc()`、`color-mix()` 组合变量，字号可以用 `em`）。模板里不用 Tailwind 调色板颜色类（如 `text-amber-700`），改用映射到令牌的类（`text-warning`、`text-success`、`text-destructive`、`text-muted-foreground` 等）。第三方内置组件 `components/ai-elements`、`components/ui` 除外。**改风格时只改本文件和 theme.css。**

颜色令牌的变量名沿用旧名，只换值：

| DESIGN 令牌                                           | CSS 变量                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `page`                                                | `--bg`、`--nav-bg`                                                                                 |
| `canvas`                                              | `--surface`                                                                                        |
| `surface-muted`                                       | `--hover`、`--surface-muted`                                                                       |
| `primary-soft`                                        | `--active`、`--nav-active`                                                                         |
| `hairline`                                            | `--border`、`--nav-border`                                                                         |
| `control`                                             | `--control-border`                                                                                 |
| `ink`                                                 | `--text`、`--nav-text`                                                                             |
| `secondary`                                           | `--muted`、`--nav-muted`                                                                           |
| `tertiary`                                            | `--text-tertiary`                                                                                  |
| `primary` / `primary-hover` / `on-primary`            | `--primary`、`--link` / `--primary-hover` / `--on-primary`                                         |
| `focus`                                               | `--focus`、`--nav-focus`                                                                           |
| `danger(-soft)` / `success(-soft)` / `warning(-soft)` | `--error-text`(`--error-bg`) / `--success-text`(`--success-bg`) / `--warning-text`(`--warning-bg`) |
| 字体                                                  | `--font-sans`、`--font-mono`                                                                       |
| 字号 / 字重                                           | `--font-size-xs`…`--font-size-3xl` / `--font-weight-regular`、`-medium`、`-semibold`               |
| 间距                                                  | `--space-0-5`…`--space-16`                                                                         |
| 圆角 / 阴影                                           | `--radius-xs`…`--radius-full` / `--shadow-raised`、`--shadow-popover`                              |
| 布局                                                  | `--layout-sidebar`、`--layout-sidebar-narrow`、`--layout-sidebar-collapsed`、`--layout-drawer`     |
| 图表                                                  | `--chart-1`…`--chart-3`（按系列顺序）                                                              |
| 标签色                                                | `--tag-{blue,green,orange,red,purple,teal,yellow}-bg` / `-text`（开发项标签，用户可选）            |
| 深色品牌区                                            | `--story-*`（登录页左侧、首页横幅，迁移前保留深蓝）                                                |

2026-10-16 已用脚本把全站写死值替换为最接近的令牌：颜色按用途在文字、背景、边框令牌中取最接近者，半透明色写作 `color-mix(in srgb, var(--令牌) N%, transparent)`；字号、间距、圆角取最接近的一级（小于 12px 的字号统一升到 12px）。

## 9. 迁移计划

| 批次 | 范围                                                            | 状态            |
| ---- | --------------------------------------------------------------- | --------------- |
| 0    | 全站写死值替换为令牌，并由检查器禁止新增（契约 1.13）           | 2026-10-16 完成 |
| 1    | 令牌（`theme.css`）、侧边栏、智能助手起始页与对话页             | 2026-10-16 完成 |
| 2    | 开发项工作区头部与成果面板、FSD 文档阅读：按第 5 节重排版式     | 待办            |
| 3    | 首页、开发清单（表格与筛选）：按第 5 节重排版式                 | 待办            |
| 4    | 后台管理（组织、成员、模型、SAP 连接、审计）：按第 5 节重排版式 | 待办            |
| 5    | 登录页：去掉 `--story-*` 深色区，按规范重做                     | 待办            |

第 2～5 批只调整版式和组件用法，取值仍只用令牌。

每批完成后在设计、开发两个阶段与窄屏下实际查看；提交前运行 `npm run check:architecture`、`npm run check`、`npm run test:unit`。

## 10. 不要做

- 不要新增颜色值；不要用渐变、发光、彩色大面积背景。
- 不要给卡片同时加边框和阴影；不要在卡片里再套卡片。
- 不要用整块红色表达错误；不要用状态色做装饰。
- 不要在对话里给助手加头像或气泡；不要默认展开执行过程。
- 不要把第三方品牌的字体、Logo 或名称用到产品里。
