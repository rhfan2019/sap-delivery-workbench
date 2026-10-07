export declare function createLogger(name: string): {
    error: (m: string, _?: unknown) => void;
    warn: (m: string, _?: unknown) => void;
    info: (m: string, _?: unknown) => void;
    debug: (m: string, _?: unknown) => void;
};
export type Logger = ReturnType<typeof createLogger>;
