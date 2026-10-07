import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { failure } from '../auth.mjs';
function keyBuffer(key) {
  if (!/^[a-f0-9]{64}$/i.test(key ?? ''))
    throw failure(503, 'SAP 凭据主密钥未配置，请联系部署管理员。');
  return Buffer.from(key, 'hex');
}
export function seal(password, context, key = process.env.SAP_CREDENTIAL_KEY) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', keyBuffer(key), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join('.');
}
export function open(value, context, key = process.env.SAP_CREDENTIAL_KEY) {
  const secret = keyBuffer(key);
  try {
    const [version, iv, tag, data] = value.split('.');
    if (version !== 'v1') throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw failure(409, 'SAP 凭据无法解密，请检查部署密钥或重新录入密码。');
  }
}
