export function composerState({
  busy = false,
  stopping = false,
  blocked = false,
  loading = false,
  text = '',
  modelId = '',
}) {
  return {
    status: busy ? 'streaming' : 'ready',
    canSend: !busy && !blocked && !loading && !!text.trim() && !!modelId,
    canStop: busy && !stopping,
  };
}
export function restoreDraft(current, submitted) {
  return current || submitted;
}
export function stepPresentation(status) {
  const labels = {
    queued: '等待执行',
    running: '执行中',
    succeeded: '已完成',
    failed: '失败',
    waiting_user: '等待确认',
    cancelled: '已停止',
    skipped: '已跳过',
  };
  return {
    label: labels[status] ?? '状态待同步',
    tone: status === 'failed' ? 'destructive' : status === 'succeeded' ? 'success' : 'muted',
  };
}
