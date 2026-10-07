import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { storeQuarantined } from '../../../apps/api/src/fs-workspace/attachments/storage.mjs';

test('quarantine streams exactly 5 MiB, rejects overflow and never exposes original names', async () => {
  const root = resolve('.runtime/fs-storage-tests');
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, 'case-'));
  try {
    const bytes = Buffer.alloc(5242880, 32);
    bytes.write('%PDF-1.7\n');
    const stored = await storeQuarantined(
      Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]),
      { folder, name: '业务.pdf', mime: 'application/pdf' },
    );
    assert.equal(stored.size_bytes, 5242880);
    assert.equal(stored.scan_state, 'quarantined');
    assert.match(stored.blob_key, /^[a-f0-9-]{36}$/);
    assert.deepEqual(await readFile(join(folder, stored.blob_key)), bytes);
    await assert.rejects(
      storeQuarantined(Readable.from([bytes, Buffer.from('x')]), {
        folder,
        name: 'large.pdf',
        mime: 'application/pdf',
      }),
      /5 MiB/,
    );
    assert.deepEqual(await readdir(folder), [stored.blob_key]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('signature mismatch, interrupted stream and unsafe filenames leave no blobs', async () => {
  const root = resolve('.runtime/fs-storage-tests');
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, 'case-'));
  try {
    await assert.rejects(
      storeQuarantined(Readable.from([Buffer.from('MZ executable')]), {
        folder,
        name: 'bad.pdf',
        mime: 'application/pdf',
      }),
      /签名/,
    );
    await assert.rejects(
      storeQuarantined(Readable.from([Buffer.from('%PDF-1.7')]), {
        folder,
        name: '../bad.pdf',
        mime: 'application/pdf',
      }),
      /文件名/,
    );
    async function* broken() {
      yield Buffer.from('%PDF-1.7');
      throw new Error('connection lost');
    }
    await assert.rejects(
      storeQuarantined(Readable.from(broken()), {
        folder,
        name: 'broken.pdf',
        mime: 'application/pdf',
      }),
      /connection lost/,
    );
    assert.deepEqual(await readdir(folder), []);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
