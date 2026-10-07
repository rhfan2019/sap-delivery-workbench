import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const execute = promisify(execFile);

export function classifyScan(exitCode, summary) {
  const scanned = /^Scanned files:\s+(\d+)\s*$/m.exec(summary)?.[1];
  const infected = /^Infected files:\s+(\d+)\s*$/m.exec(summary)?.[1];
  if (exitCode === 1 && Number(infected) > 0)
    return { state: 'rejected', code: 'MALWARE_DETECTED' };
  if (exitCode === 0 && scanned === '1' && infected === '0') return { state: 'clean', code: null };
  return { state: 'failed', code: 'SCAN_INCOMPLETE' };
}

// Only an administrator-configured local ClamAV binary is executed, never file-supplied commands.
export async function scanAttachment(
  path,
  { executable = process.env.FS_CLAMSCAN_PATH, expectedHash } = {},
) {
  if (!executable || !isAbsolute(executable))
    return { state: 'failed', code: 'SCANNER_UNAVAILABLE' };
  if (!isAbsolute(path) || !expectedHash) return { state: 'failed', code: 'INVALID_SCAN_INPUT' };
  const hash = async () =>
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  try {
    if ((await hash()) !== expectedHash)
      return { state: 'failed', code: 'ATTACHMENT_HASH_MISMATCH' };
    let result;
    try {
      const output = await execute(
        executable,
        [
          '--alert-exceeds-max=yes',
          '--max-filesize=5M',
          '--max-scansize=20M',
          '--max-recursion=8',
          '--',
          path,
        ],
        {
          timeout: 30000,
          maxBuffer: 65536,
          windowsHide: true,
          env: {
            SystemRoot: process.env.SystemRoot ?? '',
            TEMP: process.env.TEMP ?? '',
            TMP: process.env.TMP ?? '',
            LC_ALL: 'C',
            LANG: 'C',
          },
        },
      );
      result = classifyScan(0, output.stdout);
    } catch (error) {
      if (error.code === 1) result = classifyScan(1, error.stdout ?? '');
      else
        return {
          state: 'failed',
          code: error.code === 'ENOENT' ? 'SCANNER_UNAVAILABLE' : 'SCANNER_FAILED',
        };
    }
    if ((await hash()) !== expectedHash)
      return { state: 'failed', code: 'ATTACHMENT_HASH_MISMATCH' };
    return {
      ...result,
      receipt: { engine: 'clamav', sha256: expectedHash, checked_at: new Date().toISOString() },
    };
  } catch {
    return { state: 'failed', code: 'ATTACHMENT_UNAVAILABLE' };
  }
}
