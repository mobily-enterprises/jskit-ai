import { defaultSettingsMiddleware, extractReasoningMiddleware, wrapLanguageModel } from "ai";
import {
  LEAKED_MARKUP, REASONING, checkTexts, clipOldResult, compactMessages, createTool, remindOnRepeat, reportsActions, runLoop,
  stoppedShort, stripNotes, toolRecord, unsupportedClaims, windowLimits, withinBudget, withoutClosingWords, withoutMarkup
} from "@jskit-ai/agent/server";
import { conversationRequestText } from "../continuity.js";
import { validateConversationConfiguration, validateConnectionModel } from "../configuration.js";

// The agent engine's account of a reply that stopped early, and its checks, speak for a
// generic assistant in an app.
const NAME = "the assistant";
const APP = "the app";
const CHECKS = checkTexts(APP);
// The engine's step limit for work with app tools; a reply without tools is one step anyway.
const MAX_STEPS = 40;
// The engine's sizes are for a window of a million tokens (WINDOW_TOKENS). Many catalogue
// models (DeepSeek's chat models, Groq's, GPT-4o) have 128k: sized for 1M, their requests
// would fail long before compaction began, while sized for 128k a larger window only
// compacts sooner. The former character cap was about 64k tokens of history.
const CONTEXT_TOKENS = 128_000;
const OUTPUT_LIMIT = "The assistant exceeded the configured response limit.";
const PROGRESS_LIMIT = "Application tool progress text exceeds the configured API limit.";

// The model sees an action's result, or its error. The durable receipt keeps
// its full ok/result/error envelope in common storage.
const toolOutput = result => result.ok ? result.result ?? null : { error: result.error };

/** A turn whose caller follows no phase events. */
function ignoreEvent() {}

// The engine's state note: what the system knows for certain this turn. It carries
// the time, so no turn needs an extra action to learn it.
function stateNote() {
  const now = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }).format(new Date());
  return ["Current state, from the system. It is the truth; earlier messages may be out of date:",
    `- The time: ${now} UTC. The person may be in another time zone.`].join("\n");
}

const content = message => message.content?.length
  ? [...(message.text ? [{ type: "text", text: message.text }] : []), ...message.content] : message.text;

// A recorded action's receipt id is the provider's call id under its step (`reply-N:`). The
// model reads the provider's own id, as it does within a reply: providers restrict their ids
// (Anthropic's take only letters, digits, "_" and "-"; Mistral's are nine characters).
const providerCallId = id => id.replace(/^reply-\d+:/u, "");

// A saved turn as model messages: the authored request, its recorded application
// actions with their results (long old results cut, as the engine reads them), the answer.
function turnMessages(turn) {
  return [
    ...(turn.user ? [{ role: "user", content: content({ ...turn.user, text: conversationRequestText(turn.user) }) }] : []),
    ...(turn.system ? [{ role: "user", content: content({ ...turn.system, text: conversationRequestText({ ...turn.system, origin: "application" }) }) }] : []),
    ...(turn.metadata?.applicationTools || []).filter(call => call.result).flatMap(call => [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: providerCallId(call.id), toolName: call.name,
        input: call.arguments ? JSON.parse(call.arguments) : {} }] },
      clipOldResult({ role: "tool", content: [{ type: "tool-result", toolCallId: providerCallId(call.id), toolName: call.name,
        output: { type: "json", value: toolOutput(call.result) } }] })
    ]),
    ...(turn.assistant ? [{ role: "assistant", content: turn.assistant.text }] : [])
  ];
}

/**
 * Direct API inference runs on the agent engine with the same authorized connection catalogue as other JSKIT services.
 * The application passes the conversation runtime its authorized AI connection resolver, or its own API client factory.
 * @param {object} dependencies
 * @param {{ resolve(request: { context: object, integrationId: string }): Promise<object> }} [dependencies.connections]
 * @param {{ resolveClient(request: { context: object, configuration: object }): Promise<{ enabled: boolean, model: object, defaultModel: string }> }} [dependencies.apiClientFactory]
 * @param {typeof fetch} [dependencies.fetch]
 * @param {Record<string, number>} [dependencies.limits]
 */
