import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class NodeHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleNodeContents(args: any): Promise<any>;
    handleMainPrograms(args: any): Promise<any>;
}
