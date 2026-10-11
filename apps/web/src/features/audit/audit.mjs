// Pure helpers for the audit page (labels, formatting, filters, trend math).
export const STATUS_LABELS = {
  COMPLETED: '已完成',
  ASKED: '已提问',
  FAILED: '失败',
  CANCELLED: '已停止',
  INTERRUPTED: '已中断',
  RUNNING: '运行中',
};
export const statusLabel = (status) => STATUS_LABELS[status] ?? status ?? '—';
export const statusTone = (status) =>
  status === 'FAILED' || status === 'INTERRUPTED'
    ? 'danger'
    : status === 'CANCELLED'
      ? 'warn'
      : status === 'COMPLETED' || status === 'ASKED'
        ? 'ok'
        : 'muted';

export const STOP_REASONS = {
  answered: '正常结束',
  asked: '向用户提问',
  step_limit: '达到步骤上限',
  output_limit: '输出达到上限',
  cancelled: '用户停止',
  error: '出错',
  server_restart: '服务重启中断',
};
export const stopReasonLabel = (reason) => STOP_REASONS[reason] ?? reason ?? '—';

export const TOOL_LABELS = {
  searchObject: '搜索 SAP 对象',
  findObjectPath: '定位 SAP 对象',
  objectTypes: '读取对象类型',
  ddicElement: '读取表结构',
  ddicRepositoryAccess: '读取数据字典',
  tableContents: '读取表内容',
  runQuery: '查询表内容或配置',
  getObjectSource: '读取源码',
  objectStructure: '读取对象结构',
  classComponents: '读取类组件',
  findDefinition: '查找定义',
  usageReferences: '查找使用位置',
  abapDocumentation: '读取 ABAP 文档',
  read_document: '读取文档',
  write_document: '编写文档',
  edit_document: '修改文档',
  check_document: '自动校验文档',
  ask_user: '向用户提问',
  reply_comment: '回复批注',
};
export const toolLabel = (name) => TOOL_LABELS[name] ?? name;

export const FILTER_KEYS = ['from', 'to', 'status', 'model', 'project_id', 'item_id', 'q'];
export const LONG_GAP_MS = 30000;
export const ALERT_GAP_MS = 120000;

export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + '秒';
  const total = Math.round(ms / 1000);
  return Math.floor(total / 60) + '分' + String(total % 60).padStart(2, '0') + '秒';
}
export function formatTokens(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
export const formatPercent = (r) =>
  typeof r === 'number' && Number.isFinite(r) ? (r * 100).toFixed(1) + '%' : '—';
export function gapLevel(ms) {
  if (ms >= ALERT_GAP_MS) return 'alert';
  if (ms >= LONG_GAP_MS) return 'warn';
  return 'none';
}
// Route query <-> API query: only known, non-empty filter values survive.
export function pickFilters(query = {}) {
  const out = {};
  for (const key of FILTER_KEYS) {
    const v = Array.isArray(query[key]) ? query[key][0] : query[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim();
  }
  return out;
}
export function toQueryString(params = {}) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  const s = search.toString();
  return s ? '?' + s : '';
}
export function presetRange(preset, now = new Date()) {
  const day = 86400000;
  const days = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 }[preset];
  if (!days) return null;
  return { from: new Date(now.getTime() - days * day).toISOString(), to: '' };
}
// Round-over-round growth; a jump above the threshold hints at context bloat or slowdown.
export function withGrowth(rounds, threshold = 0.3) {
  return rounds.map((r, i) => {
    const prev = rounds[i - 1];
    const tokens = (x) => (x?.prompt_tokens || 0) + (x?.completion_tokens || 0);
    const change = (a, b) => (prev && b > 0 && typeof a === 'number' ? (a - b) / b : null);
    const durationChange = change(r.duration_ms, prev?.duration_ms);
    const tokenChange = change(tokens(r), tokens(prev));
    return {
      ...r,
      tokens: tokens(r),
      duration_change: durationChange,
      token_change: tokenChange,
      flagged: [durationChange, tokenChange].some((c) => c !== null && c > threshold),
    };
  });
}
// Polyline points for a small inline SVG trend chart.
export function sparkPoints(values, width, height, pad = 4) {
  const nums = values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  const max = Math.max(1, ...nums.filter((v) => v !== null));
  const step = nums.length > 1 ? (width - pad * 2) / (nums.length - 1) : 0;
  return nums
    .map((v, i) =>
      v === null
        ? null
        : [
            +(pad + i * step).toFixed(1),
            +(height - pad - (v / max) * (height - pad * 2)).toFixed(1),
          ],
    )
    .filter(Boolean);
}
