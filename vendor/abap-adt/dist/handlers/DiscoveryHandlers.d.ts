import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class DiscoveryHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleFeatureDetails(args: any): Promise<any>;
    handleCollectionFeatureDetails(args: any): Promise<any>;
    handleFindCollectionByUrl(args: any): Promise<any>;
    handleLoadTypes(args: any): Promise<any>;
    handleAdtDiscovery(args: any): Promise<any>;
    handleAdtCoreDiscovery(args: any): Promise<any>;
    handleAdtCompatibilityGraph(args: any): Promise<any>;
}
