import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class PrettyPrinterHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handlePrettyPrinterSetting(args: any): Promise<any>;
    handleSetPrettyPrinterSetting(args: any): Promise<any>;
    handlePrettyPrinter(args: any): Promise<any>;
}
