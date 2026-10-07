export declare class SourceCache {
    private readonly maxBytes;
    private readonly ttlMs;
    private readonly maxEntries;
    private entries;
    private bytes;
    constructor(maxBytes?: number, ttlMs?: number, maxEntries?: number);
    set(url: string, source: string): void;
    get(url: string): string | undefined;
    has(url: string): boolean;
    delete(url: string): void;
    clear(): void;
    static hash(source: string): string;
}
