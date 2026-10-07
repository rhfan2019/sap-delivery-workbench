import { seal, open } from '../sap/crypto.mjs';
import { failure } from '../auth.mjs';
function key() {
  const k = process.env.LLM_CREDENTIAL_KEY;
  if (!/^[a-f0-9]{64}$/i.test(k ?? ''))
    throw failure(503, '模型凭据主密钥未配置，请联系部署管理员。');
  return k;
}
export const sealKey = (secret, org, id) => seal(secret, `llm:${org}:${id}`, key());
export function openKey(secret, org, id) {
  try {
    return open(secret, `llm:${org}:${id}`, key());
  } catch {
    throw failure(503, '模型凭据无法解密，请检查部署密钥。');
  }
}
