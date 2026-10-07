import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { failure } from '../auth.mjs';
import { MODEL_REQUEST_TIMEOUT_MS, MODEL_CONNECTION_TIMEOUT_MS } from './runtime.mjs';
export function isPublicAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Only global unicast IPv6; reject mapped, local and transition networks.
  if (isIP(ip) === 6) return /^2[0-9a-f]{3}:/i.test(ip) && !/^200[12]:/i.test(ip);
  return false;
}
export function allowedEndpoint(raw, allowlist = process.env.LLM_ALLOWED_HOSTS ?? '') {
  const url = new URL(raw);
  const hosts = allowlist
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !hosts.includes(url.hostname.toLowerCase())
  )
    throw Object.assign(
      failure(400, '接入域名未获授权。请联系部署管理员配置 LLM_ALLOWED_HOSTS。'),
      { code: 'MODEL_ENDPOINT_NOT_ALLOWED' },
    );
  return url;
}
export function probePayload(c) {
  const common = { model: c.modelId };
  const prompt = 'Reply with the single word OK. This is a synthetic connection test.';
  if (c.protocol === 'openai_responses') return { ...common, input: prompt };
  return { ...common, messages: [{ role: 'user', content: prompt }] };
}
export function interpretResponse(protocol, status, data) {
  const failed = (code, message) => ({ status: 'failed', code, message });
  if (status >= 300 && status < 400)
    return failed('REDIRECT_BLOCKED', '服务返回重定向；为保护凭据已阻止跟随。');
  if (status === 401 || status === 403)
    return failed('AUTH_FAILED', '提供方拒绝认证或无权访问模型。');
  if (status === 404)
    return failed('MODEL_NOT_FOUND', '接口路径或模型不存在，请检查协议、地址和模型标识。');
  if (status === 429) return failed('RATE_LIMITED', '提供方限流或额度不足，请稍后重试。');
  if (status < 200 || status >= 300)
    return failed('PROVIDER_ERROR', `提供方返回 HTTP ${status}，请检查模型与参数兼容性。`);
  const content =
    protocol === 'openai_chat'
      ? data?.choices?.[0]?.message?.content
      : protocol === 'anthropic_messages'
        ? data?.content
            ?.filter?.((x) => x.type === 'text')
            .map((x) => x.text)
            .join('')
        : data?.output
            ?.filter?.((x) => x.type === 'message')
            .flatMap((x) => x.content ?? [])
            .filter((x) => x.type === 'output_text')
            .map((x) => x.text)
            .join('');
  if (typeof content !== 'string' || !content.trim())
    return data?.choices?.[0]?.finish_reason === 'length' ||
      data?.stop_reason === 'max_tokens' ||
      data?.incomplete_details?.reason === 'max_output_tokens'
      ? failed(
          'OUTPUT_LIMIT',
          '提供方输出额度已耗尽，未取得最终文本。请缩小生成范围或更换模型后重试。',
        )
      : failed('INVALID_RESPONSE', '接口未返回可验证的文本；请检查协议或模型能力。');
  return {
    status: 'passed',
    code: 'OK',
    message: '文本生成验证通过；不代表工具调用或视觉能力已验证。',
  };
}
async function prepareModelRequest(
  config,
  key,
  payload,
  callerSignal,
  resolve = lookup,
  deadlineMs = MODEL_REQUEST_TIMEOUT_MS,
  modelMetadata = false,
  send = https.request,
) {
  const url = allowedEndpoint(config.baseUrl);
  const signal = AbortSignal.any([
    ...(deadlineMs === null ? [] : [AbortSignal.timeout(deadlineMs)]),
    ...(callerSignal ? [callerSignal] : []),
  ]);
  signal.throwIfAborted();
  // Buffered requests have a deadline; streams use first-byte and idle cancellation.
  let stop;
  const timeout = new Promise((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
  });
  let addresses;
  try {
    addresses = await Promise.race([resolve(url.hostname, { all: true }), timeout]);
  } finally {
    signal.removeEventListener('abort', stop);
  }
  if (!addresses.length || addresses.some((x) => !isPublicAddress(x.address)))
    throw failure(400, '接入域名解析到非公网地址，已阻止请求。');
  url.pathname =
    url.pathname.replace(/\/$/, '') +
    (modelMetadata
      ? '/models/' + encodeURIComponent(config.modelId)
      : {
          openai_chat: '/chat/completions',
          openai_responses: '/responses',
          anthropic_messages: '/messages',
        }[config.protocol]);
  if (!modelMetadata && config.protocol === 'anthropic_messages') {
    // Messages requires max_tokens. Read the actual provider maximum instead of guessing
    // a universal limit or reintroducing a user-configured generation cap.
    const metadata = await requestModel(
      config,
      key,
      {},
      {
        signal,
        modelMetadata: true,
        resolve,
        request: send,
      },
    );
    if (metadata.status !== 200) {
      const checked = interpretResponse(config.protocol, metadata.status, {});
      throw Object.assign(failure(502, checked.message), { code: checked.code });
    }
    if (!Number.isSafeInteger(metadata.data?.max_tokens) || metadata.data.max_tokens <= 0)
      throw Object.assign(
        failure(
          502,
          '模型服务未提供最大输出能力，无法构造 Anthropic 必需参数。请检查模型信息接口。',
        ),
        { code: 'MODEL_CAPABILITY_REQUIRED' },
      );
    payload = { ...payload, max_tokens: metadata.data.max_tokens };
  }
  const bytes = modelMetadata ? Buffer.alloc(0) : Buffer.from(JSON.stringify(payload));
  if (bytes.length > 2000000) throw new Error('REQUEST_LIMIT');
  signal.throwIfAborted();
  const headers = { 'Content-Type': 'application/json', 'Content-Length': bytes.length };
  if (config.protocol === 'anthropic_messages') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else headers.Authorization = 'Bearer ' + key;
  return { url, signal, addresses, bytes, headers };
}
export async function requestModel(
  config,
  key,
  payload,
  {
    signal: callerSignal,
    maxResponseBytes = 262144,
    modelMetadata = false,
    resolve = lookup,
    request: send = https.request,
  } = {},
) {
  const { url, signal, addresses, bytes, headers } = await prepareModelRequest(
    config,
    key,
    payload,
    callerSignal,
    resolve,
    MODEL_REQUEST_TIMEOUT_MS,
    modelMetadata,
    send,
  );
  const result = await new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: modelMetadata ? 'GET' : 'POST',
        agent: false,
        signal,
        headers,
        lookup: (_host, options, callback) =>
          options.all
            ? callback(null, [addresses[0]])
            : callback(null, addresses[0].address, addresses[0].family),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxResponseBytes) {
            req.destroy(new Error('RESPONSE_LIMIT'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          let data;
          try {
            data = JSON.parse(Buffer.concat(chunks).toString());
          } catch {
            data = {};
          }
          resolve({ status: res.statusCode ?? 500, data, retryAfter: res.headers['retry-after'] });
        });
      },
    );
    req.on('error', reject);
    req.end(bytes);
  });
  return result;
}
export async function probeModel(config, key) {
  const started = Date.now();
  try {
    const response = await requestModel(config, key, probePayload(config));
    const result = interpretResponse(config.protocol, response.status, response.data);
    return { ...result, latencyMs: Date.now() - started };
  } catch (e) {
    const timeout = ['AbortError', 'TimeoutError'].includes(e.name);
    return {
      status: timeout ? 'timeout' : 'failed',
      code: timeout ? 'TIMEOUT' : e.statusCode === 400 ? 'ENDPOINT_BLOCKED' : 'CONNECTION_FAILED',
      message: timeout
        ? '模型测试超时。'
        : e.statusCode === 400
          ? e.message
          : '无法建立安全连接，请检查域名、TLS证书及网络。',
      latencyMs: Date.now() - started,
    };
  }
}

