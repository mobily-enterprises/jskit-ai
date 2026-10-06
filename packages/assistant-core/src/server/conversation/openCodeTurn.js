import { setTimeout as delay } from "node:timers/promises";
import { openCodeAssistantMessageText as assistantMessageText } from "./openCodeClient.js";

const text = value => String(value ?? "").trim();
export const OPENCODE_INTERRUPT_TIMEOUT_MS = 5_000;
const OPENCODE_EVENT_READY_TIMEOUT_MS = 120_000;

export function openCodeDetachedPrompt(input = {}) {
  const prompt = text(input.prompt || input.message);
  if (!input.outputSchema) {
    return prompt;
  }
  return [
    prompt,
    "",
    "Return only one JSON value matching this JSON Schema. Do not wrap it in Markdown code fences:",
    JSON.stringify(input.outputSchema)
  ].join("\n");
}

export function openCodeStructuredOutput(value = "") {
  const original = String(value ?? "");
  const match = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/iu.exec(original.trim());
  return match ? match[1].trim() : original;
}


function record(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function openCodeEventSummary(event = {}) {
  const payload = record(event.data);
  const properties = record(payload.properties);
  const data = Object.keys(properties).length ? properties : record(payload.data);
  const info = record(data.info);
  const part = record(data.part);
  const model = record(info.model || data.model);
  return {
    agent: text(info.agent || data.agent),
    at: Number(data.timestamp || part.time?.start || part.time?.created) || Date.now(),
    eventId: text(event.id || payload.id || part.id),
    messageId: text(part.messageID || data.messageID || info.id),
    modelId: text(model.id || model.modelID || info.modelID),
    modelProviderId: text(model.providerID || info.providerID),
    partId: text(part.id || data.partID),
    ...(part.type === "text" && typeof part.text === "string" ? { textSnapshot: part.text } : {}),
    ...(payload.type === "message.part.delta" && data.field === "text" && typeof data.delta === "string"
      ? { textDelta: data.delta } : {}),
    partType: text(part.type) || (
      text(payload.type) === "session.next.reasoning.ended"
        ? "reasoning"
        : text(payload.type) === "session.next.text.ended"
          ? "text"
          : ""
    ),
    text: ["reasoning", "text"].includes(text(part.type))
      ? text(part.text || data.delta).slice(0, 32_000)
      : ["session.next.text.ended", "session.next.reasoning.ended"].includes(text(payload.type))
        ? text(data.text).slice(0, 32_000)
        : "",
    tool: text(part.tool || data.tool),
    type: text(payload.type || event.event)
  };
}

async function consumeOpenCodeEvents(client, conversationId, {
  eventStartedAt = null, onEvent = null, onError = null, onReady = null,
  readError = openCodeMessageError, signal
} = {}) {
  for await (const event of client.events(conversationId, { onReady, signal })) {
    signal?.throwIfAborted();
    const summary = openCodeEventSummary(event);
    const current = eventStartedAt === null || Number(summary.at) >= Number(eventStartedAt);
    if (
      current && summary.type === "session.error" &&
      text(event.data?.properties?.sessionID) === conversationId &&
      typeof onError === "function"
    ) {
      const failure = record(event.data?.properties?.error);
      onError(Object.assign(new Error(readError({ error: failure }) || "OpenCode turn failed."), {
        name: text(failure.name) || "Error"
      }));
    }
    if (summary.type && current && typeof onEvent === "function") {
      await onEvent(summary, event);
    }
  }
  const error = new Error("OpenCode's event connection ended before observation was closed.");
  error.code = "assistant_opencode_observation_lost";
  error.details = {};
  error.statusCode = 503;
  throw error;
}

export function observeOpenCodeEvents(client, conversationId, {
  abortController, signal = abortController.signal, ...options
} = {}) {
  const eventAbort = new AbortController();
  const eventReady = Promise.withResolvers();
  eventReady.promise.catch(() => {});
  let eventFailure = null;
  const events = consumeOpenCodeEvents(client, conversationId, {
    ...options,
    onError: error => { eventFailure = error; },
    onReady: eventReady.resolve,
    signal: AbortSignal.any([signal, eventAbort.signal])
  }).catch(error => {
    eventReady.reject(error);
    if (!eventAbort.signal.aborted && !signal.aborted) {
      eventFailure = error;
      abortController.abort(error);
    }
  });
  return {
    completion: events,
    readFailure: () => eventFailure,
    waitUntilReady({ timeoutMs = OPENCODE_EVENT_READY_TIMEOUT_MS, timeoutError } = {}) {
      const timeout = setTimeout(() => eventReady.reject(timeoutError || Object.assign(
        new Error("OpenCode's event connection did not become ready."),
        { code: "assistant_opencode_events_timeout", details: {}, statusCode: 504 }
      )), timeoutMs);
      void eventReady.promise.then(() => clearTimeout(timeout), () => clearTimeout(timeout));
      return eventReady.promise;
    },
    async close() {
      eventAbort.abort();
      await events;
    }
  };
}

export function openCodeMessageError(message = {}) {
  return text(message?.error?.message || message?.error?.data?.message || message?.error?.name || message?.error);
}

export async function inspectOpenCodeMessageAdmission(client, conversationId, inputMessageId, {
  signal = AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
} = {}) {
  try {
    // Do not create a missing native session or submit another prompt. Absence
    // from bounded history is uncertainty, not proof of non-admission.
    const messages = await client.messages(conversationId, { limit: 100, order: "desc" }, { signal });
    const accepted = openCodeMessageRows(messages).some((message) =>
      message.type === "user" && text(message.id) === inputMessageId);
    return { accepted, messages };
  } catch {
    return null;
  }
}

export async function steerOpenCodeTurn(client, conversationId, turn, input, { signal } = {}) {
  const previousMessageId = turn.inputMessageId;
  // The existing observer follows the latest admitted prompt in this conversation.
  turn.inputMessageId = input.id;
  try {
    return await client.prompt(conversationId, {
      ...input,
      delivery: "steer",
      resume: true
    }, { signal });
  } catch (error) {
    turn.inputMessageId = previousMessageId;
    throw error;
  }
}

export async function dispatchOpenCodeTurn(client, conversationId, turn, input, options = {}) {
  const { events, beforeDispatch, readiness, promptTimeoutMs } = options;
  turn.promptAttempted = false;
  if (events) await events.waitUntilReady(readiness);
  const signal = options.signal;
  signal.throwIfAborted();
  await beforeDispatch?.();
  if (options.authorizeAttachments) {
    signal.throwIfAborted();
    if (input.attachments?.length) {
      await (options.client ?? client).allowConversationAttachments(options.conversationId ?? conversationId, input.attachments);
    }
    signal.throwIfAborted();
  }
  turn.promptAttempted = true;
  turn.mayBeRunning = true;
  return (options.client ?? client).prompt(options.conversationId ?? conversationId, {
    ...input,
    delivery: input.delivery === "steer" ? "steer" : "queue",
    resume: true
  }, { signal: promptTimeoutMs ? AbortSignal.any([signal, AbortSignal.timeout(promptTimeoutMs)]) : signal });
}

// Native automatic compaction and its continuation belong to the admitted turn.
export function openCodeMessageRows(value = null) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
  return rows
    .map((message, index) => ({ index, message }))
    .sort((left, right) => (
      (Number(left.message?.time?.created) || 0) - (Number(right.message?.time?.created) || 0) ||
      left.index - right.index
    ))
    .map(({ message }) => message);
}

