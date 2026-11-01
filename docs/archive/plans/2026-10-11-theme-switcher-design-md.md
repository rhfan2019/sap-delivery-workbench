# 实施方案：基于 awesome-design-md 的主题切换功能

- **日期**：2026-10-11
- **范围**：前端 `apps/web` 首页 `page-heading` 顶部新增主题切换
- **形态**：下拉选择多套 awesome-design-md 风格主题 + 每套支持亮/暗模式
- **状态**：已废弃（被 [2026-10-16 主题系统](2026-10-16-theme-system.md)取代，后者又被 2026-10-17 [Plain 重写](2026-10-17-plain-style-redesign.md)取消换肤）

---

## 1. 目标与结论（结论先行）

在首页「你好，xxx」标题栏右侧（紧邻日期标签）新增一个主题切换控件，用户可：

1. 从预置的若干套 **awesome-design-md 品牌设计系统**（如 IBM / Vercel / Stripe / Linear / Apple）中选择一套；
2. 在同一套主题内切换 **亮 / 暗** 模式；
3. 选择持久化到 `localStorage`，刷新不丢失。

**技术结论**：本项目前端已是「CSS 变量驱动」的最优换肤结构，主题切换 = 覆盖 `theme.css` 里 `:root` 的 CSS 变量，**无需改动任何组件样式代码**。awesome-design-md 提供的是「配色/字体/风格规范」，本方案只取它的 **Color Palette 语义色**映射到现有变量，其余层（字体、阴影、间距）保持现状，避免过度工程。

---

## 2. 现状盘点（实测依据）

### 2.1 前端技术栈

| 项 | 实测值 |
|---|---|
| 框架 | Vue 3（`<script setup>`） |
| 构建 | Vite + Tailwind v4（`@tailwindcss/vite`，CSS-first，无 `tailwind.config.js`） |
| 状态管理 | **无 Pinia**（`stores/` 为空） |
| 样式入口 | `main.ts` 引入 `theme.css` → `elements.css` → `@import './main.css' layer(base)` |
| 主题变量文件 | `src/assets/theme.css`（纯 `:root` CSS 变量） |
| 路由 | `src/router`，首页为 `/home` |

### 2.2 主题变量现状（`theme.css`）

现有「海军蓝 · 双区聚焦」共 26 个变量，分三组：

| 组 | 变量 | 说明 |
|---|---|---|
| 工作区亮色 | `--bg` `--surface` `--text` `--muted` `--border` `--control-border` `--hover` `--active` `--link` `--primary` `--primary-hover` `--focus` `--on-primary` | 主工作区 |
| 侧边栏/导航（反色面） | `--nav-bg` `--nav-text` `--nav-muted` `--nav-border` `--nav-hover` `--nav-active` `--nav-focus` | `.sidebar`/`.login-story` 作用域覆盖 |
| 语义状态色 | `--error-bg` `--error-text` `--error-border` `--success-bg` `--success-text` `--scrim` | 错误/成功/遮罩 |

### 2.3 主题切换落点

- **控件位置**：`src/views/WorkspaceView.vue` 的 `isHome` 分支内 `.page-heading`（第 60-70 行区间），在 `<span class="date-label">` 旁新增。
- **现有样式**：`.page-heading`（`main.css:802`）是 `flex; justify-content: space-between`，左侧标题组、右侧 `date-label`。新增控件需与 `date-label` 一起包进一个右侧容器，保持对齐。

---

## 3. 方案设计

### 3.1 架构分层

```
awesome-design-md (DESIGN.md 品牌规范，仅取配色)
        │  语义映射（人工/一次性）
        ▼
src/theme/presets.ts     ← 每套主题的「变量名 → 色值」映射表（含 light/dark 两套）
        │
        ▼
src/composables/useTheme.ts  ← 状态 + 应用/持久化逻辑（无 Pinia，用 localStorage）
        │
        ▼
<ThemeSwitcher /> 组件  → 渲染在 page-heading，调用 useTheme
        │
        ▼
document.documentElement 写 data-theme / data-mode，CSS 变量覆盖生效
```

### 3.2 关键机制：变量覆盖而非替换

不改 `theme.css` 原文。新增一个 `theme-presets.css`，在 `theme.css` **之后**加载，按选择器的 `data-*` 属性覆盖 `:root` 变量：

```css
/* theme-presets.css（新增，在 theme.css 之后引入） */
:root[data-theme="ibm"][data-mode="light"] {
  --bg: #f4f4f4;
  --primary: #0f62fe;       /* IBM Carbon Blue 60 */
  --text: #161616;          /* IBM Gray 100 */
  /* ...其余变量同理 */
}
:root[data-theme="ibm"][data-mode="dark"] {
  --bg: #161616;
  --primary: #78a9ff;       /* IBM Blue 40 */
  --text: #f4f4f4;
  /* ... */
}
```

`data-theme` 标识品牌（ibm/vercel/stripe/...），`data-mode` 标识亮暗。二者组合成 2×N 套皮肤。

### 3.3 主题状态管理（无 Pinia）

用轻量组合式函数替代全局 store：

```ts
// src/composables/useTheme.ts（伪代码，示意）
const theme = ref(load('sw.theme', 'navy'));
const mode  = ref(load('sw.mode', 'light'));

function apply() {
  const el = document.documentElement;
  el.setAttribute('data-theme', theme.value);
  el.setAttribute('data-mode', mode.value);
  save('sw.theme', theme.value);
  save('sw.mode', mode.value);
}
```

