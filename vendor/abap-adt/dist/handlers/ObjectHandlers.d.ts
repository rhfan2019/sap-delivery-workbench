import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class ObjectHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleObjectStructure(args: any): Promise<any>;
    handleFindObjectPath(args: any): Promise<any>;
    handleSearchObject(args: any): Promise<any>;
    handleObjectTypes(args: any): Promise<any>;
    handleReentranceTicket(args: any): Promise<any>;
}
