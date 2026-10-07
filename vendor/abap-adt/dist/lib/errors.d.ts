export declare const ErrorCode: {
    InvalidParams: number;
    InternalError: number;
    MethodNotFound: number;
};
/** Application error carried as an MCP tool error, never a fabricated transport response. */
export declare class McpError extends Error {
    readonly code: number;
    constructor(code: number, message: string);
}
export declare function safeError(error: unknown, secrets?: string[]): string;
