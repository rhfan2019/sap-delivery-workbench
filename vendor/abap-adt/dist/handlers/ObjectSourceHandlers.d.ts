import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class ObjectSourceHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleGetObjectSource(args: any): Promise<any>;
    handleSetObjectSource(args: any): Promise<any>;
}