export function openCodePersistentConversationMessages(rows, conversationMessageId) {
  return rows.filter((row) => row.type === "assistant").flatMap((row) => {
    const complete = Boolean(row.time?.completed || row.finish || row.error);
    const reasoning = (row.content || []).filter((part) => part.type === "reasoning" && text(part.text))
      .map((part, index) => ({ id: conversationMessageId(row.id, part.id || index, "reasoning"), role: "thinking", text: part.text, complete }));
    const answer = assistantMessageText(row);
    return [...reasoning, ...(answer ? [{ id: conversationMessageId(row.id, "assistant"), role: "assistant", text: answer, complete }] : [])];
  });
}

export async function projectOpenCodeConversationMessages(messages, expectedId, {
  maximumOutput, outputSchema, previous, onMessage
}) {
  for (const message of openCodeRowsForInput(messages, expectedId)) {
    if (message.type !== "assistant" || message.summary || message.error) continue;
    const text = assistantMessageText(message);
    const thinking = (message.content || []).filter(part => part.type === "reasoning").map(part => part.text || "").join("\n\n");
    if (text.length > maximumOutput || thinking.length > 4 * 1024 * 1024) throw new Error("OpenCode output exceeded the configured limit.");
    const complete = Boolean(message.time?.completed || message.finish);
    const progress = message.finish === "tool-calls" || (message.content || []).some(part => part.type === "tool");
    const answer = outputSchema && complete && !progress ? openCodeStructuredOutput(text) : text;
    for (const [role, value] of [["thinking", thinking], ["assistant", answer]]) {
      const key = `${message.id}:${role}`;
      if (value && (previous.get(key)?.text !== value || previous.get(key)?.complete !== complete)) {
        const item = { id: key, outputId: key, role: role === "assistant" && progress ? "commentary" : role, text: value, complete };
        await onMessage(item);
        previous.set(key, item);
      }
    }
  }
  const result = openCodeLastAssistantResult(openCodeRowsForInput(messages, expectedId));
  return { failure: result.error, providerApiFailure: text(result.message?.error?.name) === "APIError" };
}

