import { SourceCache } from "../lib/sourceCache.js";
import { McpError, ErrorCode } from "../lib/errors.js";
import { performance } from "perf_hooks";
import { createLogger } from "../lib/logger.js";
var CustomErrorCode;
(function (CustomErrorCode) {
    CustomErrorCode[CustomErrorCode["TooManyRequests"] = 429] = "TooManyRequests";
    CustomErrorCode[CustomErrorCode["InvalidParameters"] = 400] = "InvalidParameters";
})(CustomErrorCode || (CustomErrorCode = {}));
export class BaseHandler {
    sourceCache;
    get adtclient() {
        if (!this.client)
            throw new McpError(ErrorCode.InvalidParams, "Configure SAP_URL, SAP_USER and SAP_PASSWORD or SAP_BEARER_TOKEN");
        return this.client;
    }
    client;
    logger = createLogger(this.constructor.name);
    rateLimiter = new Map();
    metrics = {
        requestCount: 0,
        errorCount: 0,
        successCount: 0,
        totalTime: 0,
    };
    constructor(adtclient, sourceCache = new SourceCache()) {
        this.sourceCache = sourceCache;
        this.client = adtclient;
    }
    trackRequest(startTime, success) {
        const duration = performance.now() - startTime;
        this.metrics.requestCount++;
        this.metrics.totalTime += duration;
        if (success) {
            this.metrics.successCount++;
        }
        else {
            this.metrics.errorCount++;
        }
        this.logger.info("Request completed", {
            duration,
            success,
            metrics: this.getMetrics(),
        });
    }
    checkRateLimit(ip) {
        const now = Date.now();
        const lastRequest = this.rateLimiter.get(ip) || 0;
        if (now - lastRequest < 1000) {
            // 1 second rate limit
            this.logger.warn("Rate limit exceeded", { ip });
            throw new McpError(CustomErrorCode.TooManyRequests, "Rate limit exceeded. Please wait before making another request.");
        }
        this.rateLimiter.set(ip, now);
    }
    getMetrics() {
        return {
            ...this.metrics,
            averageTime: this.metrics.requestCount > 0
                ? this.metrics.totalTime / this.metrics.requestCount
                : 0,
        };
    }
}
