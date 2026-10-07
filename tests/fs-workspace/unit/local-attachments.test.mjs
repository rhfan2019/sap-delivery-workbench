import test from 'node:test';
import assert from 'node:assert/strict';
import { effectScope } from 'vue';
import { useAttachments } from '../../../apps/web/src/features/fs-assistant-test/useAttachments.ts';
test('local attachments deduplicate, preserve literal text, close removed preview and release URLs', async () => {
  const scope = effectScope(),
    state = scope.run(() => useAttachments());
  try {
    const file = new File(['<script>unsafe()</script>'], 'example.txt', {
      type: 'text/plain',
      lastModified: 1,
    });
    await state.addFiles([file, file]);
    assert.equal(state.attachments.value.length, 1);
    const entry = state.attachments.value[0];
    assert.equal(entry.text, '<script>unsafe()</script>');
    assert.equal(entry.kind, 'text');
    state.selectedId.value = entry.id;
    state.removeFile(entry.id);
    assert.equal(state.activeAttachment.value, undefined);
    await assert.rejects(fetch(entry.url));
    await state.addFiles([new File(['<svg/>'], 'graphic.svg', { type: 'image/svg+xml' })]);
    assert.equal(state.attachments.value[0].kind, 'file');
    const url = state.attachments.value[0].url;
    scope.stop();
    await assert.rejects(fetch(url));
  } finally {
    scope.stop();
  }
});
test('attachment limits also apply across queued additions; false PDF headers are not embedded', async () => {
  const scope = effectScope(),
    state = scope.run(() => useAttachments());
  try {
    await Promise.all([
      state.addFiles(Array.from({ length: 8 }, (_, i) => new File(['x'], 'a' + i))),
      state.addFiles(Array.from({ length: 8 }, (_, i) => new File(['x'], 'b' + i))),
    ]);
    assert.equal(state.attachments.value.length, 10);
    assert.match(state.attachmentError.value, /最多/);
    state.attachments.value.forEach((a) => state.removeFile(a.id));
    await state.addFiles([new File(['<html/>'], 'fake.pdf', { type: 'application/pdf' })]);
    assert.equal(state.attachments.value[0].kind, 'file');
  } finally {
    scope.stop();
  }
});

test('same name size and timestamp do not hide different attachment contents', async () => {
  const scope = effectScope(),
    state = scope.run(() => useAttachments());
  try {
    await state.addFiles([
      new File(['AAA'], 'same.txt', { lastModified: 1 }),
      new File(['BBB'], 'same.txt', { lastModified: 1 }),
    ]);
    assert.equal(state.attachments.value.length, 2);
    assert.notEqual(state.attachments.value[0].text, state.attachments.value[1].text);
  } finally {
    scope.stop();
  }
});
