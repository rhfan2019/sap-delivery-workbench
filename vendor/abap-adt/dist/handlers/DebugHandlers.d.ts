import { BaseHandler } from "./BaseHandler.js";
import type { ToolDefinition } from "../types/tools.js";
export declare class DebugHandlers extends BaseHandler {
    getTools(): ToolDefinition[];
    handle(toolName: string, args: any): Promise<any>;
    handleDebuggerListeners(args: any): Promise<any>;
    handleDebuggerListen(args: any): Promise<any>;
    handleDebuggerDeleteListener(args: any): Promise<any>;
    handleDebuggerSetBreakpoints(args: any): Promise<any>;
    handleDebuggerDeleteBreakpoints(args: any): Promise<any>;
    handleDebuggerAttach(args: any): Promise<any>;
    handleDebuggerSaveSettings(args: any): Promise<any>;
    handleDebuggerStackTrace(args: any): Promise<any>;
    handleDebuggerVariables(args: any): Promise<any>;
    handleDebuggerChildVariables(args: any): Promise<any>;
    handleDebuggerStep(args: any): Promise<any>;
    handleDebuggerGoToStack(args: any): Promise<any>;
    handleDebuggerSetVariableValue(args: any): Promise<any>;
}
