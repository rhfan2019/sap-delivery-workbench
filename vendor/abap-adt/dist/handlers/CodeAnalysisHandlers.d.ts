import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class CodeAnalysisHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleSyntaxCheckCdsUrl(args: any): Promise<any>;
    handleSyntaxCheckCode(args: any): Promise<any>;
    handleCodeCompletion(args: any): Promise<any>;
    handleFindDefinition(args: any): Promise<any>;
    handleUsageReferences(args: any): Promise<any>;
    handleSyntaxCheckTypes(args: any): Promise<any>;
    handleCodeCompletionFull(args: any): Promise<any>;
    handleRunClass(args: any): Promise<any>;
    handleCodeCompletionElement(args: any): Promise<any>;
    handleUsageReferenceSnippets(args: any): Promise<any>;
    handleFixProposals(args: any): Promise<any>;
    handleFixEdits(args: any): Promise<any>;
    handleFragmentMappings(args: any): Promise<any>;
    handleAbapDocumentation(args: any): Promise<any>;
}
