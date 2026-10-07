import { SourceCache } from "../lib/sourceCache.js";
import type { ToolDefinition } from "../types/tools.js";
import type { ADTClient } from "abap-adt-api";
export declare abstract class BaseHandler {
    protected readonly sourceCache: SourceCache;
    protected get adtclient(): ADTClient;
    private readonly client?;
    protected readonly logger: {
        error: (m: string, _?: unknown) => void;
        warn: (m: string, _?: unknown) => void;
        info: (m: string, _?: unknown) => void;
        debug: (m: string, _?: unknown) => void;
    };
    private readonly rateLimiter;
    private readonly metrics;
    constructor(adtclient: ADTClient | undefined, sourceCache?: SourceCache);
    protected trackRequest(startTime: number, success: boolean): void;
    protected checkRateLimit(ip: string): void;
    protected getMetrics(): {
        requestCount: number;
        errorCount: number;
        successCount: number;
        totalTime: number;
        averageTime: number;
    };
    abstract getTools(): ToolDefinition[];
}
