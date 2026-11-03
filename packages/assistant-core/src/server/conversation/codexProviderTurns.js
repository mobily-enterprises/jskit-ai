import { CODEX_APP_SERVER_PROVIDER_ID } from "./codexProcess.js";
import { codexAppServerErrorText } from "./codexEvents.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText as normalizeAgentText } from "./normalize.js";

/** @typedef {import("./codexProvider.js").CodexAppServerAgentProvider} CodexAppServerAgentProvider */

export function codexAppServerEndpointForTarget(endpoint = "") {
  const normalizedEndpoint = normalizeAgentText(endpoint);
  if (!normalizedEndpoint) {
    return "";
  }
  return normalizedEndpoint;
}

export function codexTextInput(text = "") {
  return {
    text: String(text ?? ""),
    text_elements: [],
    type: "text"
  };
}

export function codexLocalImageInput(attachments = []) {
  return attachments
    .filter((attachment) => attachment.contentType?.startsWith("image/"))
    .map((attachment) => ({ type: "localImage", path: attachment.path }));
}

export async function sendCodexAppServerPrompt({
  attachments = [],
  clientUserMessageId = "",
  outputSchema = null,
  provider,
  prompt = "",
  threadId = "",
  readOnly = false
} = {}, authorized = {}) {
  const authoredInput = String(prompt ?? "");
  const preparedInput = authorized.preparedInput;
  if (preparedInput === undefined && !authoredInput.trim()) {
    throw new Error("Codex app-server prompt is empty.");
  }
  const input = preparedInput === undefined ? [authoredInput, ...codexLocalImageInput(attachments)] : preparedInput;
  const turnSettings = {
    ...authorized.turnSettings,
    ...(readOnly
      ? {
          sandboxPolicy: {
            networkAccess: false,
            type: "readOnly"
          }
        }
      : {}),
    ...(normalizeAgentText(clientUserMessageId)
      ? { clientUserMessageId: normalizeAgentText(clientUserMessageId) }
      : {})
  };
  if (outputSchema && typeof outputSchema === "object" && !Array.isArray(outputSchema)) {
    turnSettings.outputSchema = outputSchema;
  }
  const turn = await provider.sendTurn(threadId, input, turnSettings);
  return {
    input,
    turn
  };
}

export function codexTurnInput(input = []) {
  const values = Array.isArray(input) ? input : [input];
  return values.map((item) => {
    if (isRecord(item) && item.type === "localImage" && typeof item.path === "string") {
      return { type: "localImage", path: item.path };
    }
    if (isRecord(item) && item.type === "image" && typeof item.url === "string") {
      return { type: "image", url: item.url };
    }
    if (isRecord(item) && item.type === "text") {
      return codexTextInput(item.text);
    }
    return codexTextInput(item);
  });
}

export function shellQuote(value = "") {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", "'\"'\"'")}'`;
}

export function codexControlProbeCommand(keys, marker) {
  const source = [
    "const {createHash}=require('node:crypto');",
    `const keys=${JSON.stringify(keys)};`,
    `process.stdout.write(${JSON.stringify(marker)}+createHash('sha256').update(JSON.stringify(keys.map(key=>[key,process.env[key]]))).digest('hex'))`
  ].join("");
  return `${shellQuote(process.execPath)} -e ${shellQuote(source)}`;
}

export function codexCliResumeCommand({
  codexCommand = "",
  endpoint = "",
  threadId = ""
} = {}) {
  const normalizedEndpoint = codexAppServerEndpointForTarget(endpoint);
  const resolvedCodexCommand = normalizeAgentText(codexCommand) || "codex";
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedEndpoint) {
    throw new Error("Codex app-server endpoint is required for the native CLI command.");
  }
  if (!normalizedThreadId) {
    throw new Error("Codex thread id is required for the native CLI command.");
  }
  const argv = [
    resolvedCodexCommand,
    "-c",
    "check_for_update_on_startup=false",
    "--remote",
    normalizedEndpoint,
    "resume",
    normalizedThreadId
  ];
  return {
    argv,
    command: argv.map(shellQuote).join(" ")
  };
}

function normalizeAgentTurn(value = {}) {
  const turn = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    id: normalizeAgentText(turn.id || turn.turnId),
    provider: normalizeAgentText(turn.provider),
    // readable-check: allow no-dual-shape - data: a turn record arrives with Codex's raw turn or is that raw turn
    raw: turn.raw || turn,
    status: normalizeAgentText(turn.status || turn.raw?.status)
  };
}

// The one reading of a sendTurn delivery. Its turn is already normalized; the
// provider's own error stays on the raw native turn.
export function codexAppServerDeliveredTurn(delivery) {
  const turn = delivery?.turn || {};
  return {
    turnId: normalizeAgentText(turn.id),
    status: normalizeAgentText(turn.status || turn.raw?.status),
    error: codexAppServerErrorText(turn.raw?.error || turn.response?.turn?.error || turn.error)
  };
}

