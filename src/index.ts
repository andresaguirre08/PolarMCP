#!/usr/bin/env node

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import { userTools } from "./tools/users.js";
import { exerciseTools } from "./tools/exercises.js";
import { activityTools } from "./tools/activities.js";
import {
  physicalInfoTools,
  heartRateTools,
  sleepTools,
  nightlyRechargeTools,
  cardioLoadTools,
  sleepWiseTools,
} from "./tools/physical.js";
import { oauthTools } from "./tools/oauth.js";

// Combine all tools
const allTools = {
  ...oauthTools,
  ...userTools,
  ...exerciseTools,
  ...activityTools,
  ...physicalInfoTools,
  ...heartRateTools,
  ...sleepTools,
  ...nightlyRechargeTools,
  ...cardioLoadTools,
  ...sleepWiseTools,
};

// Create MCP server
const server = new McpServer({
  name: "polar-accesslink",
  version: "1.0.0",
});

// Register all tools
for (const [, toolDef] of Object.entries(allTools)) {
  server.tool(
    toolDef.name,
    toolDef.description,
    toolDef.inputSchema.shape,
    toolDef.annotations,
    async (args: Record<string, unknown>) => {
      try {
        const parsed = toolDef.inputSchema.parse(args);
        const result = await toolDef.handler(parsed as never);

        return {
          content: [
            {
              type: "text" as const,
              text: result,
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// Start the server
async function main() {
  const PORT = process.env.PORT;

  if (PORT) {
    const app = express();
    let transport: SSEServerTransport | null = null;

    app.get("/sse", async (req, res) => {
      console.log("🟢 New SSE connection established");
      transport = new SSEServerTransport("/messages", res);
      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(400).send("No active SSE session");
      }
    });

    app.get("/health", (req, res) => {
      res.status(200).send("OK");
    });

    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`🚀 Polar AccessLink MCP Server listening on port ${PORT}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Polar AccessLink MCP Server started (stdio)");
  }
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
