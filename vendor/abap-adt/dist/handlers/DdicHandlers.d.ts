import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class DdicHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleAnnotationDefinitions(args: any): Promise<any>;
    handleDdicElement(args: any): Promise<any>;
    handleDdicRepositoryAccess(args: any): Promise<any>;
    handlePackageSearchHelp(args: any): Promise<any>;
}
