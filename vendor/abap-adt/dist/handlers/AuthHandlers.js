import { stringify } from "../lib/results.js";
import { McpError, ErrorCode } from "../lib/errors.js";
import { BaseHandler } from "./BaseHandler.js";
export class AuthHandlers extends BaseHandler {
    getTools() {
        return [
            {
                name: "login",
                description: "Authenticate with ABAP system",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "logout",
                description: "Terminate ABAP session",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "dropSession",
                description: "Clear local session cache",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
        ];
    }
    async handle(toolName, args) {
        switch (toolName) {
            case "login":
                return this.handleLogin(args);
            case "logout":
                return this.handleLogout(args);
            case "dropSession":
                return this.handleDropSession(args);
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown auth tool: ${toolName}`);
        }
    }
    async handleLogin(args) {
        const startTime = performance.now();
        try {
            const loginResult = await this.adtclient.login();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify(loginResult ?? { status: "logged in" }),
                    },
                ],
            };
        }
        catch (error) {
            this.trackRequest(startTime, false);
            throw error;
        }
    }
    async handleLogout(args) {
        const startTime = performance.now();
        try {
            this.sourceCache.clear();
            await this.adtclient.logout();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({ status: "Logged out successfully" }),
                    },
                ],
            };
        }
        catch (error) {
            this.trackRequest(startTime, false);
            throw error;
        }
    }
    async handleDropSession(args) {
        const startTime = performance.now();
        try {
            this.sourceCache.clear();
            await this.adtclient.dropSession();
            this.trackRequest(startTime, true);
            return {
                content: [
                    {
                        type: "text",
                        text: stringify({ status: "Session cleared" }),
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
