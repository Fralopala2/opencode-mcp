import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const server = new Server(
  {
    name: "opencode-adapter",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "ask_opencode",
        description: "Envia una consulta a OpenCode",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "La consulta o instrucción para OpenCode",
            },
          },
          required: ["prompt"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "ask_opencode") {
    const prompt = String(request.params.arguments?.prompt);
    
    try {
      // Usamos opencode run
      const { stdout, stderr } = await execAsync(`opencode run "${prompt.replace(/"/g, '\\"')}" --pure`);
      
      return {
        content: [
          {
            type: "text",
            text: stdout || stderr,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error ejecutando OpenCode: ${error.message}`,
          },
        ],
      };
    }
  }

  throw new Error("Tool no encontrada");
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OpenCode MCP Adapter ejecutándose...");
}

run().catch(console.error);
