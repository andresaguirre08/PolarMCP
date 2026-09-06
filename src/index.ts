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

    // Discovery endpoints for verification probes
    app.get("/.well-known/oauth-authorization-server", (req, res) => {
      res.json({
        issuer: "https://polarmcp-production.up.railway.app",
        authorization_endpoint: "https://flow.polar.com/oauth2/authorization",
        token_endpoint: "https://polarremote.com/v2/oauth2/token",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
      });
    });

    app.get("/.well-known/openid-configuration", (req, res) => {
      res.json({
        issuer: "https://polarmcp-production.up.railway.app",
        authorization_endpoint: "https://flow.polar.com/oauth2/authorization",
        token_endpoint: "https://polarremote.com/v2/oauth2/token",
      });
    });

    app.get("/.well-known/mcp", (req, res) => {
      res.json({
        name: "polar-accesslink",
        version: "1.0.0",
        transport: "sse",
        endpoint: "/sse",
      });
    });

    // Store active SSE transports by sessionId
    const transports = new Map<string, SSEServerTransport>();

    const handleSse = async (req: express.Request, res: express.Response) => {
      console.log("🟢 New SSE connection request");
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);

      req.on("close", () => {
        console.log(`🔌 Connection closed for session ${transport.sessionId}`);
        transports.delete(transport.sessionId);
      });

      await server.connect(transport);
    };

    app.get("/sse", handleSse);

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
