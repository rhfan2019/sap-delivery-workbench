import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import { failure } from '../../../platform/auth.mjs';

const limit = 5242880;
const formats = new Map([
  ['.pdf', { mime: 'application/pdf', signature: Buffer.from('%PDF-') }],
  ['.png', { mime: 'image/png', signature: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) }],
  ['.jpg', { mime: 'image/jpeg', signature: Buffer.from([255, 216, 255]) }],
  ['.jpeg', { mime: 'image/jpeg', signature: Buffer.from([255, 216, 255]) }],
]);

// Signature checks only classify quarantined bytes. They never grant scan/parse approval.
// Caller supplies a trusted private storage directory, never one from request input.
export async function storeQuarantined(stream, { folder, name, mime, maxBytes = limit }) {
  if (!isAbsolute(folder)) throw new Error('Quarantine folder must be absolute');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > limit)
    throw new Error('Invalid quarantine size limit');
  if (
    typeof name !== 'string' ||
    !name.length ||
    name.length > 200 ||
    /[\\/\x00-\x1f\x7f]/.test(name)
  )
    throw failure(400, '文件名无效。');
  const format = formats.get(extname(name).toLowerCase());
  if (!format || mime !== format.mime) throw failure(415, '文件类型尚不支持或声明不符。');
  await mkdir(folder, { recursive: true });
  const id = randomUUID(),
    path = join(folder, id),
    file = await open(path, 'wx', 0o600);
  const hash = createHash('sha256');
  let size = 0,
    prefix = Buffer.alloc(0);
  try {
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) throw failure(400, '上传必须使用二进制流。');
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) throw failure(413, '文件不能超过 5 MiB。');
      if (prefix.length < 8) prefix = Buffer.concat([prefix, bytes.subarray(0, 8 - prefix.length)]);
      hash.update(bytes);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset);
        if (!bytesWritten) throw new Error('Quarantine write stalled');
        offset += bytesWritten;
      }
    }
    if (!size || !prefix.subarray(0, format.signature.length).equals(format.signature))
      throw failure(415, '文件签名与扩展名不符或内容为空。');
    await file.sync();
    await file.close();
    return {
      id,
      blob_key: id,
      name,
      size_bytes: size,
      mime: format.mime,
      sha256: hash.digest('hex'),
      scan_state: 'quarantined',
      parse_result: null,
      created_at: new Date().toISOString(),
    };
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(path);
    throw error;
  }
}