export function createApiConversationDriver({ connections, apiClientFactory, fetch, limits = {} }) {
  // readable-check: allow method-probe - input validation: the API client factory an application passes the conversation runtime
  if (apiClientFactory !== undefined && (!apiClientFactory || typeof apiClientFactory.resolveClient !== "function")) {
    throw new TypeError("An API client factory requires resolveClient({ context, configuration }).");
  }
  // readable-check: allow method-probe - input validation: the AI connection resolver an application passes the conversation runtime
  if (!apiClientFactory && (!connections || typeof connections.resolve !== "function")) {
    throw new TypeError("API conversations require an authorized AI connection resolver.");
  }
  const maximumOutput = limits.maxOutputCharacters ?? 64_000;
  const maximumToolProgress = limits.maxApiToolProgressCharacters;
  // The runtime ends a turn with an error past its application action-call limit (32 by
  // default), so the step limit stays within it and a long turn ends with the model's account.
  const maximumSteps = limits.maxSteps ?? Math.min(MAX_STEPS, limits.maxToolCalls ?? 32);
  const contextTokens = limits.contextTokens ?? CONTEXT_TOKENS;
  for (const limit of [maximumOutput, maximumSteps, contextTokens]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Invalid API conversation limit.");
  }
  if (maximumToolProgress !== undefined && (!Number.isSafeInteger(maximumToolProgress) || maximumToolProgress < 1)) {
    throw new TypeError("Invalid API application tool progress limit.");
  }
  const window = windowLimits(contextTokens);
  const driver = Object.freeze({
    admissionBeforeDispatch: true,
    attachmentTypes: ["text", "image", "file"],
    capabilities: Object.freeze({ streaming: true, cancellation: true, instructions: true,
      configuration: true, history: true, steering: false, goals: false, attachments: true, tools: true, nativeTools: false, structuredOutput: false }),
    open() { return { run: driver.run, dispose: async () => {} }; },
    validateConfiguration(configuration) {
      validateConversationConfiguration(configuration, { engine: "API", connections, apiClientFactory, connectionRequired: true,
        efforts: ["none", "minimal", "low", "medium", "high", "xhigh"] });
    },
    // `summary` is the stored summary of the turns before `history`; `saveSummary`
    // stores a new one, so the next turn reads only the turns after it.
    async run({ configuration, context, input, history, requestHistory, continuity, tools, signal, accept, beforeDispatch,
      onMessage, onEvent = ignoreEvent, summary = "", saveSummary }) {
      const { createAiConnectionClient } = await import("../../lib/aiConnectionClient.js");
      // A broken receipt, a lost authorization or a limit ends the reply with its
      // own error: the engine ends at once with an aborted signal's reason.
      const stop = new AbortController();
      const stopped = AbortSignal.any([signal, stop.signal]);
      const fail = error => {
        if (!stop.signal.aborted) stop.abort(error);
        return stop.signal.reason;
      };

      async function resolveModel() {
        if (apiClientFactory) {
          const client = await apiClientFactory.resolveClient({ context, configuration });
          if (!client?.enabled || !client.model) throw new Error("Assistant provider is not configured.");
          validateConnectionModel(configuration, { model: client.defaultModel });
          return client.model;
        }
        const connection = await connections.resolve({ context, integrationId: configuration.integrationId });
        validateConnectionModel(configuration, connection);
        return createAiConnectionClient(connection, { fetch }).model;
      }
      async function authorize() {
        const model = await resolveModel();
        stopped.throwIfAborted();
        await beforeDispatch();
        return model;
      }

      // Admission precedes every model call. Each later call (steps, checks,
      // summaries, accounts) authorizes the same connection again. Reasoning a
      // model writes inline in <think> tags is reasoning, never reply text.
      // `stepWords` are the streaming step's words so far, without that reasoning: its
      // actions run only once its model call has ended, so they are all said by then.
      let admitted = false;
      let stepWords = "";
      const model = wrapLanguageModel({ model: await authorize(), middleware: [
        { specificationVersion: "v4", async transformParams({ params }) {
          if (admitted) await authorize().catch(error => { throw fail(error); });
          admitted = true;
          return params;
        }, async wrapStream({ doStream }) {
          const result = await doStream();
          stepWords = "";
          return { ...result, stream: result.stream.pipeThrough(new TransformStream({ transform(part, controller) {
            if (part.type === "text-delta") stepWords += part.delta;
            controller.enqueue(part);
          } })) };
        } },
        extractReasoningMiddleware({ tagName: "think" }),
        ...(configuration.effort ? [defaultSettingsMiddleware({ settings: { reasoning: configuration.effort } })] : [])
      ] });
      await accept();

      let step = 0;
      const repeats = {};
      async function runTool(call) {
        // A step's progress is shown and held to its limits before any of its actions
        // runs. Another action after an unknown outcome could repeat it.
        try {
          await stepProgress();
          return await tools.execute(call);
        } catch (error) { throw fail(error); }
      }
      /** One engine tool call, recorded under its step, with the model-facing result. */
      function runEngineTool(name, value, { toolCallId }) {
        return runTool({
          id: `reply-${step + 1}:${toolCallId}`, name, arguments: JSON.stringify(value ?? {}) }).then(toolOutput);
      }
      const engineTools = Object.fromEntries((tools?.schemas || []).map(({ function: tool }) => {
        // The engine's copy of the frozen definition is the one its repeat reminder wraps.
        const engineTool = createTool(Object.freeze({ id: tool.name, description: tool.description, parameters: tool.parameters,
          execute: (value, options) => runEngineTool(tool.name, value, options) }));
        remindOnRepeat(engineTool, repeats);
        return [tool.name, engineTool];
      }));

      const request = { role: "user", content: content(input) };
      let earlier = summary;
      let recorded = requestHistory ?? history.flatMap(turnMessages);
      // The runtime's own history is compacted between turns; the summary and
      // its last turn are stored, so later turns read only what follows.
      if (!requestHistory && saveSummary) {
        let started = false;
        try {
          const compacted = await compactMessages({ model, app: APP, messages: recorded, previous: summary, limits: window.summaries,
            onCompacting: async () => { started = true; await onEvent({ type: "phase", phase: "compacting" }); } });
          if (compacted.saved) {
            // The summary ends where a turn starts.
            let covered = 0;
            let throughTurnId = "";
            for (const turn of history) {
              const size = turnMessages(turn).length;
              if (covered + size > compacted.saved.covers) break;
              covered += size;
              throughTurnId = turn.turnId;
            }
            await saveSummary({ text: compacted.summary, throughTurnId });
            ({ summary: earlier, messages: recorded } = compacted);
          }
        } catch (error) {
          stopped.throwIfAborted();
          // The engine's last-resort cut below still keeps the reply within its window.
          console.error(`Compacting a conversation: ${error?.message || error}`);
        }
        if (started) await onEvent({ type: "phase", phase: "working" });
      }
      const messages = withinBudget([...(continuity ? [{ role: "user", content: continuity }] : []), ...recorded, request], window.history);

      // Each step streams as reply-N. A step that also calls tools ends as
      // commentary; the reply's last words become the answer.
      // Output past its limit stops showing at once and fails the reply before the
      // step's actions run, or when it ends: aborting a stream mid-way leaves Node 26
      // an unhandled rejection.
      let answer = "";
      let overLimit = false;
      // The engine's reply joins every step's words; the answer leaves out those
      // already shown as commentary, unless they are all there is.
      const shown = [];
      const unsaid = text => shown.reduce((rest, said) => rest === said ? ""
        : rest.startsWith(`${said}\n\n`) ? rest.slice(said.length + 2) : rest, text) || text;
      // A step whose actions run completes as commentary before the first of them;
      // one whose calls don't run (an action it wasn't given) does when it ends.
      let progress = { id: "", words: "", shown: null };
      function stepProgress() {
        const id = `reply-${step + 1}`;
        if (progress.id !== id) progress = { id, words: stepWords, shown: showProgress(id, stepWords) };
        return progress.shown;
      }
      async function showProgress(id, words) {
        if (words.length > maximumOutput) throw new Error(OUTPUT_LIMIT);
        const text = withoutMarkup(words);
        if (maximumToolProgress !== undefined && text.length > maximumToolProgress) throw new Error(PROGRESS_LIMIT);
        if (answer === id) answer = "";
        if (text) await onMessage({ id, outputId: id, role: "commentary", text, complete: true });
      }
      async function onText(text) {
        overLimit ||= text.length > maximumOutput;
        const visible = withoutMarkup(text);
        // Words streamed after their step's progress was shown are already in it.
        if (!visible || overLimit || progress.id === `reply-${step + 1}`) return;
        answer = `reply-${step + 1}`;
        await onMessage({ id: answer, outputId: answer, role: "assistant", text: visible, complete: false });
      }
      async function onStep(result) {
        const id = `reply-${++step}`;
        if (overLimit) return fail(new Error(OUTPUT_LIMIT));
        if (result.finishReason === "length") return fail(new Error("The model reached its output token limit before completing the answer. Increase maxOutputTokens in the conversation limits."));
        if (!result.toolCalls.length) return;
        const text = withoutMarkup(result.text);
        if (maximumToolProgress !== undefined && text.length > maximumToolProgress) return fail(new Error(PROGRESS_LIMIT));
        if (answer === id) answer = "";
        if (!text) return;
        shown.push(...result.content.filter(part => part.type === "text").map(part => part.text.trim()).filter(Boolean));
        if (progress.id === id && progress.words === result.text) return;
        await onMessage({ id, outputId: id, role: "commentary", text, complete: true });
      }
      const pass = async history => {
        const result = await runLoop({ model, name: NAME, instructions: configuration.systemPrompt, history, tools: engineTools,
          summary: earlier, state: stateNote(), maxSteps: maximumSteps, onText, onStep, signal: stopped, clean: text => stripNotes(unsaid(text)),
          // With nothing done yet, a failed call is the reply's error, not an account.
          throwIf: (_error, steps) => !step && !steps.length,
          // A configured effort reaches every provider the standard way.
          reasoning: configuration.effort ? {} : REASONING.on,
          ...(limits.maxOutputTokens ? { maxOutputTokens: limits.maxOutputTokens } : {}) });
        stopped.throwIfAborted();
        return result;
      };

      let { text, transcript, unfinished, account } = await pass(messages);
      // A check sends the reply back once, carrying on from its own steps.
      let check = "";
      async function carryOn(name, note) {
        check = name;
        const steps = withoutClosingWords(transcript);
        const next = await pass([...messages, ...steps.map(clipOldResult), { role: "user", content: note }]);
        ({ text, unfinished } = next);
        transcript = [...steps, ...next.transcript];
      }
      const working = Object.keys(engineTools).length > 0;
      if (working && LEAKED_MARKUP.test(text)) await carryOn("markup", CHECKS.markup);
      // The engine's own account of a reply that stopped early already says where it got to.
      else if (working && !account && stoppedShort(text.trim())) await carryOn("stoppedShort", CHECKS.stoppedShort);
      if (!check && working && reportsActions(text)) {
        const claims = await unsupportedClaims({ model, reply: text, record: toolRecord(transcript, [], APP) });
        stopped.throwIfAborted();
        if (claims.length) await carryOn("unsupported", CHECKS.unsupported(claims));
      }
      text = withoutMarkup(text);
      if (text.length > maximumOutput) throw new Error(OUTPUT_LIMIT);
      if (text) {
        const id = answer || `reply-${step + 1}`;
        await onMessage({ id, outputId: id, role: "assistant", text, complete: true });
      }
      return { metadata: { ...(unfinished ? { unfinished } : {}), ...(check ? { check } : {}) } };
    }
  });
  return driver;
}
