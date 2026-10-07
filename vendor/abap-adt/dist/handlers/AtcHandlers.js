import { stringify } from "../lib/results.js";
import { BaseHandler } from "./BaseHandler.js";
import { McpError, ErrorCode } from "../lib/errors.js";
export class AtcHandlers extends BaseHandler {
    getTools() {
        return [
            {
                name: "atcCustomizing",
                description: "Retrieves ATC customizing information.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "atcCheckVariant",
                description: "Retrieves information about an ATC check variant.",
                inputSchema: {
                    type: "object",
                    properties: {
                        variant: {
                            type: "string",
                            description: "The name of the ATC check variant.",
                        },
                    },
                    required: ["variant"],
                },
            },
            {
                name: "createAtcRun",
                description: "Creates an ATC run.",
                inputSchema: {
                    type: "object",
                    properties: {
                        variant: {
                            type: "string",
                            description: "The name of the ATC check variant.",
                        },
                        mainUrl: {
                            type: "string",
                            description: "The main URL for the ATC run.",
                        },
                        maxResults: {
                            type: "number",
                            description: "The maximum number of results to retrieve.",
                            optional: true,
                        },
                    },
                    required: ["variant", "mainUrl"],
                },
            },
            {
                name: "atcWorklists",
                description: "Retrieves ATC worklists.",
                inputSchema: {
                    type: "object",
                    properties: {
                        runResultId: {
                            type: "string",
                            description: "The ID of the ATC run result.",
                        },
                        timestamp: {
                            type: "number",
                            description: "The timestamp.",
                            optional: true,
                        },
                        usedObjectSet: {
                            type: "string",
                            description: "The used object set.",
                            optional: true,
                        },
                        includeExempted: {
                            type: "boolean",
                            description: "Whether to include exempted findings.",
                            optional: true,
                        },
                    },
                    required: ["runResultId"],
                },
            },
            {
                name: "atcUsers",
                description: "Retrieves a list of ATC users.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "atcExemptProposal",
                description: "Retrieves an ATC exemption proposal.",
                inputSchema: {
                    type: "object",
                    properties: {
                        markerId: {
                            type: "string",
                            description: "The ID of the marker.",
                        },
                    },
                    required: ["markerId"],
                },
            },
            {
                name: "atcRequestExemption",
                description: "Requests an ATC exemption.",
                inputSchema: {
                    type: "object",
                    properties: {
                        proposal: {
                            type: "object",
                            description: "The ATC exemption proposal.",
                        },
                    },
                    required: ["proposal"],
                },
            },
            {
                name: "isProposalMessage",
                description: "Checks if a given object is a proposal message.",
                inputSchema: {
                    type: "object",
                    properties: {
                        proposal: {
                            type: "object",
                            description: "The ATC exemption proposal.",
                        },
                    },
                    required: ["proposal"],
                },
            },
            {
                name: "atcContactUri",
                description: "Retrieves the contact URI for an ATC finding.",
                inputSchema: {
                    type: "object",
                    properties: {
                        findingUri: {
                            type: "string",
                            description: "The URI of the ATC finding.",
                        },
                    },
                    required: ["findingUri"],
                },
            },
            {
                name: "atcChangeContact",
                description: "Changes the contact for an ATC finding.",
                inputSchema: {
                    type: "object",
                    properties: {
                        itemUri: {
                            type: "string",
                            description: "The URI of the item.",
                        },
                        userId: {
                            type: "string",
                            description: "The ID of the user.",
                        },
                    },
                    required: ["itemUri", "userId"],
                },
            },
        ];
    }
    async handle(toolName, args) {
        switch (toolName) {
            case "atcCustomizing":
                return this.handleAtcCustomizing(args);
            case "atcCheckVariant":
                return this.handleAtcCheckVariant(args);
            case "createAtcRun":
                return this.handleCreateAtcRun(args);
            case "atcWorklists":
                return this.handleAtcWorklists(args);
            case "atcUsers":
                return this.handleAtcUsers(args);
            case "atcExemptProposal":
                return this.handleAtcExemptProposal(args);
            case "atcRequestExemption":
                return this.handleAtcRequestExemption(args);
            case "isProposalMessage":
                return this.handleIsProposalMessage(args);
            case "atcContactUri":
                return this.handleAtcContactUri(args);
            case "atcChangeContact":
                return this.handleAtcChangeContact(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown ATC tool: ${toolName}`);
        }
    }
    async handleAtcCustomizing(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcCustomizing();
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
    async handleAtcCheckVariant(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcCheckVariant(args.variant);
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
    async handleCreateAtcRun(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.createAtcRun(args.variant, args.mainUrl, args.maxResults ?? 100);
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
    async handleAtcWorklists(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcWorklists(args.runResultId, args.timestamp || 0, args.usedObjectSet || "", args.includeExempted);
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
    async handleAtcUsers(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcUsers();
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
    async handleAtcExemptProposal(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcExemptProposal(args.markerId);
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
    async handleAtcRequestExemption(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcRequestExemption(args.proposal);
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
    async handleIsProposalMessage(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.isProposalMessage(args.proposal);
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
    async handleAtcContactUri(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcContactUri(args.findingUri);
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
    async handleAtcChangeContact(args) {
        const startTime = performance.now();
        try {
            const result = await this.adtclient.atcChangeContact(args.itemUri, args.userId);
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
