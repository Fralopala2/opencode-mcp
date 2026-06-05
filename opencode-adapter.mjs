import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";

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

async function ensureServerRunning() {
  try {
    const res = await fetch('http://127.0.0.1:4096/global/health');
    if (res.ok) {
      const data = await res.json();
      if (data.healthy) return;
    }
  } catch (e) {
    // server is down, start it
  }

  console.error("Starting OpenCode server...");
  const proc = spawn('opencode', ['serve', '--port=4096'], {
    shell: true,
    detached: true,
    stdio: 'ignore'
  });
  proc.unref();

  // Wait for server to become healthy (max 10 seconds)
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('http://127.0.0.1:4096/global/health');
      if (res.ok) {
        const data = await res.json();
        if (data.healthy) return;
      }
    } catch (e) {
      // ignore
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("Timeout waiting for OpenCode server to start");
}

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
      await ensureServerRunning();
      
      const baseUrl = 'http://127.0.0.1:4096';
      
      // Create session
      const sessionRes = await fetch(`${baseUrl}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Antigravity MCP Session' })
      });
      if (!sessionRes.ok) {
        throw new Error(`Failed to create session: ${sessionRes.statusText}`);
      }
      const session = await sessionRes.json();
      const sessionId = session.id;

      // Start event listener
      let outputText = '';
      const controller = new AbortController();
      const eventPromise = (async () => {
        const response = await fetch(`${baseUrl}/event`, {
          headers: { 'Accept': 'text/event-stream' },
          signal: controller.signal
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';

          for (const chunk of chunks) {
            const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;

            const json = dataLine.replace(/^data:\s*/, '');
            if (!json || json === '[DONE]') continue;

            try {
              const event = JSON.parse(json);
              if (event.type === 'message.part.delta') {
                const props = event.properties;
                if (props?.sessionID === sessionId && props.field === 'text' && props.delta) {
                  outputText += props.delta;
                }
              } else if (event.type === 'session.idle' && event.properties?.sessionID === sessionId) {
                controller.abort();
                return;
              }
            } catch (e) {
              // ignore
            }
          }
        }
      })();

      // Send prompt
      const promptRes = await fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: [{ type: 'text', text: prompt }]
        })
      });
      if (!promptRes.ok) {
        controller.abort();
        throw new Error(`Failed to send prompt: ${promptRes.statusText}`);
      }

      await eventPromise.catch(err => {
        if (err.name !== 'AbortError') {
          throw err;
        }
      });

      return {
        content: [
          {
            type: "text",
            text: outputText.trim(),
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
