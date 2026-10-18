import { failure } from '../../platform/auth.mjs';

// Authorization is the access module's (contract 3.5); these helpers turn empty results into
// the platform's conflict and not-found answers.
export function changed(result) {
  if (!result.rows[0]) throw failure(409, '数据已被其他操作更新，请刷新后重试。');
  return result.rows[0];
}
export function found(result, label = '记录') {
  if (!result.rows[0]) throw failure(404, `${label}不存在或不属于当前企业。`);
  return result.rows[0];
}
