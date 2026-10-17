<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Bell,
  CircleCheck,
  CircleHelp,
  CodeXml,
  FileText,
  Filter,
  Layers,
  Library,
  Link2,
  ListChecks,
  MoreHorizontal,
  NotebookPen,
  PanelRight,
  Plus,
  Search,
  Settings,
  Sparkles,
  StickyNote,
  Tag,
  Upload,
  Workflow,
  LayoutGrid,
  CircleDot,
  Clock3,
  ArrowUpRight,
  CornerUpLeft,
  ArrowRight,
  MessageSquare,
} from '@lucide/vue';
import BaseActionBar from '../components/base/BaseActionBar.vue';
import BaseAvatar from '../components/base/BaseAvatar.vue';
import BaseBanner from '../components/base/BaseBanner.vue';
import BaseButton from '../components/base/BaseButton.vue';
import BaseComposer from '../components/base/BaseComposer.vue';
import BaseDialog from '../components/base/BaseDialog.vue';
import BaseEmptyState from '../components/base/BaseEmptyState.vue';
import BaseIconButton from '../components/base/BaseIconButton.vue';
import BaseInput from '../components/base/BaseInput.vue';
import BaseKbd from '../components/base/BaseKbd.vue';
import BaseMenu from '../components/base/BaseMenu.vue';
import BaseMenuItem from '../components/base/BaseMenuItem.vue';
import BaseMenuSeparator from '../components/base/BaseMenuSeparator.vue';
import BaseMessage from '../components/base/BaseMessage.vue';
import BaseNavItem from '../components/base/BaseNavItem.vue';
import BasePopover from '../components/base/BasePopover.vue';
import BasePropertyRow from '../components/base/BasePropertyRow.vue';
import BaseSection from '../components/base/BaseSection.vue';
import BaseSelect from '../components/base/BaseSelect.vue';
import BaseSkeleton from '../components/base/BaseSkeleton.vue';
import BaseTable from '../components/base/BaseTable.vue';
import BaseTabs from '../components/base/BaseTabs.vue';
import BaseTag from '../components/base/BaseTag.vue';
import BaseTimelineEvent from '../components/base/BaseTimelineEvent.vue';
import BaseToaster from '../components/base/BaseToaster.vue';
import BaseTooltip from '../components/base/BaseTooltip.vue';
import { toast } from '../components/base/toast';

