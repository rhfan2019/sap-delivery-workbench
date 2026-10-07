import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class UnitTestHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleUnitTestRun(args: any): Promise<any>;
    handleUnitTestEvaluation(args: any): Promise<any>;
    handleUnitTestOccurrenceMarkers(args: any): Promise<any>;
    handleCreateTestInclude(args: any): Promise<any>;
}
