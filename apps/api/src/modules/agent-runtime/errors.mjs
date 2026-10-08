const messages = {
  TRACE_WRITE_FAILED: '结构化日志写入失败，运行已停止。请检查日志目录权限或磁盘空间后重试。',
  MODEL_ENDPOINT_NOT_ALLOWED:
    '默认或所选模型的接入域名不在部署允许列表中。请核对 LLM_ALLOWED_HOSTS 后重试；尚未请求模型。',
  STREAM_IDLE_TIMEOUT:
    '模型连接连续两分钟未收到数据，已停止等待。请查看日志后重试，已收到的内容保留。',
  RESPONSE_LIMIT: '模型流响应超过安全大小上限，未发布不完整成果。请查看日志中的接收字节数。',
  TEXT_LIMIT: '生成文本超过安全大小上限，未发布不完整成果。请缩小本次生成范围。',
  STREAM_INTERRUPTED: '模型流提前结束，未收到完整结束标记；已保留收到的内容。',
  CONNECTION_INTERRUPTED: '模型连接中断或响应无效，已保留连接诊断及收到的内容。',
  MODEL_TIMEOUT: '模型连接超时，已保留运行诊断。',
  PROVIDER_ERROR: '模型服务返回错误，详情见运行日志中的 HTTP 状态及请求编号。',
  RATE_LIMITED: '模型服务限流或额度不足，请稍后重试。',
  AUTH_FAILED: '模型服务拒绝认证，请检查模型配置。',
  MODEL_NOT_FOUND: '模型或接口不存在，请检查配置。',
  CONTENT_FILTER: '模型服务因内容过滤停止生成，未发布不完整成果。',
  PROVIDER_STOP: '模型服务提前停止生成，未发布不完整成果。',
  MODEL_CONNECTION: '模型连接中断或服务暂不可用，已保留诊断信息。',
  OUTPUT_PROTOCOL: '模型已返回内容，但输出协议无效，未生成新的说明书。',
  STRUCTURE_VALIDATION:
    '输出未通过结构或引用校验，未保存新的说明书。请打开运行日志查看错误位置；原需求和已有版本保留，可点击“重新生成”。若同类错误重复出现，请提供运行编号排查，无需重复填写需求。',
  QUALITY_BLOCKED: '质量审查仍有关键业务缺陷，候选和审查记录已保留，尚未发布正式版。',
  INTERRUPTED: '运行进程中断或租约失效，已保存内容保留，可重新发起任务。',
  BUSINESS_CONFLICT: '业务决定或任务状态发生冲突，请查看当前问题和已保存版本。',
  SAVE_FAILED: '说明书保存未完整完成，请先核对已有版本再重试。',
  CANCELLED: '运行已停止，已保存版本仍可查看。',
  INTERNAL_ERROR: '任务执行异常，已保留诊断信息与已有版本。',
};
export function classifyFailure(error, stage) {
  let code = error.code;
  if (messages[code]) return { code, message: messages[code] };
  if (code === 'DRAFT_VALIDATION_FAILED') code = 'STRUCTURE_VALIDATION';
  else if (error instanceof SyntaxError) code = 'OUTPUT_PROTOCOL';
  else if (error.message === 'USER_CANCELLED' || error.name === 'AbortError') code = 'CANCELLED';
  else if (stage === 'save') code = 'SAVE_FAILED';
  else if (error.statusCode === 409) code = 'BUSINESS_CONFLICT';
  else if (stage === 'validate' || error.statusCode === 422) code = 'STRUCTURE_VALIDATION';
  else if (code === 'OUTPUT_LIMIT') return { code, message: error.message };
  else if (
    stage === 'generate' ||
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(code) ||
    error.statusCode >= 500
  )
    code = 'MODEL_CONNECTION';
  else code = 'INTERNAL_ERROR';
  return { code, message: messages[code] };
}