export function openCodeRowsForInput(value = null, inputMessageId = "") {
  const rows = openCodeMessageRows(value);
  const index = rows.findIndex((message) => text(message?.id) === text(inputMessageId));
  if (index < 0) {
    return [];
  }
  const turnRows = [];
  let compactionFollowup = false;
  for (const message of rows.slice(index + 1)) {
    if (message?.type === "user") {
      if (message.content?.some((part) => part.type === "compaction" && part.auto === true)) {
        compactionFollowup = true;
      } else {
        // Native automatic compaction emits one continuation or replays the
        // original prompt. Both remain part of this already admitted request.
        if (!compactionFollowup) break;
        compactionFollowup = false;
      }
    }
    turnRows.push(message);
  }
  return turnRows;
}

function openCodeMessageResultForInput(value = null, inputMessageId = "", { readError = openCodeMessageError } = {}) {
  const rows = openCodeRowsForInput(value, inputMessageId);
  if (!rows.length && !openCodeMessageRows(value).some((message) => (
    text(message?.id) === text(inputMessageId)
  ))) {
    return null;
  }
  if (rows.at(-1)?.type !== "assistant") {
    return { admitted: true, complete: false, error: "", text: "", turnId: "" };
  }
  const result = openCodeLastAssistantResult(rows, { readError });
  return {
    admitted: true,
    complete: Boolean(result.error || (!result.message?.summary &&
      (result.message?.time?.completed || result.message?.finish))),
    error: result.error,
    text: result.text,
    turnId: text(result.message?.id)
  };
}

export function openCodeLastAssistantResult(value = null, { readError = openCodeMessageError } = {}) {
  const message = [...openCodeMessageRows(value)]
    .reverse()
    .find((candidate) => candidate?.type === "assistant");
  return {
    error: readError(message),
    message,
    text: message?.summary ? "" : assistantMessageText(message)
  };
}

function latestOpenCodeMessageResult(value, readError) {
  const result = openCodeLastAssistantResult(value, { readError });
  if (!result.message) {
    return null;
  }
  return {
    admitted: true,
    complete: Boolean(result.error || (!result.message.summary &&
      (result.message.time?.completed || result.message.finish))),
    error: result.error,
    text: result.text,
    turnId: text(result.message.id)
  };
}

