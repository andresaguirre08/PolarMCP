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

// Combine tools (omit oauthTools if access token is already provided via ENV)
const allTools = {
  ...(process.env.POLAR_ACCESS_TOKEN ? {} : oauthTools),
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

    // Enable CORS for browser clients (like claude.ai)
    app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-mcp-session-id");
      if (req.method === "OPTIONS") {
        return res.sendStatus(200);
      }
      next();
    });

    // Store active SSE transports by sessionId
    const transports = new Map<string, SSEServerTransport>();

    app.get("/sse", async (req, res) => {
      console.log("🟢 New SSE connection request");
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);

      req.on("close", () => {
        console.log(`🔌 Connection closed for session ${transport.sessionId}`);
        transports.delete(transport.sessionId);
      });

      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);

      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(400).send(`Session ${sessionId} not found`);
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
