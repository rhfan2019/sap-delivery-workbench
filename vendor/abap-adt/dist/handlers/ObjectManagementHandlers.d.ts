import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class ObjectManagementHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleActivateObjects(args: any): Promise<any>;
    handleActivateByName(args: any): Promise<any>;
    handleInactiveObjects(args: any): Promise<any>;
}