export async function waitForOpenCodeMessages(client, conversationId = "", inputMessageId = "", {
  onMessages = null,
  readFailure = () => null,
  readError = openCodeMessageError,
  signal
} = {}) {
  const resolveInputMessageId = typeof inputMessageId === "function"
    ? inputMessageId
    : () => text(inputMessageId);
  let completedInputMessageId = null;
  while (true) {
    signal?.throwIfAborted();
    const expectedInputMessageId = text(resolveInputMessageId());
    const messages = await client.messages(conversationId, {
      limit: 100,
      order: "desc"
    }, { signal });
    signal?.throwIfAborted();
    if (expectedInputMessageId !== text(resolveInputMessageId())) continue;
    if (typeof onMessages === "function") {
      await onMessages(messages, expectedInputMessageId);
    }
    if (expectedInputMessageId !== text(resolveInputMessageId())) continue;
    const result = expectedInputMessageId
      ? openCodeMessageResultForInput(messages, expectedInputMessageId, { readError })
      : latestOpenCodeMessageResult(messages, readError);
    const failure = readFailure();
    if (failure && (await client.sessionStatus(conversationId, { signal })).type === "idle") {
      throw failure;
    }
    // An assistant message can finish with tool calls while the native turn
    // continues. Only an idle session acknowledges the final answer.
    if (result?.complete && (await client.sessionStatus(conversationId, { signal })).type === "idle" &&
        expectedInputMessageId === text(resolveInputMessageId())) {
      if (completedInputMessageId === expectedInputMessageId) {
        return { messages, result };
      }
      completedInputMessageId = expectedInputMessageId;
    } else {
      completedInputMessageId = null;
    }
    await delay(250, undefined, { signal });
  }
}

export async function waitForOpenCodeFinalResponse(client, conversationId, turn, {
  agent, model, recoveryMessageId, beforeRecovery = null, ...options
} = {}) {
  const waitForCompletion = () => waitForOpenCodeMessages(
    client, conversationId, () => turn.inputMessageId, options
  );
  let completion = await waitForCompletion();
  // Work around https://github.com/anomalyco/opencode/issues/37073. Some
  // reasoning models finish successfully without emitting a text part.
  if (
    !turn.interruptRequested &&
    !completion.result?.error &&
    !text(completion.result?.text)
  ) {
    await beforeRecovery?.(completion);
    const admitted = await client.prompt(conversationId, {
      agent,
      delivery: "queue",
      id: recoveryMessageId,
      model,
      prompt: {
        text: "Your previous response ended without a user-facing final answer. Do not call tools or repeat your reasoning. Return the concise final answer to the user's latest request now."
      },
      resume: true
    }, { signal: options.signal });
    turn.inputMessageId = text(admitted?.id) || recoveryMessageId;
    turn.updatedAt = new Date().toISOString();
    completion = await waitForCompletion();
  }
  return completion;
}

// Production detached-turn lifetime. Applications project the completed native
// result before observation is closed, then publish/checkpoint their own state.
export async function observeOpenCodeTurnCompletion(runtime, target, conversationId, turn, {
  events, signal, timeoutMs, finalResponse, projectResult = value => value, afterClose, ...waitOptions
} = {}) {
  const turnAbort = turn.abortController;
  let stopped = true;
  let outcome = "completed";
  try {
    const options = { ...waitOptions, signal: AbortSignal.any([
      signal, ...(timeoutMs ? [AbortSignal.timeout(timeoutMs)] : [])
    ]) };
    const completion = finalResponse
      ? await waitForOpenCodeFinalResponse(target.server.client, conversationId, turn, { ...finalResponse, ...options })
      : await waitForOpenCodeMessages(target.server.client, conversationId, () => turn.inputMessageId, options);
    return await projectResult(completion);
  } catch (error) {
    const failure = signal.aborted ? signal.reason : error;
    outcome = turn.interrupted ? "interrupted" : "failed";
    if (turn.interrupted) return { interrupted: true };
    if (!target.abortController.signal.aborted) {
      try {
        await runtime.stopUnobservedSession(target, conversationId);
      } catch (stopError) {
        stopped = false;
        throw Object.assign(new Error(`${failure.message} ${stopError.message}`, { cause: failure }), { cleanupFailed: true });
      }
    }
    throw failure;
  } finally {
    await events.close();
    if (turn.abortController === turnAbort) {
      turn.active = !stopped;
      turn.mayBeRunning = !stopped;
    }
    await afterClose?.({ stopped, outcome });
  }
}

