import { stringify } from "../lib/results.js";
import { McpError, ErrorCode } from "../lib/errors.js";
import { BaseHandler } from "./BaseHandler.js";
export class ObjectManagementHandlers extends BaseHandler {
    getTools() {
        return [
            {
                name: "activateObjects",
                description: "Activate ABAP objects using object references",
                inputSchema: {
                    type: "object",
                    properties: {
                        objects: {
                            type: "string",
                            description: "JSON array of objects to activate. Each object must have adtcore:uri, adtcore:type, adtcore:name, and adtcore:parentUri properties",
                        },
                        preauditRequested: {
                            type: "boolean",
                            description: "Whether to perform pre-audit checks",
                            optional: true,
                        },
                    },
                    required: ["objects"],
                },
            },
            {
                name: "activateByName",
                description: "Activate an ABAP object using name and URL",
                inputSchema: {
                    type: "object",
                    properties: {
                        objectName: {
                            type: "string",
                            description: "Name of the object",
                        },
                        objectUrl: {
                            type: "string",
                            description: "URL of the object",
                        },
                        mainInclude: {
                            type: "string",
                            description: "Main include context",
                            optional: true,
                        },
                        preauditRequested: {
                            type: "boolean",
                            description: "Whether to perform pre-audit checks",
                            optional: true,
                        },
                    },
                    required: ["objectName", "objectUrl"],
                },
            },
            {
                name: "inactiveObjects",
                description: "Get list of inactive objects",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
        ];
    }
    async handle(toolName, args) {
        switch (toolName) {
            case "activateObjects":
                return this.handleActivateObjects(args);
            case "activateByName":
                return this.handleActivateByName(args);
            case "inactiveObjects":
                return this.handleInactiveObjects(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown object management tool: ${toolName}`);
        }
    }
    async handleActivateObjects(args) {
        const startTime = performance.now();
        try {
            if (!args.objects ||
                (typeof args.objects !== "string" && !Array.isArray(args.objects))) {
                throw new McpError(ErrorCode.InvalidParams, "objects parameter must be a JSON string");
            }
            let objects;
            try {
                objects =
                    typeof args.objects === "string"
                        ? JSON.parse(args.objects)
                        : args.objects;
                if (!Array.isArray(objects)) {
                    throw new Error("Parsed objects must be an array");
                }
                // Validate each object has required properties
                objects.forEach((obj, index) => {
                    if (!obj["adtcore:uri"] ||
                        !obj["adtcore:type"] ||
                        !obj["adtcore:name"] ||
                        !obj["adtcore:parentUri"]) {
                        throw new Error(`Object at index ${index} is missing required properties`);
                    }
                });
            }
            catch (parseError) {
                throw new McpError(ErrorCode.InvalidParams, `Invalid objects JSON: ${parseError.message}`);
            }
            const result = await this.adtclient.activate(objects, args.preauditRequested);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify(result),
                    },
                ],
            };
        }
        catch (error) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) {
                throw error;
            }
            throw error;
        }
    }
    async handleActivateByName(args) {
        const startTime = performance.now();
        try {
            if (!args.objectName || !args.objectUrl) {
                throw new McpError(ErrorCode.InvalidParams, "objectName and objectUrl parameters are required");
            }
            const result = await this.adtclient.activate(args.objectName, args.objectUrl, args.mainInclude, args.preauditRequested);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify(result),
                    },
                ],
            };
        }
        catch (error) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) {
                throw error;
            }
            throw error;
        }
    }
    async handleInactiveObjects(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.inactiveObjects();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify(result),
                    },
                ],
            };
        }
        catch (error) {
            this.trackRequest(startTime, false);
            if (error instanceof McpError) {
                throw error;
            }
            throw error;
        }
    }
}
