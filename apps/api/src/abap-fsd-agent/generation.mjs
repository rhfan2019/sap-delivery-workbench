import { streamText, streamPayload } from './model-stream.mjs';
import { failure } from '../auth.mjs';
import { renderPrompt, withPromptMessages } from './prompts.mjs';
// Independent implementation informed by Open WebUI's separate completion and continuation lifecycle.
// A continuation is never a published document until the executor validates the whole JSON.
export async function streamAssistant(config, key, prompt, options = {}) {
  const draft = options.context?.manifest?.task === 'draft';
  const attempts = [];
  let text = '';
  for (let attempt = 1; attempt <= (draft ? 3 : 1); attempt++) {
    options.signal?.throwIfAborted();
    const context =
      attempt === 1
        ? options.context
        : withPromptMessages(
            options.context,
            [
              ...options.context.messages,
              { role: 'assistant', content: text },
              {
                role: 'user',
                content: renderPrompt('continuation'),
              },
            ],
            ['continuation'],
          );
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
      if (error.code !== 'OUTPUT_LIMIT' || !draft || attempt === 3 || !text) throw error;
      await options.onProgress?.({
        attempt: attempt + 1,
        message: '达到单次输出额度，正在继续生成（' + attempt + '/2）',
        finishReason: error.finishReason,
        outputLimit: null,
      });
    }
  }
}
