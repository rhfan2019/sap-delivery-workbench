import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class RenameHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleRenameEvaluate(args: any): Promise<any>;
    handleRenamePreview(args: any): Promise<any>;
    handleRenameExecute(args: any): Promise<any>;
}
