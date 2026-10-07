import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class GitHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleGitRepos(args: any): Promise<any>;
    handleGitExternalRepoInfo(args: any): Promise<any>;
    handleGitCreateRepo(args: any): Promise<any>;
    handleGitPullRepo(args: any): Promise<any>;
    handleGitUnlinkRepo(args: any): Promise<any>;
    handleStageRepo(args: any): Promise<any>;
    handlePushRepo(args: any): Promise<any>;
    handleCheckRepo(args: any): Promise<any>;
    handleRemoteRepoInfo(args: any): Promise<any>;
    handleSwitchRepoBranch(args: any): Promise<any>;
}
