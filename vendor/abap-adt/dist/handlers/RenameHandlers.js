import { stringify } from "../lib/results.js";
import { McpError, ErrorCode } from "../lib/errors.js";
import { BaseHandler } from "./BaseHandler.js";
export class RenameHandlers extends BaseHandler {
    getTools() {
        return [
            {
                name: "renameEvaluate",
                description: "Evaluates a rename refactoring.",
                inputSchema: {
                    type: "object",
                    properties: {
                        uri: {
                            type: "string",
                            description: "The URI of the object to rename.",
                        },
                        line: {
                            type: "number",
                            description: "The line number.",
                        },
                        startColumn: {
                            type: "number",
                            description: "The starting column.",
                        },
                        endColumn: {
                            type: "number",
                            description: "The ending column.",
                        },
                    },
                    required: ["uri", "line", "startColumn", "endColumn"],
                },
            },
            {
                name: "renamePreview",
                description: "Previews a rename refactoring.",
                inputSchema: {
                    type: "object",
                    properties: {
                        renameRefactoring: {
                            type: "object",
                            description: "The rename refactoring proposal.",
                        },
                        transport: {
                            type: "string",
                            description: "The transport.",
                            optional: true,
                        },
                    },
                    required: ["renameRefactoring"],
                },
            },
            {
                name: "renameExecute",
                description: "Executes a rename refactoring.",
                inputSchema: {
                    type: "object",
                    properties: {
                        refactoring: {
                            type: "object",
                            description: "The rename refactoring.",
                        },
                    },
                    required: ["refactoring"],
                },
            },
        ];
    }
    async handle(toolName, args) {
        switch (toolName) {
            case "renameEvaluate":
                return this.handleRenameEvaluate(args);
            case "renamePreview":
                return this.handleRenamePreview(args);
            case "renameExecute":
                return this.handleRenameExecute(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown rename tool: ${toolName}`);
        }
    }
    async handleRenameEvaluate(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.renameEvaluate(args.uri, args.line, args.startColumn, args.endColumn);
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
    async handleRenamePreview(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.renamePreview(args.renameRefactoring, args.transport);
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
    async handleRenameExecute(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.renameExecute(args.refactoring);
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
