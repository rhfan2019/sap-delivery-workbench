import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class TransportHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleTransportInfo(args: any): Promise<any>;
    handleCreateTransport(args: any): Promise<any>;
    handleHasTransportConfig(args: any): Promise<any>;
    handleTransportConfigurations(args: any): Promise<any>;
    handleGetTransportConfiguration(args: any): Promise<any>;
    handleSetTransportsConfig(args: any): Promise<any>;
    handleCreateTransportsConfig(args: any): Promise<any>;
    handleUserTransports(args: any): Promise<any>;
    handleTransportsByConfig(args: any): Promise<any>;
    handleTransportDelete(args: any): Promise<any>;
    handleTransportRelease(args: any): Promise<any>;
    handleTransportSetOwner(args: any): Promise<any>;
    handleTransportAddUser(args: any): Promise<any>;
    handleSystemUsers(args: any): Promise<any>;
    handleTransportReference(args: any): Promise<any>;
}