要点：

- 默认主题 `navy` = 现有「海军蓝」，保证**首次进入不跳变**。
- 在 `App.vue` 或 `main.ts` 挂载前同步调用一次 `apply()`，避免 FOUC（首屏闪白）。
- 主题状态通过组合式函数的模块级 `ref` 共享，无需 Pinia。

### 3.4 主题切换控件

新增 `src/components/ThemeSwitcher.vue`，UI 参考项目现有 `components/ui/dropdown-menu/`：

- 触发器：一个图标按钮（`AppIcon`，可用「palette/brush」类图标，若无则用文字「主题」）。
- 下拉：品牌主题列表（每个带色点预览）+ 顶部亮/暗切换开关。
- 选中态：当前主题高亮 + 勾选标记。

### 3.5 预置主题清单（awesome-design-md → 变量映射）

首期建议 4 套（企业级/开发者气质，契合本项目），均可从 `design-md/<品牌>/DESIGN.md` 的 Color Palette 章节取值：

| data-theme | 来源 DESIGN.md | 主色印象 | light/dark 备注 |
|---|---|---|---|
| `navy` | 现有默认（非 awesome） | 海军蓝，双区聚焦 | 保留现状，兜底 |
| `ibm` | `design-md/ibm` | Carbon 蓝，结构化企业风 | 亮=白底蓝、暗=灰黑底亮蓝 |
| `vercel` | `design-md/vercel` | 黑白极简，Geist | 暗=纯黑，对比强 |
| `stripe` | `design-md/stripe` | 紫渐变，weight-300 | 亮=白底紫、暗=深底紫 |
| `linear` | `design-md/linear` | 极简紫，工程化 | 暗=近黑，紫强调 |

> 落地方案只取各 DESIGN.md 的 **Color Palette & Roles** 一节的语义色，映射到 §2.2 的变量表。字体/阴影/间距不引入（见 §6 风险）。

---

## 4. 实施步骤（Task 拆分）

| # | 步骤 | 涉及文件 | 说明 |
|---|---|---|---|
| 1 | 抽取品牌色卡 | 读 `design-md/{ibm,vercel,stripe,linear}/DESIGN.md` | 仅取 Color Palette，整理成语义色对照 |
| 2 | 新增主题预设 | `src/theme/presets.ts` + `src/assets/theme-presets.css` | 变量名→色值映射 + 覆盖层 CSS |
| 3 | 主题状态 | `src/composables/useTheme.ts` | ref + localStorage + apply() |
| 4 | 切换控件 | `src/components/ThemeSwitcher.vue` | 下拉 + 亮暗开关 |
| 5 | 挂载接入 | `main.ts`（CSS 引入顺序）+ `WorkspaceView.vue`（page-heading 渲染） | 先 apply 防 FOUC |
| 6 | 验证 | `npm run typecheck` + 手动跑 :5173 | 逐主题逐模式目测 |

---

## 5. 需要遵守的项目约束

1. **目录契约**（`docs/architecture/repository-contract.md`）：新增文件必须落在有明确职责的目录。本方案新增：
   - `src/theme/`（新目录，主题预设，职责单一）——需确认是否违反「禁止新增没有明确职责的根目录」；若保守，可并入现有 `src/lib/` 或 `src/assets/`。
   - `src/components/ThemeSwitcher.vue` —— `components/` 是已有职责目录，合规。
   - `src/composables/useTheme.ts` —— `composables/` 目录当前**不存在**，需确认是否新建，或放入 `src/lib/`。
2. 提交前跑 `npm run check:architecture`。
3. 不触碰 `theme.css` 原文（只在其后追加覆盖层），避免影响现有样式回归。

---

## 6. 风险与建议（有异议直接讲）

1. **awesome-design-md 的价值边界**：它适合「从零生成风格一致的页面」，对「给已有变量化项目加多套配色」偏重——每个 DESIGN.md 2~4 万字节，全塞进上下文很占 token。本方案已做裁剪：**只取配色一节，人工落成 presets 表**，避免把整份 DESIGN.md 喂给 agent。
2. **字体/阴影换肤不在本次范围**：DESIGN.md 的字体（如 Vercel 的 Geist、IBM 的 Plex）需额外引入字体文件 + 改 Tailwind/font stack，属于契约管辖区且收益低。建议首期只换「色」。
3. **FOUC 风险**：主题覆盖层 CSS 加载顺序若在首屏前未生效会闪白，须在 `main.ts` 里确保 `apply()` 同步执行、且 `theme-presets.css` 紧跟 `theme.css` 引入。
4. **亮暗与品牌解耦**：若某品牌只有暗色设计（如 Vercel 主视觉偏黑），它的 light 模式需人工补一套合理亮色，不能照搬（DESIGN.md 不一定给亮色 tokens）。落地时对缺亮色的品牌要么补、要么标注「该主题仅暗色」。

---

## 7. 待你确认的决策点

1. **首期主题清单**：4 套（ibm/vercel/stripe/linear）+ 默认 navy 是否够？是否要加 Apple / HashiCorp / Linear 之外的其他？
2. **新目录**：是否允许新建 `src/composables/` 与 `src/theme/`？还是并入 `src/lib/`？
3. **控件位置**：确认放在 `page-heading` 右侧（日期标签旁），还是也要在「我的项目」等子页可见（全局）。

确认后，我按 §4 顺序落地并先产出「现有变量 → 各主题色值」对照表给你复核。
