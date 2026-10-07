import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class ServiceBindingHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handlePublishServiceBinding(args: any): Promise<any>;
    handleUnPublishServiceBinding(args: any): Promise<any>;
    handleBindingDetails(args: any): Promise<any>;
}
