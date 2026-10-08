export function validateProduction(env = process.env) {
  if (env.NODE_ENV !== 'production') throw new Error('serve requires NODE_ENV=production.');
  let origin;
  try {
    origin = new URL(env.APP_ORIGIN);
  } catch {
    throw new Error('Production APP_ORIGIN must be a canonical HTTPS origin.');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== env.APP_ORIGIN ||
    origin.username ||
    origin.password
  )
    throw new Error(
      'Production APP_ORIGIN must be a canonical HTTPS origin without path, credentials or query.',
    );
  for (const name of ['SAP_CREDENTIAL_KEY', 'LLM_CREDENTIAL_KEY'])
    if (!/^[a-f0-9]{64}$/i.test(env[name] ?? ''))
      throw new Error(name + ' must contain 64 hexadecimal characters.');
}
