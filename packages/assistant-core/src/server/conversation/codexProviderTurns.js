import { CODEX_APP_SERVER_PROVIDER_ID } from "./codexProcess.js";
import { createHash, randomUUID } from "node:crypto";
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
/**
 * The provider's turns: sending, steering and interrupting them, the native commands they start, and the
 * control probes that verify a thread's environment.
 * @param {object} dependencies
 * @param {CodexAppServerAgentProvider} dependencies.provider
 */
export function createCodexProviderTurns({ provider }) {
  // Native commands a turn started, by thread, turn and item.
  const commandExecutions = new Map();
  // How each interrupted turn ended, by thread and turn.
  const interruptedTurns = new Map();
  // Each thread's pending or verified environment probe.
  const threadControlProbes = new Map();
  let commandStopFailure = null;

  async function sendTurn(threadId = "", input = [], params = {}, { signal } = {}) {
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

  async function steerTurn(threadId = "", turnId = "", input = [], params = {}, { signal } = {}) {
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

  function interruptionOutcome(threadId = "", turnId = "") {
    const key = JSON.stringify([normalizeAgentText(threadId), normalizeAgentText(turnId)]);
    return interruptedTurns.get(key) || "";
  }

  async function interruptTurn(threadId = "", turnId = "", { outcome = "" } = {}) {
    const client = await provider.activeClient();
    return provider.runRequest(
      () => interruptNativeTurn(client, normalizeAgentText(threadId), normalizeAgentText(turnId), undefined, outcome),
      "codex-app-server-turn-interrupt"
    );
  }

  async function interruptNativeTurn(client, threadId, turnId, signal, outcome = "") {
    const key = JSON.stringify([threadId, turnId]);
    interruptedTurns.set(key, outcome || interruptedTurns.get(key) || "");
    const result = await client.request("turn/interrupt", { threadId, turnId }, { signal });
    await Promise.all([...commandExecutions.values()]
      .filter((command) => command.threadId === threadId && command.turnId === turnId)
      .map((command) => stopCommandExecution(command)));
    return result;
  }

  function stopCommandExecution(command) {
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
      commandStopFailure = error;
      // A failed native control stops work through the lost-observation path, whose owner verifies the
      // runtime stop. That owner may already be awaiting this command while stopping a lost observation,
      // so command cleanup does not wait on its own caller.
      void Promise.resolve(provider.failObservation(error)).catch(() => null);
      throw error;
    });
    return command.stopTask;
  }

  function nativeCliResumeCommand(threadId = "") {
    const runtime = provider.runtime || {};
    return codexCliResumeCommand({
      codexCommand: provider.options.codexCommand || "codex",
      endpoint: runtime.endpoint,
      threadId
    });
  }

  async function verifyThreadEnvironment(threadId, environment, request, signal, { requiredKeys = [] } = {}) {
    const keys = Object.keys(environment).filter((key) => key.startsWith(provider.configuration.controlEnvironmentPrefix) || requiredKeys.includes(key)).sort();
    if (!keys.length) return;
    const marker = `${provider.configuration.controlProbePrefix}${randomUUID()}:`;
    const probe = { marker, pending: [], verified: false, turnId: "" };
    threadControlProbes.set(threadId, probe);
    const expected = createHash("sha256").update(JSON.stringify(keys.map((key) => [key, environment[key]]))).digest("hex");
    // This bounded native shell check uses no model and prints only a digest,
    // never credentials or environment values.
    await request("thread/shellCommand", {
      threadId, command: codexControlProbeCommand(keys, marker), timeoutMs: 2000
    });
    while (true) {
      signal.throwIfAborted();
      // The native completion event owns this result; saved history is not a
      // second acknowledgement of this live control operation.
      if (probe.completed && probe.result) {
        if (probe.result.type !== "commandExecution" || probe.result.exitCode !== 0 ||
            probe.result.aggregatedOutput?.trim() !== `${marker}${expected}`) {
          throw Object.assign(new Error("Another native subscriber retained the previous assistant settings. Close the native assistant terminal and retry Resume."), {
            code: "assistant_agent_control_binding_retained"
          });
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  function isControlProbeTurn(threadId, turnId) {
    const probe = threadControlProbes.get(threadId);
    return Boolean(turnId && probe?.verified && probe.turnId === turnId);
  }

  function recordInterruption(threadId, turnId) {
    const key = JSON.stringify([threadId, turnId]);
    interruptedTurns.set(key, interruptedTurns.get(key) || "control_reconfiguration");
  }

  // A thread whose control recovery failed publishes every event its unverified probe held back.
  function abandonControlProbe(threadId) {
    const probe = threadControlProbes.get(threadId);
    if (probe && !probe.verified) {
      threadControlProbes.delete(threadId);
      for (const pending of probe.pending) provider.publishNotification(pending);
    }
  }

  /**
   * Tracks the native commands and control probes a notification reports, and says whether subscribers see it:
   * a verified control probe's events, and an unverified probe's held events, are not published.
   */
  function observeNotification(notification) {
    const threadId = notification.params?.threadId;
    const turnId = notification.params?.turnId;
    const item = notification.params?.item;
    if (item?.type === "commandExecution" && item.processId && item.source === "unifiedExecStartup") {
      const key = JSON.stringify([threadId, turnId, item.id]);
      if (notification.method === "item/completed") {
        const command = commandExecutions.get(key);
        if (command) command.completed = true;
        commandExecutions.delete(key);
      } else if (notification.method === "item/started") {
        const command = commandExecutions.get(key) || {
          threadId, turnId, itemId: item.id, processId: item.processId, client: provider.client
        };
        commandExecutions.set(key, command);
        // Native startup may finish after turn/interrupt has already returned.
        if (interruptedTurns.has(JSON.stringify([threadId, turnId]))) {
          void stopCommandExecution(command).catch(() => null);
        }
      }
    }
    const probe = threadControlProbes.get(threadId);
    const method = notification.method;
    if (probe && (/^(turn|item)\//u.test(method) || method === "thread/status/changed")) {
      const turnId = notification.params?.turnId || notification.params?.turn?.id;
      if (method === "turn/started" && probe.turnId && probe.turnId !== turnId) {
        threadControlProbes.delete(threadId);
      } else if (probe.verified) {
        if (turnId === probe.turnId) {
          if (method === "item/completed" && notification.params.item?.id === probe.itemId) {
            probe.result = notification.params.item;
          }
          if (method === "turn/completed") probe.completed = true;
        }
        return false;
      } else {
        if (method === "turn/started") probe.turnId = turnId;
        probe.pending.push(notification);
        if (method === "item/started" || probe.pending.length >= 32) {
          const item = notification.params?.item;
          if (item?.type === "commandExecution" && item.command?.includes(probe.marker)) {
            probe.verified = true;
            probe.itemId = item.id;
            probe.pending = [];
          } else {
            // A concurrent native user turn must retain every event. Only a
            // positively identified control probe may be hidden from chat.
            threadControlProbes.delete(threadId);
            for (const pending of probe.pending) provider.publishNotification(pending);
          }
        }
        return false;
      }
    }
    return true;
  }

  async function stopThreadForObservationLoss(threadId, turnId) {
    // Control uses only this open socket. It must not spawn or resume work
    // to find out whether the work we lost sight of has stopped.
    const client = provider.client;
    if (!client?.isOpen()) throw new Error("Codex control connection is unavailable.");
    if (commandStopFailure) throw commandStopFailure;
    const signal = AbortSignal.timeout(5_000);
    const request = (method, params) => client.request(method, params, { signal });
    let { goal } = await request("thread/goal/get", { threadId });
    if (goal?.status === "active") {
      const result = await request("thread/goal/set", { threadId, status: "paused" });
      if (result.goal?.status !== "paused" || result.goal?.createdAt !== goal.createdAt || result.goal?.objective !== goal.objective) {
        throw new Error("Codex did not confirm that the same goal was paused.");
      }
      goal = result.goal;
    }
    const readStatus = async () => {
      const { thread } = await request("thread/read", { threadId, includeTurns: false });
      return typeof thread?.status === "string" ? thread.status : thread?.status?.type;
    };
    if (!["idle", "notLoaded"].includes(await readStatus())) {
      if (!turnId) {
        const page = await request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "summary" });
        turnId = page.data?.[0]?.id;
      }
      if (!turnId) throw new Error("Codex's running turn could not be identified.");
      await interruptNativeTurn(client, threadId, turnId, signal);
      if (await readStatus() !== "idle") throw new Error("Codex did not confirm that its turn stopped.");
    }
    return { goal };
  }

  function clear() {
    threadControlProbes.clear();
    commandExecutions.clear();
    interruptedTurns.clear();
  }

  return Object.freeze({
    sendTurn,
    steerTurn,
    interruptionOutcome,
    interruptTurn,
    nativeCliResumeCommand,
    verifyThreadEnvironment,
    isControlProbeTurn,
    recordInterruption,
    abandonControlProbe,
    observeNotification,
    stopThreadForObservationLoss,
    clear
  });
}
