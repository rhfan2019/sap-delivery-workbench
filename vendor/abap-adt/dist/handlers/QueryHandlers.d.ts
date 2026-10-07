import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class QueryHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, arguments_: any): Promise<any>;
    handleTableContents(args: any): Promise<any>;
    handleRunQuery(args: any): Promise<any>;
}
