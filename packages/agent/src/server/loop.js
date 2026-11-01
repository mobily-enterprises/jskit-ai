import { generateText, stepCountIs, streamText } from "ai";
import { LOOP_OUTPUT_TOKENS, MODEL_RETRIES, REASONING, generateOnce } from "./model.js";
import { TURN_LIMITS, summaryNote, trimOldResults } from "./context.js";
import { sameGist, stripNotes } from "./text.js";
import { modelTools } from "./tool.js";

// How long one reply may run before it stops and reports (AGENT_REPLY_MINUTES, default 15).
export const REPLY_DEADLINE_MS = (Number(process.env.AGENT_REPLY_MINUTES) || 15) * 60 * 1000;

/**
 * The agent loop: call the model, run the tools it asks for, feed the results back, until it
 * answers without a tool call, runs out of steps or reaches its deadline. Every step reasons; old
 * tool results give way inside a long turn; each finished step can be saved. A reply always ends
 * with a message: one that stops early ends with the model's own account of where it got to.
 *
 * `history` is the conversation as model messages. The summary, the state note and any other
 * system messages in it go into the system prompt, after the instructions, in that order.
 * Returns { text, transcript, unfinished? }; `unfinished` (out of steps or time) means the job can
 * carry on from here. With `onText(text)` the reply streams: each step's words so far, as they
 * come. `onStep(step)` hears each finished step. Aborting `signal` (the person pressed Stop, or a
 * tool's outcome is unknown) ends the run at once with the signal's reason, without an account.
 */
export async function runLoop({
  model, name, instructions, history, tools = {}, summary = "", state = "", maxSteps,
  onSteps = null, onStep = null, onText = null, signal = null, carriesOn = false, quietIfEmpty = false, clean = stripNotes,
  reasoning = REASONING.on, maxOutputTokens = LOOP_OUTPUT_TOKENS, turnLimits = TURN_LIMITS, deadlineMs = REPLY_DEADLINE_MS
}) {
  const messages = [...history];
  // A transcript cut mid-way must not start with a tool result.
  while (messages.length && messages[0].role === "tool") messages.shift();
  if (summary) messages.unshift({ role: "system", content: summaryNote(summary) });
  if (state) messages.splice(Math.max(0, messages.length - 1), 0, { role: "system", content: state });
  const system = [instructions, ...messages.filter((message) => message.role === "system").map((message) => message.content)];
  const conversation = messages.filter((message) => message.role !== "system");

  // Each step reports only its own messages; the run's transcript is all of them, in order.
  const done = [];
  const generated = [];
  const left = new Set();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  let result = null;
  let stopped = "";
  try {
    const call = {
      model,
      instructions: systemPrompt(model, system),
      messages: conversation,
      tools: modelTools(tools),
      stopWhen: stepCountIs(maxSteps),
      providerOptions: reasoning,
      maxOutputTokens,
      maxRetries: MODEL_RETRIES,
      abortSignal: signal ? AbortSignal.any([deadline.signal, signal]) : deadline.signal,
      prepareStep: ({ messages: current }) => {
        const trimmed = trimOldResults(current, left, turnLimits);
        return trimmed === current ? {} : { messages: trimmed };
      },
      onStepFinish: async (step) => {
        done.push(step);
        generated.push(...(step.response?.messages || []));
        if (onStep) await onStep(step);
        if (onSteps) await onSteps(cleanTranscript(generated)).catch((error) => console.error(`Saving ${name}'s steps: ${error?.message || error}`));
      }
    };
    result = onText ? await streamed(call, onText) : await generateText(call);
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    stopped = deadline.signal.aborted ? "it was taking too long" : "something went wrong on my side";
    console.error(`${name}'s reply stopped: ${error?.message || error}`);
  } finally {
    clearTimeout(timer);
  }
  const transcript = result ? cleanTranscript(generated) : [];
  let text = result ? clean(replyText(transcript) || result.text) : "";
  const outOfSteps = result && (result.finishReason === "tool-calls" || done.length >= maxSteps);
  if (outOfSteps) stopped = "I reached the most steps I take in one go";
  if (result && deadline.signal.aborted) stopped = "it was taking too long";
  const resumable = Boolean(outOfSteps || deadline.signal.aborted);
  // One that may only chime in (a group follow-up) may say nothing at all.
  if (stopped || (!text && !quietIfEmpty)) {
    const account = await sumUp({ model, name, conversation, steps: done, reason: stopped || "I didn't write anything at the end", carriesOn: carriesOn && resumable, clean });
    text = [text, account].filter(Boolean).join("\n\n");
    transcript.push({ role: "assistant", content: account });
  }
  return { text, transcript, ...(resumable ? { unfinished: stopped } : {}) };
}

