// Intent is immutable server-owned task data, never a client-supplied permission.
export const runCapability = (run) => (run.intent === 'export' ? 'can_export' : 'can_edit');
