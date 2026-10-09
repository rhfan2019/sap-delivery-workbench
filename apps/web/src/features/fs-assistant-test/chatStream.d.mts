export function reconnectingChatStream(
  url: string,
  options?: {
    signal?: AbortSignal;
    fetcher?: typeof fetch;
    after?: number;
    retryDelay?: number;
    credentials?: RequestCredentials;
    headers?: HeadersInit;
  },
): Promise<Response>;
