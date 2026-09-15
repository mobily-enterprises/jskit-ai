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
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, "http://fixture");
        if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/fixture/")) return next();
        const json = (value) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
        const send = (stream, event) => stream.res.write(`${JSON.stringify(event)}\n`);
        if (url.pathname === "/api/session") return json({ csrfToken: "fixture-only" });
        if (url.pathname === "/fixture/state") return json({ requests, streams: streams.map(({ closed }) => ({ closed })) });
        if (url.pathname === "/fixture/next") {
          for (const stream of streams.filter((entry) => !entry.closed)) {
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