// Development only (contract 1.15): every base component and state, laid out the way the
// pages will use them, to compare with Plain before pages are rewritten.
// ?view=list | record | controls: each view has the shell Plain uses for that kind of page.
const route = useRoute();
const view = computed(() => String(route.query.view ?? 'list'));
const scope = ref('all');
const search = ref('');
const module = ref('');
const reply = ref(false);
const draft = ref('');
const dialog = ref(false);
const rows = [
  {
    code: '00028',
    name: '账龄分析表（V1）',
    module: 'FICO',
    kind: '功能',
    fsd: ['已完成', 'green'],
    dev: ['进行中', 'blue'],
    owner: '工作台管理员',
    time: '10 分钟前',
  },
  {
    code: '00027',
    name: '销售订单到发票的全流程凭证追踪',
    module: 'SD',
    kind: '报表',
    fsd: ['进行中', 'blue'],
    dev: ['未开始', 'neutral'],
    owner: '樊瑞辉',
    time: '2 小时前',
  },
  {
    code: '00026',
    name: '批量销售订单创建并自动生成交货单',
    module: 'SD',
    kind: '功能',
    fsd: ['已延误', 'red'],
    dev: ['未开始', 'neutral'],
    owner: '李晓明',
    time: '昨天',
  },
  {
    code: '00025',
    name: '交货到期清单与逾期分析（V3）',
    module: 'SD',
    kind: '报表',
    fsd: ['已完成', 'green'],
    dev: ['已完成', 'green'],
    owner: '王芳',
    time: '10/14',
  },
] as const;
</script>
<template>
  <div class="gallery" :class="'view-' + view">
    <!-- Shell: rail and secondary menu (DESIGN.md 4.1) -->
    <aside class="rail" aria-label="图标栏">
      <span class="brand">S</span>
      <BaseIconButton label="工作台"><LayoutGrid /></BaseIconButton>
      <BaseIconButton label="开发管理" pressed><Layers /></BaseIconButton>
      <BaseIconButton label="知识与资产"><Library /></BaseIconButton>
      <BaseIconButton label="后台管理"><Settings /></BaseIconButton>
      <span class="rail-end"></span>
      <BaseIconButton label="通知"><Bell /></BaseIconButton>
      <BaseIconButton label="帮助"><CircleHelp /></BaseIconButton>
      <BaseAvatar name="樊瑞辉" :size="24" />
    </aside>
    <nav v-if="view !== 'record'" class="menu" aria-label="二级菜单">
      <div class="menu-head">
        <strong>虚拟测试项目</strong>
        <BaseIconButton label="搜索" kbd="Ctrl+K" size="sm"><Search /></BaseIconButton>
      </div>
      <p class="menu-title">开发管理</p>
      <BaseNavItem to="/dev/components" label="开发概览"
        ><template #icon><LayoutGrid /></template
      ></BaseNavItem>
      <BaseNavItem to="/dev/components" label="开发清单" :count="26" active
        ><template #icon><ListChecks /></template
      ></BaseNavItem>
      <BaseNavItem to="/dev/components" label="我的 FSD" :count="2"
        ><template #icon><FileText /></template
      ></BaseNavItem>
      <BaseNavItem to="/dev/components" label="我的开发" :count="9"
        ><template #icon><CodeXml /></template
      ></BaseNavItem>
      <p class="menu-title">浏览</p>
      <BaseNavItem to="/dev/components" label="标签"
        ><template #icon><Tag /></template
      ></BaseNavItem>
      <BaseNavItem to="/dev/components" label="流程"
        ><template #icon><Workflow /></template
      ></BaseNavItem>
    </nav>

    <main class="panels">
      <!-- List page (DESIGN.md 6.1) -->
      <section v-if="view === 'list'" class="panel">
        <header class="page-head">
          <ListChecks class="page-icon" />
          <h1>开发清单</h1>
          <BaseButton variant="primary" kbd="N"
            ><template #icon><Plus /></template>新建开发项</BaseButton
          >
        </header>
        <div class="toolbar">
          <BaseTabs
            v-model="scope"
            label="清单范围"
            :tabs="[
              { id: 'all', label: '全部', count: 26 },
              { id: 'fsd', label: '我的 FSD', count: 2 },
              { id: 'dev', label: '我的开发', count: 9 },
              { id: 'late', label: '计划逾期', count: 0 },
            ]"
          />
          <span class="toolbar-end">
            <BaseButton variant="ghost" size="sm" kbd="F"
              ><template #icon><Filter /></template>筛选</BaseButton
            >
          </span>
        </div>
        <div class="search">
          <BaseInput v-model="search" placeholder="搜索编号、名称、事务码或开发对象"
            ><template #icon><Search /></template
          ></BaseInput>
        </div>
        <BaseTable>
          <table>
            <thead>
              <tr>
                <th>编号</th>
                <th>开发名称</th>
                <th>模块</th>
                <th>FSD</th>
                <th>开发</th>
                <th>负责人</th>
                <th>更新</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.code" :aria-selected="i === 0">
                <td class="muted-cell">{{ r.code }}</td>
                <td class="primary-cell">{{ r.name }}</td>
                <td>
                  <BaseTag variant="outline"
                    ><template #icon><CodeXml /></template>{{ r.module }}</BaseTag
                  >
                </td>
                <td>
                  <BaseTag :tone="r.fsd[1]">{{ r.fsd[0] }}</BaseTag>
                </td>
                <td>
                  <BaseTag :tone="r.dev[1]">{{ r.dev[0] }}</BaseTag>
                </td>
                <td>
                  <span class="person"><BaseAvatar :name="r.owner" :size="20" />{{ r.owner }}</span>
                </td>
                <td class="muted-cell">{{ r.time }}</td>
                <td>
                  <BaseMenu align="end">
                    <template #trigger
                      ><BaseIconButton label="更多操作" size="sm" :tooltip="false"
                        ><MoreHorizontal /></BaseIconButton
                    ></template>
                    <BaseMenuItem tone="purple" kbd="D"
                      ><template #icon><Sparkles /></template>设计</BaseMenuItem
                    >
                    <BaseMenuItem tone="blue" kbd="V"
                      ><template #icon><CodeXml /></template>开发</BaseMenuItem
                    >
                    <BaseMenuItem tone="green" note="四个阶段都完成后可用" kbd="E" disabled
                      ><template #icon><CircleCheck /></template>标为完成</BaseMenuItem
                    >
                    <BaseMenuSeparator />
                    <BaseMenuItem danger
                      ><template #icon><MoreHorizontal /></template>删除</BaseMenuItem
                    >
                  </BaseMenu>
                </td>
              </tr>
            </tbody>
          </table>
        </BaseTable>
      </section>

      <!-- Record page (DESIGN.md 6.3) -->
      <section v-if="view === 'record'" class="panel record">
        <header class="record-head">
          <BaseAvatar name="SD" hue="purple" :size="24" />
          <BaseTag tone="yellow">设计</BaseTag>
          <span class="record-code">00028</span>
          <strong class="record-title">账龄分析表（V1）</strong>
          <span class="record-time"><MessageSquare />10 分钟前</span>
          <span class="toolbar-end">
            <BaseIconButton label="属性面板" pressed><PanelRight /></BaseIconButton>
            <BaseIconButton label="更多"><MoreHorizontal /></BaseIconButton>
          </span>
        </header>
        <div class="record-body">
          <div class="conversation">
            <div class="timeline">
              <p class="date">今天</p>
              <BaseTimelineEvent time="10 分钟前"
                ><strong>工作台管理员</strong> 将 FSD 状态改为
                <BaseTag tone="blue">进行中</BaseTag></BaseTimelineEvent
              >
              <BaseTimelineEvent time="9 分钟前"
                ><template #icon><Sparkles /></template><strong>设计助手</strong> 查阅了 9 张表
                <BaseTag variant="outline">VBAK</BaseTag
                ><BaseTag variant="outline">LIKP</BaseTag></BaseTimelineEvent
              >
              <BaseMessage author="工作台管理员" time="8 分钟前" tone="note" :avatar="false">
                <template #badge><StickyNote class="note-icon" /></template>
                <p>客户希望先看到账龄区间可配置的方案，再决定是否做批处理。</p>
                <template #footer>内部备注，助手会读取，但不会出现在文档里</template>
              </BaseMessage>
              <BaseMessage author="樊瑞辉" time="6 分钟前">
                <p>请阅读我上传的 ABAP 程序，然后基于该程序编写 FSD。</p>
              </BaseMessage>
              <BaseBanner tone="blue"
                ><template #icon><CircleDot /></template><strong>设计助手</strong> 正在等待你回答 2
                个问题</BaseBanner
              >
              <BaseTimelineEvent
                ><template #icon><Sparkles /></template>生成了功能说明书第 3 版，改动 25
                个章节</BaseTimelineEvent
              >
              <div class="suggest">
                <button type="button" class="suggest-button">打开功能说明书</button>
              </div>
            </div>
            <div class="bar-area">
              <BaseComposer
                v-if="reply"
                v-model="draft"
                title="回复设计助手"
                placeholder="描述需求，或继续追问…"
                send="发送"
                @close="reply = false"
                @submit="(toast('已发送'), (draft = ''), (reply = false))"
                ><template #title>回复 <strong>设计助手</strong></template>
                <template #tools>
                  <BaseIconButton label="上传资料" size="sm"><Upload /></BaseIconButton>
                  <BaseIconButton label="插入链接" size="sm"><Link2 /></BaseIconButton>
                </template>
              </BaseComposer>
              <BaseActionBar>
                <div>
                  <BaseButton variant="ghost" kbd="R" @click="reply = true"
                    ><template #icon><CornerUpLeft /></template>回复</BaseButton
                  >
                  <BaseButton variant="ghost" kbd="N"
                    ><template #icon><NotebookPen /></template>备注</BaseButton
                  >
                  <BaseMenu side="top">
                    <template #trigger
                      ><BaseButton variant="ghost"
                        ><template #icon><MoreHorizontal /></template>更多</BaseButton
                      ></template
                    >
                    <BaseMenuItem tone="yellow" note="未设置升级路径" kbd="X"
                      ><template #icon><ArrowUpRight /></template>升级处理</BaseMenuItem
                    >
                    <BaseMenuItem tone="purple" kbd="W"
                      ><template #icon><Clock3 /></template>等待业务确认</BaseMenuItem
                    >
                    <BaseMenuItem tone="green" kbd="E"
                      ><template #icon><CircleCheck /></template>标为完成</BaseMenuItem
                    >
                    <BaseMenuItem kbd="J"
                      ><template #icon><ArrowRight /></template>下一个</BaseMenuItem
                    >
                  </BaseMenu>
                </div>
                <div>
                  <BaseButton variant="ghost" kbd="B"
                    ><template #icon><Sparkles /></template>让助手修订</BaseButton
                  >
                </div>
              </BaseActionBar>
            </div>
          </div>
          <aside class="details" aria-label="开发项属性">
            <BaseSection title="开发项">
              <p class="details-title">账龄分析表（V1）</p>
              <dl>
                <BasePropertyRow label="模块"
                  ><BaseTag variant="outline">FICO</BaseTag></BasePropertyRow
                >
                <BasePropertyRow label="类型">功能</BasePropertyRow>
                <BasePropertyRow label="优先级">中</BasePropertyRow>
                <BasePropertyRow label="标签"
                  ><BaseTag tone="blue">测试案例第一批</BaseTag
                  ><BaseTag tone="purple">批处理</BaseTag></BasePropertyRow
                >
                <BasePropertyRow label="业务 Owner" empty />
              </dl>
            </BaseSection>
            <BaseSection title="阶段">
              <dl>
                <BasePropertyRow label="FSD"
                  ><BaseAvatar name="工作台管理员" :size="20" />工作台管理员<BaseTag tone="green"
                    >已完成</BaseTag
                  ></BasePropertyRow
                >
                <BasePropertyRow label="开发"
                  ><BaseAvatar name="李晓明" :size="20" />李晓明<BaseTag tone="blue"
                    >进行中</BaseTag
                  ></BasePropertyRow
                >
              </dl>
            </BaseSection>
            <BaseSection title="资料">
              <BaseEmptyState
                title="还没有资料"
                text="上传需求说明、旧程序或接口文档，助手编写时会参考。"
                ><template #icon><Link2 /></template
                ><BaseButton size="sm"
                  ><template #icon><Plus /></template>上传资料</BaseButton
                ></BaseEmptyState
              >
            </BaseSection>
          </aside>
        </div>
      </section>

      <!-- Controls and states -->
      <section v-if="view === 'controls'" class="panel controls">
        <h2>按钮</h2>
        <div class="row">
          <BaseButton variant="primary" kbd="N"
            ><template #icon><Plus /></template>新建开发项</BaseButton
          >
          <BaseButton>次按钮</BaseButton>
          <BaseButton variant="ghost" kbd="F"
            ><template #icon><Filter /></template>筛选</BaseButton
          >
          <BaseButton variant="danger">删除</BaseButton>
          <BaseButton variant="primary" loading>保存中</BaseButton>
          <BaseButton disabled>不可用</BaseButton>
          <BaseButton size="sm">小按钮</BaseButton>
        </div>
        <h2>图标按钮、快捷键、提示</h2>
        <div class="row">
          <BaseIconButton label="设置"><Settings /></BaseIconButton>
          <BaseIconButton label="属性面板" pressed><PanelRight /></BaseIconButton>
          <BaseIconButton label="打开" size="sm"><ArrowUpRight /></BaseIconButton>
          <BaseKbd keys="Ctrl+K" /><BaseKbd keys="R" /><BaseKbd keys="Ctrl+Enter" />
          <BaseTooltip text="悬停 0.4 秒后出现" kbd="?"
            ><BaseButton variant="ghost">悬停看提示</BaseButton></BaseTooltip
          >
        </div>
        <h2>输入</h2>
        <div class="row">
          <BaseInput v-model="search" placeholder="搜索"
            ><template #icon><Search /></template
          ></BaseInput>
          <BaseSelect
            v-model="module"
            label="模块"
            placeholder="全部模块"
            :options="[
              { value: 'FICO', label: 'FICO' },
              { value: 'SD', label: 'SD' },
              { value: 'MM', label: 'MM' },
            ]"
          />
          <BasePopover>
            <template #trigger
              ><BaseButton
                ><template #icon><Filter /></template>弹出层</BaseButton
              ></template
            >
            <p class="popover-text">筛选面板、选择器等小表单放在这里。</p>
          </BasePopover>
          <BaseButton @click="dialog = true">打开对话框</BaseButton>
          <BaseButton @click="toast('已保存', 'green')">显示消息提示</BaseButton>
        </div>
        <h2>标签与头像</h2>
        <div class="row">
          <BaseTag>未开始</BaseTag><BaseTag tone="blue">进行中</BaseTag
          ><BaseTag tone="green">已完成</BaseTag><BaseTag tone="red">已延误</BaseTag
          ><BaseTag strike>已取消</BaseTag><BaseTag tone="yellow">测试</BaseTag
          ><BaseTag tone="purple">批处理</BaseTag
          ><BaseTag variant="outline"
            ><template #icon><CodeXml /></template>VBAK</BaseTag
          >
          <BaseAvatar name="樊瑞辉" :size="20" /><BaseAvatar name="李晓明" /><BaseAvatar
            name="王芳"
            :size="32"
          />
        </div>
        <h2>色带与加载</h2>
        <div class="stack">
          <BaseBanner tone="yellow"
            ><template #icon><Clock3 /></template>计划完成日期已过 2 天</BaseBanner
          >
          <BaseBanner tone="green"
            ><template #icon><Sparkles /></template>助手建议：先补充权限检查章节</BaseBanner
          >
          <BaseSkeleton width="60%" /><BaseSkeleton width="40%" />
        </div>
      </section>
    </main>
    <BaseDialog
      v-model:open="dialog"
      title="删除开发项"
      description="删除后无法恢复，相关对话与文档也会一并删除。"
    >
      <p class="popover-text">确认删除 00026 批量销售订单创建并自动生成交货单？</p>
      <template #footer>
        <BaseButton @click="dialog = false">取消</BaseButton>
        <BaseButton variant="primary" @click="dialog = false">删除</BaseButton>
      </template>
    </BaseDialog>
    <BaseToaster />
  </div>
