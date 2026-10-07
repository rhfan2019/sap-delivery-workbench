import { api } from '../../services/session';
export type {
  Snapshot,
  Workspace,
  FsDocument,
  ChangeSet,
  Attachment,
  Message,
  MessageCreate,
  AgentArtifact,
  Run,
  Session,
  Capabilities,
  Head,
  Export as FsExport,
} from '../../../../../packages/contracts/fs-workspace/generated/types';
export interface Envelope<T> {
  data: T;
  meta: { request_id: string; workspace_revision: string | null };
}
export function createWorkspaceClient(projectId: string, itemId: string) {
  const base = `/projects/${encodeURIComponent(projectId)}/development-items/${encodeURIComponent(itemId)}/fs-workspace`;
  const pending = new Map<string, string>();
  const controller = new AbortController();
  const uploads = new WeakMap<File, { key: string; id: string }>();
  return {
    base,
    async upload(file: File) {
      const identity = uploads.get(file) ?? { key: crypto.randomUUID(), id: crypto.randomUUID() };
      uploads.set(file, identity);
      const form = new FormData();
      form.append('client_upload_id', identity.id);
      form.append('file', file);
      const result = await api<
        Envelope<
          import('../../../../../packages/contracts/fs-workspace/generated/types').Attachment
        >
      >(base + '/attachments', form, 'POST', {
        headers: { 'Idempotency-Key': identity.key },
        signal: controller.signal,
      });
      uploads.delete(file);
      return result;
    },
    read: <T>(path = '') =>
      api<Envelope<T>>(base + path, undefined, undefined, { signal: controller.signal }),
    async command<T>(path: string, body: unknown, etag?: string) {
      const fingerprint = JSON.stringify([path, body, etag]);
      const key = pending.get(fingerprint) ?? crypto.randomUUID();
      pending.set(fingerprint, key);
      const result = await api<Envelope<T>>(base + path, body, 'POST', {
        headers: { 'Idempotency-Key': key, ...(etag ? { 'If-Match': etag } : {}) },
        signal: controller.signal,
      });
      pending.delete(fingerprint);
      return result;
    },
    dispose() {
      controller.abort();
      pending.clear();
    },
  };
}