// Production native receipt/wait sequence used for an idempotent bounded turn.
// The host supplies its approved input and keeps its renewal presentation.
export async function runOpenCodeConversationTurn(client, conversationId, input = {}, {
  expectedThreadId = "", forbiddenThreadId = "", requireFreshHistory = false,
  completeResult, close
} = {}) {
  const { inputMessageId, readError,
    createError = (reason, message, details) => Object.assign(new Error(message ||
      (reason === "unreadable" ? "The exact OpenCode turn did not produce a readable result." : "OpenCode did not finish the turn.")),
      { code: `assistant_opencode_turn_${reason}`, details,
        statusCode: ["thread_mismatch", "fresh_thread_required", "unrelated_history"].includes(reason) ? 409 : 502 })
  } = input;
  if (
    (expectedThreadId && expectedThreadId !== conversationId) ||
    (requireFreshHistory && forbiddenThreadId && forbiddenThreadId === conversationId)
  ) {
    throw createError(
      requireFreshHistory ? "fresh_thread_required" : "thread_mismatch",
      requireFreshHistory
        ? "The renewed OpenCode conversation does not own the expected fresh native history."
        : "The OpenCode predecessor history changed before handover generation.",
      { actualThreadId: conversationId, expectedThreadId, ...(requireFreshHistory ? { forbiddenThreadId } : {}) }
    );
  }
  let existingMessages;
  if (requireFreshHistory) {
    existingMessages = openCodeMessageRows(await client.messages(
      conversationId,
      { limit: 100, order: "desc" }
    ));
    const unrelatedUserMessage = existingMessages.find((message) => (
      message?.type === "user" && text(message.id) !== inputMessageId
    ));
    if (unrelatedUserMessage) {
      throw createError(
        "unrelated_history",
        "The successor OpenCode history contains unrelated conversation and cannot be used for renewal.",
        { threadId: conversationId }
      );
    }
  }
  // Hosts may build the approved prompt lazily, after the original identity and
  // freshness checks. The bounded turn keeps its separate receipt-history read.
  const { prompt, agent, model, timeoutMs = 180_000 } = input;
  let messages = await client.messages(conversationId, {
    limit: 100,
    order: "desc"
  });
  let result = openCodeMessageResultForInput(messages, inputMessageId, { readError });
  let admitted = null;
  if (!result) {
    admitted = await client.prompt(conversationId, {
      agent,
      delivery: "queue",
      id: inputMessageId,
      model,
      prompt: { text: String(prompt || "") },
      resume: true
    });
  }
  if (!result?.complete) {
    try {
      const completion = await waitForOpenCodeMessages(
        client,
        conversationId,
        inputMessageId,
        {
          readError, signal: AbortSignal.timeout(timeoutMs)
        }
      );
      messages = completion.messages;
      result = completion.result;
    } catch (error) {
      let inputAccepted = Boolean(result);
      if (!inputAccepted && admitted) {
        try {
          inputAccepted = Boolean(openCodeMessageResultForInput(
            await client.messages(conversationId, {
              limit: 100,
              order: "desc"
            }),
            inputMessageId, { readError }
          ));
        } catch {
          // The exact provider history remains the admission proof. If it
          // cannot be read, renewal must leave the predecessor available.
        }
      }
      throw createError(
        "failed",
        text(error?.message),
        {
          inputAccepted,
          threadId: conversationId
        }
      );
    }
  }
  if (!result?.complete || (!result.text && !result.error)) {
    throw createError(
      "unreadable",
      "",
      {
        inputAccepted: true,
        threadId: conversationId
      }
    );
  }
  if (result.error) {
    throw createError(
      "failed",
      result.error,
      {
        inputAccepted: true,
        threadId: conversationId,
        turnId: result.turnId
      }
    );
  }
  const completion = {
    admitted,
    reconciled: !admitted,
    text: result.text,
    threadId: conversationId,
    turnId: result.turnId || text(admitted?.id)
  };
  if (completeResult) await completeResult(completion);
  const proof = close ? await close() : undefined;
  return {
    ...completion,
    ...(requireFreshHistory ? { freshThread: existingMessages.length === 0 } : {}),
    ...(close ? { processExitProof: proof } : {})
  };
}
