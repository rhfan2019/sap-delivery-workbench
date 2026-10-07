import { stringify } from "../lib/results.js";
import { McpError, ErrorCode } from "../lib/errors.js";
import { BaseHandler } from "./BaseHandler.js";
export class UnitTestHandlers extends BaseHandler {
    getTools() {
        return [
            {
                name: "unitTestRun",
                description: "Runs unit tests.",
                inputSchema: {
                    type: "object",
                    properties: {
                        url: {
                            type: "string",
                            description: "The URL of the object to test.",
                        },
                        flags: {
                            type: "string",
                            description: "Flags for the unit test run.",
                            optional: true,
                        },
                    },
                    required: ["url"],
                },
            },
            {
                name: "unitTestEvaluation",
                description: "Evaluates unit test results.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clas: {
                            type: "string",
                            description: "The class to evaluate.",
                        },
                        flags: {
                            type: "string",
                            description: "Flags for the unit test evaluation.",
                            optional: true,
                        },
                    },
                    required: ["clas"],
                },
            },
            {
                name: "unitTestOccurrenceMarkers",
                description: "Retrieves unit test occurrence markers.",
                inputSchema: {
                    type: "object",
                    properties: {
                        url: {
                            type: "string",
                            description: "The URL of the object.",
                        },
                        source: {
                            type: "string",
                            description: "The source code.",
                        },
                    },
                    required: ["url", "source"],
                },
            },
            {
                name: "createTestInclude",
                description: "Creates a test include for a class.",
                inputSchema: {
                    type: "object",
                    properties: {
                        clas: {
                            type: "string",
                            description: "The class name.",
                        },
                        lockHandle: {
                            type: "string",
                            description: "The lock handle.",
                        },
                        transport: {
                            type: "string",
                            description: "The transport.",
                            optional: true,
                        },
                    },
                    required: ["clas", "lockHandle"],
                },
            },
        ];
    }
    async handle(toolName, args) {
        switch (toolName) {
            case "unitTestRun":
                return this.handleUnitTestRun(args);
            case "unitTestEvaluation":
                return this.handleUnitTestEvaluation(args);
            case "unitTestOccurrenceMarkers":
                return this.handleUnitTestOccurrenceMarkers(args);
            case "createTestInclude":
                return this.handleCreateTestInclude(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown unit test tool: ${toolName}`);
        }
    }
    async handleUnitTestRun(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.unitTestRun(args.url, args.flags);
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
    async handleUnitTestEvaluation(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.unitTestEvaluation(args.clas, args.flags);
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
    async handleUnitTestOccurrenceMarkers(args) {
        const startTime = performance.now();
        try {
            const markers = await this.adtclient.unitTestOccurrenceMarkers(args.url, args.source);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({
                            status: "success",
                            markers,
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
    async handleCreateTestInclude(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.createTestInclude(args.clas, args.lockHandle, args.transport);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({
                            status: "success",
                            result,
                            message: "Test include created successfully",
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
