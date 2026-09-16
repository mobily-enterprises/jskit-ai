import { createMemoryTurnRequests } from "../../test/support/memoryTurnRequests.js";
import { createChatService } from "../../src/server/services/chatService.js";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  server: { host: "127.0.0.1", strictPort: true },
  plugins: [vue(), {
    name: "controlled-assistant-api",
    configureServer(server) {
      const streams = [];
      const requests = [];
      const transcript = [];
      const turnRequests = createMemoryTurnRequests();
      let realService = false;
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, "http://fixture");
        if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/fixture/")) return next();
        const json = (value) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
        const send = (stream, event) => stream.res.write(`${JSON.stringify(event)}\n`);
        if (url.pathname === "/api/session") return json({ csrfToken: "fixture-only" });
        if (url.pathname === "/fixture/service") { realService = true; return json({ ok: true }); }
        if (url.pathname === "/fixture/state") return json({ requests, transcript, streams: streams.map(({ closed }) => ({ closed })) });
        if (url.pathname === "/fixture/next") {
          for (const stream of streams.filter((entry) => !entry.closed)) {
            if (stream.advance) { stream.advance(url.searchParams); continue; }
            if (url.searchParams.has("fail")) {
              send(stream, { type: "error", message: "Fixture provider failed." });
              send(stream, { type: "done", status: "failed" });
              stream.res.end();
            } else if (url.searchParams.has("finish")) {
              send(stream, { type: "tool_result", toolCallId: "lookup", ok: true, result: { private: "never-render-this-payload" } });
              send(stream, { type: "assistant_delta", delta: " completed." });
              send(stream, { type: "done", status: "completed" });
              stream.res.end();
            } else {
              send(stream, { type: "assistant_delta", delta: "Partial answer" });
            }
          }
          return json({ ok: true });
        }
        if (url.pathname.endsWith("/chat/stream")) {
          let body = "";
          for await (const part of req) body += part;
          const payload = JSON.parse(body);
          requests.push({ path: url.pathname, surface: req.headers['x-jskit-surface'], ...payload });
          res.setHeader("Content-Type", "application/x-ndjson");
          const stream = { res, closed: false };
          streams.push(stream);
          res.on("close", () => { stream.closed = true; });
          if (realService) {
            const controller = new AbortController();
            res.on("close", () => controller.abort());
            let release;
            const nextChunk = () => new Promise((resolve, reject) => {
              release = resolve;
              controller.signal.addEventListener("abort", () => reject(new Error("Stopped")), { once: true });
            });
            stream.advance = parameters => release(parameters);
            const service = createChatService({
              turnRequests,
              aiClientFactory: { async resolveClient(_surface, { integrationId }) {
                return { enabled: true, provider: "fixture", defaultModel: integrationId, supportsAttachments: true,
                  async *createChatCompletionStream({ messages }) {
                    stream.receivedFiles = messages.at(-1).content;
                    await nextChunk();
                    yield { choices: [{ delta: { content: "Partial answer" } }] };
                    await nextChunk();
                    yield { choices: [{ delta: { content: " completed." } }] };
                  }
                };
              } },
              attachments: { async resolve({ attachmentIds }) {
                return { attachments: attachmentIds.map(attachmentId => ({ attachmentId, fileName: "notes.txt", size: 5 })),
                  content: [{ type: "text", text: "Uploaded notes" }] };
              } },
              transcriptService: {
                async createConversationForTurn() { return { conversation: { id: "100" } }; },
                async appendMessage(_surface, _id, message) { transcript.push(message); },
                async completeConversation() {}
              },
              serviceToolCatalog: { resolveToolSet: () => ({ tools: [] }) },
              assistantConfigService: { resolveSystemPrompt: async () => "Answer the user." },
              appConfig: { surfaceDefinitions: { admin: { id: "admin", enabled: true, requiresWorkspace: false, accessPolicyId: "public" } },
                assistantSurfaces: { admin: { settingsSurfaceId: "admin", configScope: "global" } } }
            });
            const streamWriter = Object.fromEntries(["sendMeta", "sendAssistantDelta", "sendAssistantMessage", "sendToolCall", "sendToolResult", "sendError", "sendDone"].map(method => [method, event => send(stream, event)]));
            try { await service.streamChat({ ...payload, targetSurfaceId: "admin" }, { streamWriter, abortSignal: controller.signal, context: { actor: { id: "1" } } }); }
            catch (error) { if (!res.destroyed) send(stream, { type: "error", message: error.message }); }
            finally { res.end(); }
            return;
          }
          send(stream, { type: "meta", conversationId: payload.conversationId || "100" });
          send(stream, { type: "tool_call", toolCallId: "lookup", name: "Look up records", arguments: "never-render-this-payload" });
          return;
        }
        if (url.pathname.endsWith("/messages")) {
          const id = url.pathname.split("/").at(-2);
          const entries = Array.from({ length: 70 }, (_, index) => ({
            id: String(index + 1), kind: "chat", role: index % 2 ? "assistant" : "user",
            contentText: index < 2 ? "Identical text" : `Saved ${id} message ${index + 1}.\n\n**Formatted** answer with a [link](https://example.com). Long_text_keeps_wrapping_in_a_narrow_drawer_even_while_other_content_is_streaming.`
          }));
          return json({ data: { type: "assistant-conversation-messages", id, attributes: { entries, totalPages: 1 } } });
        }
        if (url.pathname.endsWith("/conversations")) {
          const older = url.searchParams.has("page[cursor]");
          return json({ data: [{ type: "assistant-conversations", id: older ? "2" : "1", attributes: {
            title: older ? "Older conversation" : "Saved conversation", status: "completed", startedAt: "2026-09-01T00:00:00Z"
          } }], meta: { page: { nextCursor: older ? null : "older" } } });
        }
        res.statusCode = 404;
        json({ error: "Unknown fixture request" });
      });
    }
  }]
});
