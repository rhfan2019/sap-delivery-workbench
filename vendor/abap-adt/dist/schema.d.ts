import { z } from "zod";
import type { ToolDefinition } from "./types/tools.js";
export declare function validateJson(value: unknown): void;
export declare function toolSchema(tool: ToolDefinition): {
    schema: z.ZodObject<{
        [x: string]: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
    }, z.core.$strict>;
    prepare: (args: Record<string, unknown>) => {
        [x: string]: unknown;
    };
};
