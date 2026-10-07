import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class TraceHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleTracesList(args: any): Promise<any>;
    handleTracesListRequests(args: any): Promise<any>;
    handleTracesHitList(args: any): Promise<any>;
    handleTracesDbAccess(args: any): Promise<any>;
    handleTracesStatements(args: any): Promise<any>;
    handleTracesSetParameters(args: any): Promise<any>;
    handleTracesCreateConfiguration(args: any): Promise<any>;
    handleTracesDeleteConfiguration(args: any): Promise<any>;
    handleTracesDelete(args: any): Promise<any>;
}
