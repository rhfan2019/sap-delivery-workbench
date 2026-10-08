import { createHash } from 'node:crypto';
export const environments = ['DEV', 'QAS', 'PRD'];
export function binding(c) {
  return createHash('sha256')
    .update(JSON.stringify([c.systemId, c.sapUrl, c.client ?? '', c.username ?? '']))
    .digest('hex');
}
export function resolveLayers(systems, project = {}, personal = {}, temporary = {}) {
  const result = {
    systemId: null,
    sapUrl: null,
    systemName: null,
    client: null,
    username: null,
    language: null,
    passwordCipher: null,
    password: null,
    credentialContext: null,
    sources: {},
  };
  let bound = null;
  for (const [source, layer] of [
    ['project', project],
    ['personal', personal],
    ['temporary', temporary],
  ]) {
    if (!layer) continue;
    if (layer.systemId && layer.systemId !== result.systemId) {
      result.systemId = layer.systemId;
      for (const field of [
        'client',
        'username',
        'language',
        'passwordCipher',
        'password',
        'credentialContext',
      ])
        result[field] = null;
      result.sources = { systemId: source };
      bound = null;
    }
    const system = systems.find((s) => s.id === result.systemId);
    result.sapUrl = system?.sapUrl ?? null;
    result.systemName = system?.name ?? null;
    for (const field of ['client', 'username', 'language'])
      if (layer[field] !== null && layer[field] !== undefined && layer[field] !== '') {
        result[field] = layer[field];
        result.sources[field] = source;
      }
    if (bound && bound !== binding(result)) {
      result.passwordCipher = null;
      result.password = null;
      result.credentialContext = null;
      delete result.sources.password;
    }
    if (layer.passwordMode === 'none') {
      result.passwordCipher = null;
      result.password = null;
      result.credentialContext = null;
      bound = null;
      result.sources.password = source;
    } else if (layer.passwordMode === 'override') {
      result.passwordCipher = null;
      result.password = null;
      result.credentialContext = null;
      bound = layer.credentialBinding ?? null;
      if (layer.passwordCipher && bound === binding(result)) {
        result.passwordCipher = layer.passwordCipher;
        result.credentialContext = layer.credentialContext;
      }
      if (source === 'temporary' && layer.password) {
        result.password = layer.password;
        bound = binding(result);
      }
      result.sources.password = source;
    }
  }
  if (!result.language) {
    result.language = systems.find((s) => s.id === result.systemId)?.language ?? 'EN';
    result.sources.language = 'system';
  }
  return result;
}
export function publicConfig(c) {
  const { systemId, systemName, sapUrl, client, username, language, sources } = c;
  const hasPassword = !!(c.passwordCipher || c.password);
  return {
    systemId,
    systemName,
    sapUrl,
    client,
    username,
    language,
    sources,
    hasPassword,
    credentialReady: !!(sapUrl && username && hasPassword),
  };
}