// Shares buffered-request security. Streaming uses first-byte and idle deadlines only.
// These budgets belong to the application, never to model registry records.
export async function* requestModelStream(
  config,
  key,
  payload,
  {
    signal: callerSignal,
    maxResponseBytes = 16 * 1024 * 1024,
    onResponse,
    idleTimeoutMs = 120000,
    connectionTimeoutMs = MODEL_CONNECTION_TIMEOUT_MS,
    resolve = lookup,
    request: send = https.request,
  } = {},
) {
  const idleController = new AbortController();
  const connectionController = new AbortController();
  const connectionTimer = setTimeout(
    () =>
      connectionController.abort(
        Object.assign(failure(504, '等待模型首个响应数据超时，请检查模型服务。'), {
          code: 'MODEL_TIMEOUT',
        }),
      ),
    connectionTimeoutMs,
  );
  connectionTimer.unref();
  let idleTimer;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () =>
        idleController.abort(
          Object.assign(failure(504, '模型连接连续两分钟未收到数据，已停止等待并保留内容。'), {
            code: 'STREAM_IDLE_TIMEOUT',
          }),
        ),
      idleTimeoutMs,
    );
    idleTimer.unref();
  };
  // Every received chunk renews the idle deadline; active reasoning has no wall-clock cutoff.
  const streamSignal = AbortSignal.any([
    idleController.signal,
    connectionController.signal,
    ...(callerSignal ? [callerSignal] : []),
  ]);
  let request, response, signal;
  try {
    const prepared = await prepareModelRequest(
      config,
      key,
      payload,
      streamSignal,
      resolve,
      null,
      false,
      send,
    );
    const { url, addresses, bytes, headers } = prepared;
    signal = prepared.signal;
    response = await new Promise((resolve, reject) => {
      request = send(
        url,
        {
          method: 'POST',
          agent: false,
          signal,
          headers: { ...headers, Accept: 'text/event-stream' },
          lookup: (_host, options, callback) =>
            options.all
              ? callback(null, [addresses[0]])
              : callback(null, addresses[0].address, addresses[0].family),
        },
        resolve,
      );
      request.on('error', reject);
      request.end(bytes);
    });
    const responseInfo = {
      httpStatus: response.statusCode,
      requestId: String(
        response.headers['x-request-id'] ?? response.headers['request-id'] ?? '',
      ).slice(0, 200),
    };
    onResponse?.(responseInfo);
    if (response.statusCode !== 200) {
      const checked = interpretResponse(config.protocol, response.statusCode ?? 502, {});
      throw Object.assign(failure(502, checked.message), {
        code: checked.code,
        diagnostics: responseInfo,
      });
    }
    if (
      !String(response.headers['content-type'] ?? '')
        .toLowerCase()
        .startsWith('text/event-stream')
    )
      throw Object.assign(failure(502, '模型未返回流式响应，请检查协议和模型能力。'), {
        code: 'OUTPUT_PROTOCOL',
      });
    let size = 0;
    for await (const chunk of response) {
      signal.throwIfAborted();
      clearTimeout(connectionTimer);
      resetIdle();
      size += chunk.length;
      if (size > maxResponseBytes)
        throw Object.assign(failure(502, '模型流响应超过大小上限，未发布不完整成果。'), {
          code: 'RESPONSE_LIMIT',
          diagnostics: { ...responseInfo, receivedBytes: size, maxResponseBytes },
        });
      yield chunk;
    }
  } catch (error) {
    // IncomingMessage can report ECONNRESET when our own deadline destroys the socket.
    // Preserve the actual deadline/cancellation reason instead of blaming the network.
    if (signal?.aborted) throw signal.reason;
    if (streamSignal.aborted) throw streamSignal.reason;
    throw error;
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(connectionTimer);
    response?.destroy();
    request?.destroy();
  }
}
