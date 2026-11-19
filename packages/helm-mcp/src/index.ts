#!/usr/bin/env node
/**
 * stdio MCP server for HelmSwap. Never holds keys, never signs, never broadcasts.
 * Default API: https://helmswap.com
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHelmMcpServer } from "./server.js";

const server = createHelmMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
