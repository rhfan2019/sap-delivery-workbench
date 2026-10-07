import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class AuthHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    private handleLogin;
    private handleLogout;
    private handleDropSession;
}
