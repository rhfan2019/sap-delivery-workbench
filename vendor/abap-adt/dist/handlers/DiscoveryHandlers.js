import { stringify } from "../lib/results.js";
import { McpError, ErrorCode } from "../lib/errors.js";
import { BaseHandler } from "./BaseHandler.js";
export class DiscoveryHandlers extends BaseHandler {
    getTools() {
        return [
            {
                name: "featureDetails",
                description: "Retrieves details for a given feature.",
                inputSchema: {
                    type: "object",
                    properties: {
                        title: {
                            type: "string",
                            description: "The title of the feature.",
                        },
                    },
                    required: ["title"],
                },
            },
            {
                name: "collectionFeatureDetails",
                description: "Retrieves details for a given collection feature.",
                inputSchema: {
                    type: "object",
                    properties: {
                        url: {
                            type: "string",
                            description: "The URL of the collection feature.",
                        },
                    },
                    required: ["url"],
                },
            },
            {
                name: "findCollectionByUrl",
                description: "Finds a collection by its URL.",
                inputSchema: {
                    type: "object",
                    properties: {
                        url: {
                            type: "string",
                            description: "The URL of the collection.",
                        },
                    },
                    required: ["url"],
                },
            },
            {
                name: "loadTypes",
                description: "Loads object types.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "adtDiscovery",
                description: "Performs ADT discovery.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "adtCoreDiscovery",
                description: "Performs ADT core discovery.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "adtCompatibiliyGraph",
                description: "Retrieves the ADT compatibility graph.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
        ];
    }
    async handle(toolName, args) {
        switch (toolName) {
            case "featureDetails":
                return this.handleFeatureDetails(args);
            case "collectionFeatureDetails":
                return this.handleCollectionFeatureDetails(args);
            case "findCollectionByUrl":
                return this.handleFindCollectionByUrl(args);
            case "loadTypes":
                return this.handleLoadTypes(args);
            case "adtDiscovery":
                return this.handleAdtDiscovery(args);
            case "adtCoreDiscovery":
                return this.handleAdtCoreDiscovery(args);
            case "adtCompatibiliyGraph":
                return this.handleAdtCompatibilityGraph(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown discovery tool: ${toolName}`);
        }
    }
    async handleFeatureDetails(args) {
        const startTime = performance.now();
        try {
            const details = await this.adtclient.featureDetails(args.title);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({
                            status: "success",
                            details,
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
    async handleCollectionFeatureDetails(args) {
        const startTime = performance.now();
        try {
            const details = await this.adtclient.collectionFeatureDetails(args.url);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({
                            status: "success",
                            details,
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
    async handleFindCollectionByUrl(args) {
        const startTime = performance.now();
        try {
            const collection = await this.adtclient.findCollectionByUrl(args.url);
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({
                            status: "success",
                            collection,
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
    async handleLoadTypes(args) {
        const startTime = performance.now();
        try {
            const types = await this.adtclient.loadTypes();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({
                            status: "success",
                            types,
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
    async handleAdtDiscovery(args) {
        const startTime = performance.now();
        try {
            const discovery = await this.adtclient.adtDiscovery();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({
                            status: "success",
                            discovery,
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
    async handleAdtCoreDiscovery(args) {
        const startTime = performance.now();
        try {
            const discovery = await this.adtclient.adtCoreDiscovery();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({
                            status: "success",
                            discovery,
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
    async handleAdtCompatibilityGraph(args) {
        const startTime = performance.now();
        try {
            const graph = await this.adtclient.adtCompatibiliyGraph();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({
                            status: "success",
                            graph,
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
