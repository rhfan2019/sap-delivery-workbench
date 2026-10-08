import { streamText, streamPayload } from './model-stream.mjs';
import { failure } from '../auth.mjs';
// Independent implementation informed by Open WebUI's separate completion and continuation lifecycle.
// A continuation is never a published document until the executor validates the whole JSON.
export async function streamAssistant(config, key, prompt, options = {}) {
  const attempts = [];
  let text = '';
  for (let attempt = 1; attempt <= 1; attempt++) {
    options.signal?.throwIfAborted();
    const context = options.context;
    let attemptText = '';
    options.onAttempt?.('started', { attempt, payload: streamPayload(config, prompt, context) });
    try {
      const result = await streamText(config, key, prompt, {
        ...options,
        context,
        onDelta: async (delta) => {
          if (text.length + delta.length > 262144)
            throw failure(502, '累计生成超过文本上限，未发布规格。');
          text += delta;
          attemptText += delta;
          await options.onDelta(delta);
        },
      });
      attempts.push({
        attempt,
        ...result,
        promptFiles: context?.manifest?.promptFiles,
        messagesHash: context?.manifest?.messagesHash,
      });
      options.onAttempt?.('completed', { attempt, result, output: attemptText });
      return { ...result, attempts };
    } catch (error) {
      attempts.push({
        attempt,
        code: error.code ?? 'GENERATION_FAILED',
        finishReason: error.finishReason ?? null,
        outputLimit: null,
        usage: error.usage ?? null,
        diagnostics: error.diagnostics ?? null,
      });
      error.attempts = attempts;
      options.onAttempt?.('failed', { attempt, output: attemptText, error: attempts.at(-1) });
      throw error;
    }
  }
}