</template>
<style scoped>
.gallery {
  display: grid;
  grid-template-columns: var(--layout-rail) var(--layout-nav) minmax(0, 1fr);
  min-height: 100dvh;
  background: var(--page);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: var(--font-14);
  line-height: var(--leading-20);
}
.rail {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  height: 100dvh;
  padding: var(--space-3) 0;
}
.brand {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-bottom: var(--space-2);
  border-radius: var(--radius-6);
  background: var(--blue-solid-1);
  color: var(--neutral-on-solid);
  font-weight: var(--weight-550);
}
.rail-end {
  flex: 1;
}
.menu {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  height: 100dvh;
  padding: var(--space-3) var(--space-2);
}
.menu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-2) var(--space-3);
}
.menu-head strong {
  font-weight: var(--weight-550);
}
.menu-title {
  margin: var(--space-3) 0 var(--space-1);
  padding: 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-14);
}
.menu-title:first-of-type {
  margin-top: 0;
  color: var(--text);
  font-weight: var(--weight-550);
}
.panels {
  display: grid;
  gap: var(--layout-gap);
  padding: var(--layout-gap) var(--layout-gap) var(--layout-gap) 0;
}
.panel {
  min-width: 0;
  border-radius: var(--radius-12);
  background: var(--panel);
  box-shadow: var(--shadow-card);
}
.page-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-6) var(--space-4);
}
.page-icon {
  width: 20px;
  height: 20px;
  color: var(--text-muted);
}
h1 {
  flex: 1;
  margin: 0;
  font-size: var(--font-24);
  font-weight: var(--weight-400);
  line-height: var(--leading-32);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-6) var(--space-3);
}
.toolbar-end {
  display: inline-flex;
  gap: var(--space-1);
  margin-left: auto;
}
.search {
  padding: 0 var(--space-6) var(--space-4);
}
.panel :deep(.base-table) {
  padding: 0 var(--space-3) var(--space-3);
}
.person {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.record-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 56px;
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--border);
}
.record-code {
  color: var(--text-muted);
}
.record-title {
  font-size: var(--font-16);
  font-weight: var(--weight-550);
}
.record-time {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--font-12);
}
.record-time svg {
  width: 14px;
  height: 14px;
}
.view-record {
  grid-template-columns: var(--layout-rail) minmax(0, 1fr);
}
.view-record .panels {
  height: 100dvh;
}
.record {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.record-body {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) minmax(280px, var(--layout-details));
  min-height: 0;
}
.timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
  overflow: auto;
  padding: var(--space-6) var(--space-4) var(--space-4);
}
.date {
  margin: 0;
  font-weight: var(--weight-475);
}
.note-icon {
  width: 16px;
  height: 16px;
  color: var(--yellow-icon-1);
}
.suggest {
  padding-left: var(--space-6);
}
.suggest-button {
  height: var(--control-tab);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-8);
  background: var(--green-fill-1);
  color: var(--green-text-1);
  font: inherit;
  font-size: var(--font-12);
  font-weight: var(--weight-475);
  cursor: pointer;
  transition: background-color var(--motion-fast);
}
.suggest-button:hover {
  background: var(--green-fill-2);
}
.conversation {
  position: relative;
  display: flex;
  min-height: 0;
}
.conversation .timeline {
  flex: 1;
  padding-bottom: calc(var(--space-16) * 1.5);
}
.bar-area {
  position: absolute;
  bottom: var(--space-3);
  left: 50%;
  z-index: 2;
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  width: max-content;
  max-width: calc(100% + var(--space-6));
  transform: translateX(-50%);
}
.bar-area :deep(.base-composer) {
  width: calc(100% + var(--space-12));
  justify-self: center;
}
.details {
  overflow: auto;
  border-left: 1px solid var(--border);
}
.details-title {
  margin: var(--space-2) 0 var(--space-1);
  font-size: var(--font-16);
  font-weight: var(--weight-475);
}
dl {
  margin: var(--space-1) 0 0;
}
.controls {
  padding: var(--space-6);
}
.controls h2 {
  margin: var(--space-6) 0 var(--space-3);
  color: var(--text-muted);
  font-size: var(--font-12);
  font-weight: var(--weight-550);
}
.controls h2:first-child {
  margin-top: 0;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.stack {
  display: grid;
  gap: var(--space-2);
  max-width: 520px;
}
.popover-text {
  margin: 0;
  color: var(--text-muted);
}
</style>
