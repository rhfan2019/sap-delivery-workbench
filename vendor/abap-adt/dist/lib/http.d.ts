import { AsyncLocalStorage } from "node:async_hooks";
import type { HttpClient } from "abap-adt-api";
export declare const requestContext: AsyncLocalStorage<{
    signal: AbortSignal;
}>;
export declare class BoundedHttpClient implements HttpClient {
    readonly base: URL;
    constructor(base: URL);
    request(options: Parameters<HttpClient["request"]>[0]): Promise<Awaited<ReturnType<HttpClient["request"]>>>;
}
