import { fileURLToPath } from 'node:url';
export const exportFolder = () =>
  process.env.FS_EXPORTS_DIR ??
  fileURLToPath(new URL('../../../../../../.runtime/fs-exports/', import.meta.url));