/** @param {CodexAppServerAgentProvider} provider */
export async function sendTurn(provider, threadId = "", input = [], params = {}, { signal } = {}) {
  const operation = async () => {
    const client = await provider.activeClient();
    return client.request("turn/start", {
      ...params,
      input: codexTurnInput(input),
      threadId: normalizeAgentText(threadId || params.threadId)
    }, { signal });
  };
  const response = provider.options.prepareThreadEnvironment
    ? await provider.withThreadEnvironment(threadId || params.threadId, {}, operation)
    : await provider.runRequest(operation, "codex-app-server-turn-start");
  return {
    ...normalizeAgentTurn({
      id: response?.turn?.id || response?.turnId,
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      // readable-check: allow no-dual-shape - data: Codex replies to a turn request with the turn wrapped or bare
      raw: response?.turn || response
    }),
    response
  };
}

/** @param {CodexAppServerAgentProvider} provider */
export async function steerTurn(provider, threadId = "", turnId = "", input = [], params = {}, { signal } = {}) {
  const client = await provider.activeClient();
  const response = await provider.runRequest(
    () => client.request("turn/steer", {
      ...params,
      expectedTurnId: normalizeAgentText(turnId || params.expectedTurnId),
      input: codexTurnInput(input),
      threadId: normalizeAgentText(threadId || params.threadId)
    }, { signal }),
    "codex-app-server-turn-steer"
  );
  return {
    ...normalizeAgentTurn({
      id: response?.turn?.id || response?.turnId || turnId,
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      // readable-check: allow no-dual-shape - data: Codex replies to a turn request with the turn wrapped or bare
      raw: response?.turn || response
    }),
    response
  };
}

/** @param {CodexAppServerAgentProvider} provider */
export function interruptionOutcome(provider, threadId = "", turnId = "") {
  const key = JSON.stringify([normalizeAgentText(threadId), normalizeAgentText(turnId)]);
  return provider.interruptedTurns.get(key) || "";
}

/** @param {CodexAppServerAgentProvider} provider */
export async function interruptTurn(provider, threadId = "", turnId = "", { outcome = "" } = {}) {
  const client = await provider.activeClient();
  return provider.runRequest(
    () => interruptNativeTurn(provider, client, normalizeAgentText(threadId), normalizeAgentText(turnId), undefined, outcome),
    "codex-app-server-turn-interrupt"
  );
}

/** @param {CodexAppServerAgentProvider} provider */
export async function interruptNativeTurn(provider, client, threadId, turnId, signal, outcome = "") {
  const key = JSON.stringify([threadId, turnId]);
  provider.interruptedTurns.set(key, outcome || provider.interruptedTurns.get(key) || "");
  const result = await client.request("turn/interrupt", { threadId, turnId }, { signal });
  await Promise.all([...provider.commandExecutions.values()]
    .filter((command) => command.threadId === threadId && command.turnId === turnId)
    .map((command) => stopCommandExecution(provider, command)));
  return result;
}

/** @param {CodexAppServerAgentProvider} provider */
export function stopCommandExecution(provider, command) {
  if (command.stopTask) return command.stopTask;
  command.stopTask = (async () => {
    const signal = AbortSignal.timeout(5000);
    const request = (method, params) => command.client.request(method, params, { signal });
    while (!command.completed) {
      signal.throwIfAborted();
      let cursor;
      let terminal;
      const cursors = new Set();
      do {
        const page = await request("thread/backgroundTerminals/list", {
          threadId: command.threadId, limit: 100, ...(cursor ? { cursor } : {})
        });
        if (!Array.isArray(page.data)) throw new Error("Codex returned no command inventory.");
        terminal = page.data.find((entry) => entry.processId === command.processId);
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error("Codex repeated its command inventory cursor.");
        cursors.add(cursor);
      } while (!terminal && cursor);
      if (command.completed) return;
      if (terminal) {
        // A recycled process ID must never target a different command.
        if (terminal.itemId !== command.itemId) throw new Error("The native command identity changed during Stop.");
        const stopped = await request("thread/backgroundTerminals/terminate", {
          threadId: command.threadId, processId: command.processId
        });
        if (stopped.terminated === true) return;
      }
      // Codex emits command-start before adding it to the process inventory.
      // Absence during that interval is not proof that the command exited.
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  })().catch((cause) => {
    const error = Object.assign(new Error("Codex could not confirm that the stopped turn's command exited.", { cause }), {
      code: `${provider.errorPrefix}codex_command_stop_unconfirmed`
    });
    provider.commandStopFailure = error;
    // Reuse the existing verified-runtime-stop owner when native control fails.
    // That owner may already be awaiting this command while stopping a lost
    // observation. Do not make command cleanup wait on its own caller.
    void Promise.resolve(provider.failObservation(error)).catch(() => null);
    throw error;
  });
  return command.stopTask;
}

/** @param {CodexAppServerAgentProvider} provider */
export function nativeCliResumeCommand(provider, threadId = "") {
  const runtime = provider.runtime || {};
  return codexCliResumeCommand({
    codexCommand: provider.options.codexCommand || "codex",
    endpoint: runtime.endpoint,
    threadId
  });
}
