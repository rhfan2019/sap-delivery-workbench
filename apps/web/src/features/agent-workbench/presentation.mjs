export function composerState({
  busy = false,
  stopping = false,
  blocked = false,
  loading = false,
  text = '',
  // A model is available: the organization default or the one the user picked.
  ready = true,
}) {
  return {
    status: busy ? 'streaming' : 'ready',
    canSend: !busy && !blocked && !loading && !!text.trim() && ready,
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

// "42 秒", "3 分 57 秒".
export function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

// Shown under the status line when nothing new has arrived for a while (10-second rule).
export function waitHint(quietMs) {
  if (quietMs < 20000) return '';
  return quietMs < 60000
    ? '模型仍在生成，内容较长时可能需要 1～3 分钟。'
    : '模型仍在生成，内容较长时可能需要 1～3 分钟。离开页面不会中断运行，完成后回来查看即可。';
}
