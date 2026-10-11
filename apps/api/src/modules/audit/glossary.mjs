// Reviewer-facing names for run states, stop reasons and tools. The audit page and the
// exported analysis material use the same words.
export const STATUS_LABELS = {
  COMPLETED: '已完成',
  ASKED: '已提问，等待答复',
  FAILED: '失败',
  CANCELLED: '已停止',
  INTERRUPTED: '已中断',
  RUNNING: '运行中',
};

export const STOP_REASONS = {
  answered: { title: '正常结束', meaning: '模型给出回复后结束本轮。' },
  asked: { title: '向用户提问', meaning: '模型用 ask_user 提出一批问题后结束本轮，等待答复。' },
  step_limit: {
    title: '达到步骤上限',
    meaning: '本轮模型调用或工具调用次数达到上限，进度已保存。频繁出现说明查询发散或重复调用。',
  },
  output_limit: {
    title: '输出达到上限',
    meaning: '模型单次输出被截断。可调大 ABAP_FSD_AGENT_MAX_OUTPUT_TOKENS，或引导分章续写。',
  },
  cancelled: { title: '用户停止', meaning: '用户在运行中点击了停止。' },
  error: { title: '出错', meaning: '模型服务、SAP 或程序异常，详见错误信息。' },
  server_restart: { title: '服务重启中断', meaning: '运行期间服务重启，本轮未能完成。' },
  running: { title: '运行中', meaning: '尚未结束。' },
};

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

export const statusLabel = (status) => STATUS_LABELS[status] ?? status ?? '—';
export const stopReasonTitle = (reason) => STOP_REASONS[reason]?.title ?? reason ?? '—';
export const toolLabel = (name) => TOOL_LABELS[name] ?? name;
