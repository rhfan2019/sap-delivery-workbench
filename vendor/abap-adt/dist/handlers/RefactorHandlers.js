import { stringify } from "../lib/results.js";
import { McpError, ErrorCode } from "../lib/errors.js";
import { BaseHandler } from "./BaseHandler.js";
export class RefactorHandlers extends BaseHandler {
    getTools() {
        return [
            {
                name: "extractMethodEvaluate",
                description: "Evaluates an extract method refactoring.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: {
                            type: "string",
                            description: "The URI of the object.",
                        },
                        range: {
                            type: "string",
                            description: 'The range to extract, as a JSON string, e.g. {"start":{"line":1,"column":0},"end":{"line":5,"column":10}}',
                        },
                    },
                    required: ["uri", "range"],
                },
            },
            {
                name: "extractMethodPreview",
                description: "Previews an extract method refactoring.",
                inputSchema: {
                    type: "object",
                    properties: {
                        proposal: {
                            type: "string",
                            description: "The extract method proposal returned by extractMethodEvaluate, as a JSON string.",
                        },
                    },
                    required: ["proposal"],
                },
            },
            {
                name: "extractMethodExecute",
                description: "Executes an extract method refactoring.",
                inputSchema: {
                    type: "object",
                    properties: {
                        refactoring: {
                            type: "string",
                            description: "The refactoring returned by extractMethodPreview, as a JSON string.",
                        },
                    },
                    required: ["refactoring"],
                },
            },
        ];
    }
    async handle(toolName, args) {
        switch (toolName) {
            case "extractMethodEvaluate":
                return this.handleExtractMethodEvaluate(args);
            case "extractMethodPreview":
                return this.handleExtractMethodPreview(args);
            case "extractMethodExecute":
                return this.handleExtractMethodExecute(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown refactor tool: ${toolName}`);
        }
    }
    // Schemas declare these params as JSON strings, but the abap-adt-api methods
    // expect deserialized objects; also accept plain objects for forward compatibility
    parseObjectArg(value, name) {
        if (typeof value !== "string")
            return value;
        try {
            return JSON.parse(value);
        }
        catch {
            throw new McpError(ErrorCode.InvalidParams, `Parameter '${name}' is not valid JSON`);
        }
    }
    async handleExtractMethodEvaluate(args) {
        const startTime = performance.now();
        try {
            const range = this.parseObjectArg(args.range, "range");
            const result = await this.adtclient.extractMethodEvaluate(args.uri, range);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({
                            status: "success",
                            result,
                        }),
                    },
                ],
            };
        }
        catch (error) {
            this.trackRequest(startTime, false);
            throw error;
        }
    }
    async handleExtractMethodPreview(args) {
        const startTime = performance.now();
        try {
            const proposal = this.parseObjectArg(args.proposal, "proposal");
            const result = await this.adtclient.extractMethodPreview(proposal);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({
                            status: "success",
                            result,
                        }),
                    },
                ],
            };
        }
        catch (error) {
            this.trackRequest(startTime, false);
            throw error;
        }
    }
    async handleExtractMethodExecute(args) {
        const startTime = performance.now();
        try {
            const refactoring = this.parseObjectArg(args.refactoring, "refactoring");
            const result = await this.adtclient.extractMethodExecute(refactoring);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({
                            status: "success",
                            result,
                        }),
                    },
                ],
            };
        }
        catch (error) {
            this.trackRequest(startTime, false);
            throw error;
        }
    }
}