/** A streamed run: each step's words go to `onText` as they come; the result is read at the end. */
async function streamed(call, onText) {
  const stream = streamText({ ...call, onError: () => {} });
  let text = "";
  for await (const part of stream.fullStream) {
    if (part.type === "error") throw part.error;
    if (part.type === "start-step") text = "";
    if (part.type === "text-delta" && part.text) await onText((text += part.text));
  }
  return { finishReason: await stream.finishReason, text: await stream.text };
}

/**
 * The system prompt as each format takes it: one message in the OpenAI style, parts joined by a
 * blank line; separate blocks in the Anthropic format.
 */
function systemPrompt(model, parts) {
  const present = parts.filter(Boolean);
  return String(model.provider || "").startsWith("anthropic") ? present.map((content) => ({ role: "system", content })) : present.join("\n\n");
}

/**
 * A reply's stored transcript keeps its tool calls and results; reasoning and provider
 * bookkeeping are dropped.
 */
export function cleanTranscript(messages = []) {
  return messages.map((message) => ({
    role: message.role,
    content: Array.isArray(message.content)
      ? message.content.filter((part) => part.type !== "reasoning").map(({ providerOptions, ...part }) => part)
      : message.content
  }));
}

/**
 * The words of a reply: each step's text a paragraph, leaving out a step that repeats an earlier
 * one's opening, or says again in other words what a later one says (the later one is the answer).
 */
function replyText(transcript) {
  const opening = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 60);
  return transcript
    .filter((message) => message.role === "assistant")
    .flatMap((message) => (Array.isArray(message.content) ? message.content.filter((part) => part.type === "text").map((part) => part.text) : [message.content]))
    .map((text) => String(text || "").trim())
    .filter(Boolean)
    .filter((text, index, all) => all.findIndex((other) => opening(other) === opening(text)) === index)
    .filter((text, index, all) => !all.slice(index + 1).some((later) => sameGist(text, later)))
    .join("\n\n");
}

/** What the steps did, briefly, for the account of a reply that stopped early. */
function stepLog(steps) {
  const brief = (value) => {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  };
  return steps.slice(-20).flatMap((step) => [
    ...(step.toolCalls || []).map((call) => `- called ${call.toolName}(${brief(call.input ?? call.args)})`),
    ...(step.toolResults || []).map((answer) => `  → ${brief(answer.output ?? answer.result)}`),
    ...(String(step.text || "").trim() ? [`- said: ${brief(step.text)}`] : [])
  ]).join("\n") || "(no steps finished)";
}

async function sumUp({ model, name, conversation, steps, reason, carriesOn, clean }) {
  const asked = [...conversation].reverse().find((message) => message.role === "user");
  try {
    const text = clean(await generateOnce({
      model,
      system: [
        `You are ${name}, a personal assistant bot. You were working on the person's request but stopped early because ${reason}.`,
        carriesOn
          ? "Write one short chat message: what you did, where things stand now, and what's left, which you're carrying on with by yourself in the background now (they don't need to do anything)."
          : "Write one short chat message: what you did, where things stand now, what's left, and that they can ask you to carry on.",
        "Only mention what the log shows actually happened. Never claim a step the log doesn't show, and never ask for passwords."
      ].join("\n"),
      messages: [{ role: "user", content: `The request: ${typeof asked?.content === "string" ? asked.content.slice(0, 1500) : "(see the log)"}\n\nWhat happened:\n${stepLog(steps)}` }]
    }));
    if (text) return text;
  } catch {
    // The plain account below still tells the person.
  }
  return carriesOn
    ? `I paused because ${reason}, and I'm carrying on from where things are by myself now.`
    : `I stopped before finishing, because ${reason}. Ask me to carry on and I'll pick it up from where things are.`;
}
