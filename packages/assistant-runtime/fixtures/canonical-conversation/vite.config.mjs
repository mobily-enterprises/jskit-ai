import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { createConversationTranscript } from "@jskit-ai/assistant-core/server/conversation";

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  server: { host: "127.0.0.1", strictPort: true },
  plugins: [vue(), {
    name: "controlled-canonical-assistant-api",
    configureServer(server) {
      let states, requests, held, mode, denied;
      const pageLimits = new Map();
      // Exercise the existing page reader over this fixture's controlled rows.
      const transcript = createConversationTranscript({ storage: {
        read(id, callback) {
          const turns = states.get(id).conversationLog;
          return callback({ listTurnIds: () => turns.map(turn => turn.turnId),
            readTurn: turnId => turns.find(turn => turn.turnId === turnId) });
        },
        write() { throw new Error("The fixture owns its controlled rows."); }
      } });
      function reset() {
        states = new Map(Array.from({ length: 5 }, (_, index) => {
          const id = `chat:${index + 1}`;
          return [id, { id, engine: "api", segmentId: `segment-${index + 1}`, status: "ready", conversationLog: [],
            streaming: { revision: 0, messages: [] }, capabilities: { steering: false, goals: false, attachments: true } }];
        }));
        requests = []; held = []; mode = "accepted"; denied = false; pageLimits.clear();
      }
      reset();
      function accept(state, input) {
        state.pendingRequest = null;
        state.status = "working";
        const turn = { turnId: input.messageId, user: { messageId: input.messageId, text: input.text,
          role: "user", at: new Date().toISOString(), attachments: input.attachments || (input.attachmentIds || []).map(attachmentId => ({ attachmentId })) },
          assistant: null, metadata: { runtime: { status: "running" } } };
        state.conversationLog.push(turn);
        return { status: "accepted", messageId: input.messageId, turnId: turn.turnId };
      }
      function changeGoal(state, input) {
        if (input.action === "set") {
          if (state.segmentId === null) state.segmentId = `first-native-thread-${state.id}`;
          state.goal = { id: `goal-${input.messageId || state.segmentId}`, objective: input.objective,
            status: "active", timeUsedSeconds: 10, updatedAt: new Date().toISOString(), tokenBudget: input.tokenBudget ?? null };
        }
        if (input.action === "resume") state.goal.status = "active";
        if (input.action === "pause") state.goal.status = "paused";
        if (input.action === "cancel") state.goal = null;
        if (state.capabilities.goalCommands[input.action].interruptsTurn) state.status = "ready";
      }
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url, "http://fixture");
        if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/fixture/")) return next();
        const json = (value, status = 200) => { response.statusCode = status; response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value)); };
        let body = "";
        for await (const part of request) body += part;
        const input = body ? JSON.parse(body) : {};
        if (url.pathname === "/api/session") return json({ csrfToken: "fixture-only" });
        if (url.pathname === "/fixture/reset") { reset(); return json({ ok: true }); }
        if (url.pathname === "/fixture/state") return json({ requests, states: Object.fromEntries(states), held: held.length });
        if (url.pathname === "/fixture/mode") { mode = input.mode; return json({ ok: true }); }
        if (url.pathname === "/fixture/deny") { denied = input.denied; return json({ ok: true }); }
        if (url.pathname === "/fixture/error") { states.get(input.id).error = input.error; return json({ ok: true }); }
        if (url.pathname === "/fixture/interim-reply") { states.get(input.id).interimReply = input.reply; return json({ ok: true }); }
        if (url.pathname === "/fixture/history") {
          states.get(input.id).conversationLog = input.turns;
          pageLimits.set(input.id, input.limit);
          return json({ ok: true });
        }
        if (url.pathname === "/fixture/question") {
          const state = states.get(input.id);
          const assistant = { messageId: "fixture-question", role: "assistant", text: input.text,
            status: input.pending ? "inProgress" : "completed" };
          state.status = input.pending ? "working" : "ready";
          state.conversationLog = [{ turnId: "fixture-question", assistant, messages: [assistant] }];
          return json({ ok: true });
        }
        if (url.pathname === "/fixture/attachments") { states.get(input.id).capabilities.attachments = input.enabled; return json({ ok: true }); }
        if (url.pathname === "/fixture/steering") { states.get(input.id).capabilities.steering = input.enabled; return json({ ok: true }); }
        if (url.pathname === "/fixture/goals") {
          const state = states.get(input.id);
          state.engine = "fixture-native";
          state.segmentId = Object.hasOwn(input, "segmentId") ? input.segmentId : `${state.segmentId}-next`;
          state.status = "ready";
          state.goal = null;
          state.capabilities = { ...state.capabilities, goals: true, goalBudgets: input.budgets,
            goalCommands: input.commands };
          return json({ ok: true });
        }
        if (url.pathname === "/fixture/confirm") {
          const state = states.get(input.id);
          const pending = state.pendingRequest;
          const receipt = accept(state, pending);
          if (pending.goal) changeGoal(state, { ...pending.goal, messageId: pending.messageId });
          return json(receipt);
        }
        if (url.pathname === "/fixture/accept") {
          for (const pending of held.splice(0)) {
            const receipt = accept(states.get(pending.id), pending.input);
            if (input.holdResponse) held.push({ ...pending, receipt });
            else pending.respond(receipt);
          }
          return json({ ok: true });
        }
        if (url.pathname === "/fixture/release-response") {
          for (const pending of held.splice(0)) pending.respond(pending.receipt);
          return json({ ok: true });
        }
        if (url.pathname === "/fixture/finish") {
          const state = states.get(input.id);
          state.status = "ready";
          const last = state.conversationLog.at(-1);
          if (last) { last.assistant = { role: "assistant", messageId: `${last.turnId}:answer`, text: input.text || "Completed answer." }; last.metadata.runtime.status = "complete"; }
          return json({ ok: true });
        }
        const match = /^\/api\/assistant\/home\/conversations\/([^/]+)(.*)$/u.exec(url.pathname);
        if (!match) return json({ error: "Unknown fixture route" }, 404);
        const id = decodeURIComponent(match[1]);
        const state = states.get(id);
        requests.push({ method: request.method, id, suffix: match[2], surface: request.headers["x-jskit-surface"], input, query: Object.fromEntries(url.searchParams) });
        if (denied || !state) return json({ error: "Access denied.", code: "conversation_forbidden" }, 403);
        if (request.method === "GET" && !match[2]) {
          return json(pageLimits.has(id) ? { ...state, ...await transcript.readConversationLogPage(id, {
            beforeTurnId: url.searchParams.get("beforeTurnId") || "",
            limit: url.searchParams.get("limit") || pageLimits.get(id)
          }) } : state);
        }
        if (match[2] === "/goal") {
          if (request.method === "GET") return json(state.goal || null, state.goal ? 200 : 204);
          const command = state.capabilities.goalCommands?.[input.action];
          if (!command) return json({ error: "Unsupported goal command.", code: "conversation_unsupported" }, 400);
          if (input.expectedSegmentId !== state.segmentId || state.segmentId === null && input.action !== "set") {
            return json({ error: "The native conversation changed.", code: "conversation_goal_changed" }, 409);
          }
          if (command.delivery === "message" && mode === "uncertain") {
            state.status = "unconfirmed";
            state.pendingRequest = { messageId: input.messageId, text: input.objective || "Resume the goal.",
              origin: "user", attachments: [], goal: input, error: "The goal's receipt was lost." };
            return json({ error: state.pendingRequest.error }, 503);
          }
          const receipt = command.delivery === "message" ? accept(state, { messageId: input.messageId,
            text: input.objective || (input.action === "resume" ? "Resume the goal." : "Cancel the goal.") }) : null;
          changeGoal(state, input);
          const result = receipt || state.goal || null;
          return json(result, result === null ? 204 : 200);
        }
        if (match[2] === "/messages") {
          if (mode === "product-rejected") return json({ ok: false, delivered: false,
            messageId: input.messageId, code: "product_owner_conflict", error: "This turn belongs to another user.",
            operationOutcome: "active_turn_owned_by_another_user", retryable: true, refreshRecommended: true }, 202);
          if (mode === "product-native-duplicate") return json({ ok: true, delivered: true, messageId: input.messageId }, 202);
          if (mode === "product-accepted") {
            accept(state, input);
            return json({ ok: true, delivered: true, messageId: input.messageId }, 202);
          }
          if (mode === "rejected") return json({ error: "The message was rejected before admission.", code: "ACTION_VALIDATION_FAILED" }, 400);
          if (mode === "uncertain") {
            state.status = "unconfirmed";
            state.pendingRequest = { messageId: input.messageId, text: input.text, origin: "user",
              ...(input.data !== undefined ? { data: input.data } : {}),
              attachments: (input.attachmentIds || []).map(attachmentId => ({ attachmentId })), error: "Connection closed before the receipt arrived." };
            return json({ error: state.pendingRequest.error }, 503);
          }
          if (mode === "hold") { held.push({ id, input, respond: value => json(value, 202) }); return; }
          return json(accept(state, input), 202);
        }
        if (match[2] === "/cancel") { state.status = "ready"; return json({ stopped: true }); }
        if (match[2].startsWith("/deliveries/") && match[2].endsWith("/inspect")) {
          const messageId = decodeURIComponent(match[2].split("/")[2]);
          const receipt = state.conversationLog.find(turn => turn.user?.messageId === messageId);
          if (!receipt && mode === "not-sent") return json({ status: "not-sent", messageId, error: "This message was not sent. Review it before sending a new message." });
          return json(receipt ? { status: "accepted", messageId, turnId: receipt.turnId } : { status: "unknown", messageId });
        }
        return json({ error: "Unknown fixture operation" }, 404);
      });
    }
  }]
});
