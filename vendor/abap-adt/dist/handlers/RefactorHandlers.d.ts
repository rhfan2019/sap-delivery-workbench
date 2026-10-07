import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class RefactorHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    private parseObjectArg;
    handleExtractMethodEvaluate(args: any): Promise<any>;
    handleExtractMethodPreview(args: any): Promise<any>;
    handleExtractMethodExecute(args: any): Promise<any>;
}
