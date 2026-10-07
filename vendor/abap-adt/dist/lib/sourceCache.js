import { createHash } from "node:crypto";
export class SourceCache {
    maxBytes;
    ttlMs;
    maxEntries;
    entries = new Map();
    bytes = 0;
    constructor(maxBytes = 8 * 1024 * 1024, ttlMs = 300000, maxEntries = 64) {
        this.maxBytes = maxBytes;
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
    }
    set(url, source) {
        this.delete(url);
        const bytes = Buffer.byteLength(source);
        if (bytes > this.maxBytes)
            return;
        this.entries.set(url, { source, bytes, expires: Date.now() + this.ttlMs });
        this.bytes += bytes;
        while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes)
            this.delete(this.entries.keys().next().value);
    }
    get(url) {
        const e = this.entries.get(url);
        if (!e)
            return;
        if (e.expires <= Date.now()) {
            this.delete(url);
            return;
        }
        return e.source;
    }
    has(url) {
        return this.get(url) !== undefined;
    }
    delete(url) {
        const e = this.entries.get(url);
        if (e)
            this.bytes -= e.bytes;
        this.entries.delete(url);
    }
    clear() {
        this.entries.clear();
        this.bytes = 0;
    }
    static hash(source) {
        return createHash("sha256").update(source).digest("hex");
    }
}
