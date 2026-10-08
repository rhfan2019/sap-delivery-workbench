# FS 智能工作区前端设计与原型说明

2026-10-03 · 设计交接补充版。主设计中的业务原则仍有效。本文件确定界面与前端实现方式；可点击原型是视觉及交互参考，不是已经开发完成的产品。

## 1 直接查看

打开 [交互原型](../../archive/fs-workspace-prototype/index.html)，或本机预览服务 [http://127.0.0.1:8766/](http://127.0.0.1:8766/)。原型由 index.html/styles.css/app.js 构成，无外部资源依赖；可以直接打开 index.html。服务关闭后仍可从文件打开。

原型顶部的场景与角色切换栏只供评审，不进入正式产品。所有人名、文档、证据与状态都是合成数据；上传仅显示所选文件名，发送消息仅触发预设演示，导出仅展示状态，不上传资料、不连接模型/SAP、不生成真实批准记录。

建议体验路径：FS管理→继续编写→确认容差→第3章“修改此段”→发送→接受关联修改→观察旧确认失效；再切到“并发冲突”接受修改，查看保留候选与重新合并。切“证据齐备”→提交评审→分别切换技术评审人和业务审批人→通过→发布V4，最后查看版本页基线变化。

## 2 页面范围与路由

共同路由前缀P=`/projects/:projectId/development-items/:itemId/fs`，位于现有AppLayout之内。项目ID属于路由，不从最后一次项目偏好猜测。进入时核对项目权限再同步projectContext，避免深链接展示错误项目。

| 页面 | 路由 | 核心任务与布局 |
|---|---|---|
| FS管理 | P | 标题/责任人/业务状态；左文档与依据、问题，右材料与活动；主按钮进入工作区 |
| AI工作区 | P/workspace?session=ID | 双区对话与文档；固定文档版本、上下文入口、阶段外显结果；不展示内部调度细节 |
| 版本 | P/versions?left=ID&right=ID | 版本列表、差异、恢复为新草稿；明确基线、送审、草稿 |
| 评审 | P/reviews/:reviewId | 发布门禁、技术/业务审批、批准后显式发布；绑定不可变版本 |

附件、证据、问题、上下文、变更影响与导出为抽屉/对话框，不增加无意义一级菜单。现有DeliveryView的FS页签改为FS管理入口，旧FsEditor保留给尚未启用新工作区的项目；迁移工作区后旧接口拒绝写入，防双写绕过。

## 3 视觉规格

沿用apps/web/src/assets/theme.css的海军蓝体系：主色#174b7a、导航#0a2240、背景#f3f5f8、正文#0a2240、次级文字#42546a。正式实现使用已有变量，不在新组件重复硬编码色值。状态新增warning变量应放theme.css并做对比度检查，不按页面各自调色。

- 桌面1440px：侧栏复用AppLayout；内容边距24—32px；标题24px/32px，正文14px/22px，辅助12px/18px。原型纸张内缩小以呈现文档密度，正式产品提供100%/125%预览缩放，不以小字号硬塞全部内容。
- 管理页约62/38两栏，卡片间距20px；工作区38/62双栏，支持32%—50%对话宽度调节，默认38%。旧主设计40/60为近似值，以本文件为实现值。
- 工作区在宽度≥1024px时双栏且独立滚动；760—1023px默认单区切换，允许用户选双栏；<760px必须“对话/文档”切换，禁止整页横向滚动。表格可在自身容器横滚。
- 按钮高度36px，触摸目标至少44px；主按钮每个操作区域一个。圆角：控件6—8px、面板10px。图标复用AppIcon/@lucide/vue，不把原型中的字符符号作为最终图标。
- 文档纸张白底、轻阴影；内容最大宽800px；段落/表格使用同一RenderModel。未验证提示与证据链接就地呈现。
- 成功、警告、错误均带文字，不能仅凭颜色；保留键盘焦点、无障碍名称与焦点恢复。dialog关闭回到原触发按钮；状态播报使用aria-live，不能逐token播报。

## 4 关键组件交接

所有组件放`apps/web/src/features/fs-workspace/`，只被整个产品复用的底层控件才上提components。建议按功能邻近组织，详见engineering-design.md目录树。

| 组件 | Props / 事件 | 责任与限制 |
|---|---|---|
| FsManagementView | route projectId/itemId | 首次GET快照、管理摘要，创建工作区只能POST |
| FsWorkspaceView | route/context | 组装双区，不包含HTTP、模型或SQL细节 |
| ConversationPane | session/messages/run/capabilities；send/cancel | 消息分页、发送、补充排队，不自己推进审批 |
| ClarificationCard | subject/revision/hash/options；confirm | 显示具体确认对象；重复提交防抖不替代服务器幂等 |
| Composer | disabled/pendingUploads；send/upload | Enter发送、Shift+Enter换行；输入法composing时不发送；保留失败输入 |
| DocumentPane | document/template/mode；selectionAction | 五章导航、引用定位、显示当前固定版本；不从聊天提取最新版 |
| FsBlockRenderer | RenderBlock | 白名单AST渲染，无v-html不可信原文 |
| ChangeSetReview | base/proposal/impacts；acceptGroup/reject | 展示全部受影响对象，依赖组原子接受；未生成完整候选不可接受 |
| EvidenceDrawer | evidence/verification/sourceRegion | 来源、定位、支持结论、系统时间与限制分别展示 |
| AttachmentDrawer | upload/parse results；retryRegion | 文件接收/安全检查/解析/部分成功分开 |
| VersionCompare | left/right/structuredDiff | 稳定ID对比，删除、新增、改动、确认失效分开 |
| ReviewPanel | review/gateResults/approvals/capabilities | 角色动作由capabilities控制，服务端再次判断 |
| ExportDialog | selectedVersion/exports | 选版本、格式、水印；不抓取浏览器DOM生成正式文件 |
| ConflictDialog | base/local/remote；rebase | 保留本地候选；明确冲突与可独立合并块 |

状态由useFsWorkspace组合式函数持有，以workspace_id隔离，不新增全局Pinia依赖。其他组合函数各管messages、events、changes、selection；同一份draftHead只有一个事实来源。页面卸载关闭EventSource/AbortController，project/item变化时取消旧请求并检查scope token。

## 5 状态与行为规格

| 场景 | 显示 | 可操作与验证 |
|---|---|---|
| 首次进入 | 已带入上下文、输入起点、文档空态 | 发消息/上传；创建请求幂等，不能GET自动建工作区 |
| 文件处理中 | 接收、安全检查、解析覆盖 | 可继续写；材料未解析前标记尚未纳入 |
| 部分解析 | 页/区域失败定位 | 可以使用成功区域，关键缺失不得假装完整；重试仅受影响区域 |
| 等业务确认 | 对象版本、原文、推荐及后果 | 只确认指定版本；技术字段不问业务用户猜 |
| 正在生成 | 已保存文档+候选生成状态 | 新消息排队，取消可用；临时token不能改已保存文档 |
| 修改候选 | 前后差异、关联影响、失效信息 | 接受完整依赖组或拒绝；接受前不改head |
| 保存失败 | “候选已保留，保存结果待确认” | 先查命令收据；不能重新随机幂等键重复保存 |
| 并发冲突 | base/local/remote三方 | 无冲突块也需重跑影响；同块由作者选择 |
| 待评审 | 固定V4，草稿可另行修订 | 早期评审可含release缺口；approve/publish严格阻断 |
| 已批准未发布 | V4批准，V3仍为开发依据 | 发布者明确发布后替代，不能自动切换开发入口 |
| 基线已发布 | 当前基线V4、旧V3已替代 | 修订新草稿；旧审批不能复制 |
| 只读/权限撤销 | 可读范围与说明 | 隐藏或禁用写按钮；401/403清除敏感缓存和断开事件 |

原型为便于演示，“提交评审”默认要求模拟证据齐备；**正式产品遵循主设计：允许带release级问题的早期评审，但严禁批准/发布**。这是原型的演示简化，不得照抄到门禁逻辑。保存版本、上传、导出目前均只演示，不应被AI复制成toast代替实际功能。

## 6 交互验收与截图

原型QA脚本`prototype/qa.cjs`在独立浏览器检查：管理/工作区、确认、修改接受后失效、冲突、取消迟到候选、双角色审批与发布、只读、390px切换与溢出、首次生成和JS错误。结果见`prototype/qa-report.json`；这不是产品端到端测试。

截图位于`prototype/screenshots/`，主要视图包括管理、工作区、修改审阅、冲突、评审、版本与移动端。实施时按相同合成数据做截图回归，并补充输入法、多页长表、放大200%、键盘操作与权限实时撤销测试。

## 7 开发不得忽略的差异

原型不是模板代码：正式项目必须使用Vue组件、既有身份和项目状态、强类型HTTP契约、服务端事件与真实版本；不能把原型中的单一state、预设对话、角色下拉框、setTimeout成功或本地模拟证据搬进生产。允许参考布局、文案、组件边界和状态表现。
