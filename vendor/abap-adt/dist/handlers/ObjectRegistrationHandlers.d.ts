import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class ObjectRegistrationHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleObjectRegistrationInfo(args: any): Promise<any>;
    handleValidateNewObject(args: any): Promise<any>;
    handleCreateObject(args: any): Promise<any>;
}
