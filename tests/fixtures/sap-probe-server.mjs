import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server = new McpServer({ name: 'sap-probe-fixture', version: '1' });
server.registerTool(
  'tableContents',
  { inputSchema: { ddicEntityName: z.string(), rowNumber: z.number(), decode: z.boolean() } },
  async () => {
    const source = process.env.SAP_USER;
    const error =
      source === 'bad-auth'
        ? 'HTTP 401 password=' + process.env.SAP_PASSWORD
        : source === 'bad-network'
          ? 'ECONNREFUSED'
          : null;
    return error
      ? { isError: true, content: [{ type: 'text', text: JSON.stringify({ error }) }] }
      : {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                result: [
                  { COMPONENT: 'SAP_BASIS', RELEASE: '758' },
                  { COMPONENT: 'S4CORE', RELEASE: '108' },
                ],
              }),
            },
          ],
        };
  },
);
await server.connect(new StdioServerTransport());
