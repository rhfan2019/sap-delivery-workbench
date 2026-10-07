import { McpServer } from "@modelcontextprotocol/server";
import { ADTClient } from "abap-adt-api";
import { z } from "zod";
import { SourceCache } from "./lib/sourceCache.js";
import { ResultPages } from "./lib/results.js";
export declare class Runtime {
    readonly cache: SourceCache;
    readonly pages: ResultPages;
    readonly handlers: (import("./handlers/AtcHandlers.js").AtcHandlers | import("./handlers/AuthHandlers.js").AuthHandlers | import("./handlers/ClassHandlers.js").ClassHandlers | import("./handlers/CodeAnalysisHandlers.js").CodeAnalysisHandlers | import("./handlers/DdicHandlers.js").DdicHandlers | import("./handlers/DebugHandlers.js").DebugHandlers | import("./handlers/DiscoveryHandlers.js").DiscoveryHandlers | import("./handlers/FeedHandlers.js").FeedHandlers | import("./handlers/GitHandlers.js").GitHandlers | import("./handlers/NodeHandlers.js").NodeHandlers | import("./handlers/ObjectDeletionHandlers.js").ObjectDeletionHandlers | import("./handlers/ObjectHandlers.js").ObjectHandlers | import("./handlers/ObjectLockHandlers.js").ObjectLockHandlers | import("./handlers/ObjectManagementHandlers.js").ObjectManagementHandlers | import("./handlers/ObjectRegistrationHandlers.js").ObjectRegistrationHandlers | import("./handlers/ObjectSourceHandlers.js").ObjectSourceHandlers | import("./handlers/PrettyPrinterHandlers.js").PrettyPrinterHandlers | import("./handlers/QueryHandlers.js").QueryHandlers | import("./handlers/RefactorHandlers.js").RefactorHandlers | import("./handlers/RenameHandlers.js").RenameHandlers | import("./handlers/RevisionHandlers.js").RevisionHandlers | import("./handlers/ServiceBindingHandlers.js").ServiceBindingHandlers | import("./handlers/TraceHandlers.js").TraceHandlers | import("./handlers/TransportHandlers.js").TransportHandlers | import("./handlers/UnitTestHandlers.js").UnitTestHandlers)[];
    readonly tools: {
        definition: import("./types/tools.js").ToolDefinition;
        handler: import("./handlers/AtcHandlers.js").AtcHandlers | import("./handlers/AuthHandlers.js").AuthHandlers | import("./handlers/ClassHandlers.js").ClassHandlers | import("./handlers/CodeAnalysisHandlers.js").CodeAnalysisHandlers | import("./handlers/DdicHandlers.js").DdicHandlers | import("./handlers/DebugHandlers.js").DebugHandlers | import("./handlers/DiscoveryHandlers.js").DiscoveryHandlers | import("./handlers/FeedHandlers.js").FeedHandlers | import("./handlers/GitHandlers.js").GitHandlers | import("./handlers/NodeHandlers.js").NodeHandlers | import("./handlers/ObjectDeletionHandlers.js").ObjectDeletionHandlers | import("./handlers/ObjectHandlers.js").ObjectHandlers | import("./handlers/ObjectLockHandlers.js").ObjectLockHandlers | import("./handlers/ObjectManagementHandlers.js").ObjectManagementHandlers | import("./handlers/ObjectRegistrationHandlers.js").ObjectRegistrationHandlers | import("./handlers/ObjectSourceHandlers.js").ObjectSourceHandlers | import("./handlers/PrettyPrinterHandlers.js").PrettyPrinterHandlers | import("./handlers/QueryHandlers.js").QueryHandlers | import("./handlers/RefactorHandlers.js").RefactorHandlers | import("./handlers/RenameHandlers.js").RenameHandlers | import("./handlers/RevisionHandlers.js").RevisionHandlers | import("./handlers/ServiceBindingHandlers.js").ServiceBindingHandlers | import("./handlers/TraceHandlers.js").TraceHandlers | import("./handlers/TransportHandlers.js").TransportHandlers | import("./handlers/UnitTestHandlers.js").UnitTestHandlers;
        validation: {
            schema: z.ZodObject<{
                [x: string]: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
            }, z.core.$strict>;
            prepare: (args: Record<string, unknown>) => {
                [x: string]: unknown;
            };
        };
    }[];
    readonly client?: ADTClient;
    readonly secrets: string[];
    readonly timeoutMs: number;
    private active?;
    private closing;
    private recoveryRequired;
    constructor(env?: NodeJS.ProcessEnv);
    invoke(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
    close(): Promise<void>;
}
export declare function createServer(runtime: Runtime): McpServer;
