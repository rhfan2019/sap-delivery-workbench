import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
import { AtcProposal } from "abap-adt-api";
export declare class AtcHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleAtcCustomizing(args: any): Promise<any>;
    handleAtcCheckVariant(args: {
        variant: string;
    }): Promise<any>;
    handleCreateAtcRun(args: {
        variant: string;
        mainUrl: string;
        maxResults?: number;
    }): Promise<any>;
    handleAtcWorklists(args: {
        runResultId: string;
        timestamp?: number;
        usedObjectSet?: string;
        includeExempted?: boolean;
    }): Promise<any>;
    handleAtcUsers(args: any): Promise<any>;
    handleAtcExemptProposal(args: {
        markerId: string;
    }): Promise<any>;
    handleAtcRequestExemption(args: {
        proposal: AtcProposal;
    }): Promise<any>;
    handleIsProposalMessage(args: {
        proposal: AtcProposal;
    }): Promise<any>;
    handleAtcContactUri(args: {
        findingUri: string;
    }): Promise<any>;
    handleAtcChangeContact(args: {
        itemUri: string;
        userId: string;
    }): Promise<any>;
}
