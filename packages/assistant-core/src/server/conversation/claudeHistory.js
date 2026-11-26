import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { readClaudeJsonFrames } from "./claudeClient.js";
import { createNativeHistoryExport, retireNativeConversation } from "./nativeHistoryExport.js";

const UUID_PATTERN = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const TRANSCRIPT_PATH_PATTERN = /\.jsonl(?:\.(?:superseded|orphaned)-.*)?$/u;

function requireClaudeSessionId(id) {
  if (!UUID_PATTERN.test(id)) throw new TypeError("Invalid Claude conversation id.");
  return id;
}

// The UUID Claude's history records for an application message id.
export function claudeNativeMessageId(id) {
  const value = createHash("sha256").update(String(id)).digest("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

// Claude's project directory name for a canonical working directory.
function claudeProjectDirectoryName(canonical) {
  return canonical.normalize("NFC").replace(/[^a-zA-Z0-9]/gu, "-");
}

// Text the person authored in a user frame: plain content or its text blocks.
function claudeUserText(content) {
  return typeof content === "string" ? content : (Array.isArray(content) ? content : [])
    .filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n\n");
}

// A message the person or the host sent, a native /goal command among them.
// Claude's own notes, compaction summary and interrupt marker are not.
function claudeAuthoredMessage(frame) {
  if (frame.type !== "user" || frame.isMeta || frame.isCompactSummary || frame.parent_tool_use_id) return false;
  const text = claudeUserText(frame.message?.content);
  return Boolean(text) && !/^\[Request interrupted by user/u.test(text);
}

// Native /goal saves its sentinel, then the authored command naming that
// sentinel as its parent. Claude re-attaches an unfinished goal with a
// sentinel after compacting its context, and no command follows that one.
const GOAL_COMMAND_PATTERN = /^\s*(?:<command-name>\/goal<\/command-name>|\/goal(?:\s|$))/u;

async function archivedClaudeProjectDirectory(workdir) {
  const canonical = await realpath(workdir).catch((error) => {
    if (error.code === "ENOENT") return workdir;
    throw error;
  });
  return claudeProjectDirectoryName(canonical);
}

function matchingClaudeProjectDirectories(names, directory) {
  return names.filter((name) => directory.length <= 200
    ? name === directory
    : name.startsWith(`${directory.slice(0, 200)}-`));
}

export async function listClaudeConversationStorage({ configRoot, binding }) {
  if (!path.isAbsolute(configRoot) || !path.isAbsolute(binding.workdir || "")) throw new TypeError("Claude inventory requires absolute directories.");
  const directory = await archivedClaudeProjectDirectory(binding.workdir);
  const projects = path.join(configRoot, "projects");
  const names = await readdir(projects).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  const candidates = matchingClaudeProjectDirectories(names, directory);
  if (names.length > 10000 || candidates.length > 1) throw new Error("Claude project inventory is ambiguous or exceeds its limit.");
  const ids = new Set();
  for (const name of candidates) {
    const entries = await readdir(path.join(projects, name), { withFileTypes: true });
    if (entries.length > 10000) throw new Error("Claude conversation inventory exceeds its limit.");
    for (const entry of entries) {
      const id = entry.name.replace(TRANSCRIPT_PATH_PATTERN, "");
      if (UUID_PATTERN.test(id) && entry.isFile()) ids.add(id);
    }
  }
  return [...ids].sort().map((conversationId) => ({ ...binding, conversationId }));
}

// Claude's SDK documents this layout. Only the requested native conversation is
// read; authentication files are never opened. Long paths use the CLI's prefix
// lookup because its native and Node builds use different hash suffixes.
async function claudeHistoryPath({ configRoot, workdir, conversationId }) {
  requireClaudeSessionId(conversationId);
  const directory = claudeProjectDirectoryName(await realpath(workdir));
  const projects = path.join(configRoot, "projects");
  const candidates = directory.length <= 200 ? [directory] : matchingClaudeProjectDirectories(
    await readdir(projects).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    }), directory);
  for (const name of candidates) {
    const candidate = path.join(projects, name, `${conversationId}.jsonl`);
    const info = await stat(candidate).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info?.isFile()) return { path: candidate, size: info.size, dev: info.dev, ino: info.ino };
  }
  return null;
}

// Claude saves this non-error synthetic carrier when it starts again after an
// interrupted request: a stopped request, or a process that ended mid-turn. Its
// native placeholder classifier uses this exact provenance; real model replies
// and API errors with the same wording remain ordinary output.
function claudeNoResponsePlaceholder(frame) {
  const content = frame.message?.content;
  return frame.type === "assistant" && frame.message?.model === "<synthetic>" && !frame.isApiErrorMessage &&
    Array.isArray(content) && content.length === 1 && content[0]?.type === "text" && content[0].text === "No response requested.";
}

function claudeMessageBlocks(frame, { includeNested = false, commentary = false } = {}) {
  if (frame.type !== "assistant" || frame.parent_tool_use_id && !includeNested) return [];
  const content = frame.message?.content;
  if (!Array.isArray(content) || claudeNoResponsePlaceholder(frame)) return [];
  // Native frames split one API message into blocks with distinct UUIDs.
  const messageId = frame.uuid || frame.message.id;
  if (!messageId) return [];
  const command = frame.local_command_run?.command;
  const output = /^<local-command-(stdout|stderr)>/u.exec(frame.local_command_source || "")?.[1];
  commentary ||= content.some((block) => block.type === "tool_use");
  return content.flatMap((block, index) => {
    const text = block.type === "thinking" ? block.thinking : block.type === "text" ? block.text : "";
    return typeof text === "string" && text.trim() ? [{
      id: `claude_${messageId}_${index}`, text, complete: true,
      role: block.type === "thinking" ? "thinking" : commentary ? "commentary" : "assistant",
      ...(typeof command === "string" && command && output ? {
        data: { native: { engineId: "claude", type: "assistant", command, output } }
      } : {})
    }] : [];
  });
}

// Claude appends to its native history. Live reads keep the parsed complete
// frames and parse only bytes appended since the previous read. A replaced,
// truncated or rewritten file is parsed again from the start. A live
// conversation keeps its own history state (claudeTurn's entry owns it), so
// reading other conversations never evicts it; other reads share a small cache.
const HISTORY_CACHE_LIMIT = 8;
const OWNED_HISTORY_IDLE_MS = 10 * 60_000;
const HISTORY_CHECK_BYTES = 256;
const historyCache = new Map();

/** An empty history state for one conversation's reader to own (readClaudeHistory's `history`). */
export function createClaudeHistoryState() {
  return { path: "", value: null, reading: null, projection: null };
}

/**
 * The history state a live conversation keeps while it is in use, on its own entry and never saved with it. Ten minutes
 * after its last read, unless a turn is in flight (busy), it lets the state go: an idle session holds none of its
 * transcript (about a sixth of the file's size, held on every open conversation's entry), and its next read parses the
 * file again from its start, about 2 s for 350 MB.
 * @param {object} owner the conversation's entry
 * @param {{ busy?: () => boolean }} [use]
 */
export function ownClaudeHistory(owner, { busy = () => false } = {}) {
  if (!owner.nativeHistory) Object.defineProperty(owner, "nativeHistory", { value: { state: null, idle: null } });
  const held = owner.nativeHistory;
  held.state ??= createClaudeHistoryState();
  const release = () => {
    if (!busy()) return Object.assign(held, { state: null, idle: null });
    held.idle = setTimeout(release, OWNED_HISTORY_IDLE_MS);
    held.idle.unref();
  };
  clearTimeout(held.idle);
  held.idle = setTimeout(release, OWNED_HISTORY_IDLE_MS);
  held.idle.unref();
  return held.state;
}

// Retain only the fields the history projection reads. Tool results, tool
// inputs and thinking signatures can be large and are never part of it.
function retainedClaudeBlock(block) {
  if (block?.type === "thinking") return { type: "thinking", thinking: block.thinking };
  if (block?.type === "text") return { type: "text", text: block.text };
  if (block?.type === "tool_use" && block.name !== "StructuredOutput") {
    return { type: "tool_use", id: block.id, name: block.name,
      ...(block.input?.run_in_background === true ? { input: { run_in_background: true } } : {}) };
  }
  return block?.type === "tool_use" ? block : { type: block?.type };
}

function retainedClaudeFrame(frame) {
  if (!["user", "assistant", "system", "attachment", "result", "last-prompt"].includes(frame.type)) {
    // Whether Claude queued input or took it in (see claudeTurnAnswered).
    return { type: frame.type, uuid: frame.uuid, parentUuid: frame.parentUuid,
      ...(frame.type === "queue-operation" ? { operation: frame.operation } : {}) };
  }
  const content = frame.message?.content;
  if (!Array.isArray(content) || !["user", "assistant"].includes(frame.type)) {
    if (frame.type !== "user" || frame.toolUseResult === undefined) return frame;
    const { toolUseResult: _result, ...retained } = frame;
    return retained;
  }
  // A tool call Claude runs in the background, and the task a tool result
  // moved there, are kept (see claudeTurnAnswered).
  const blocks = frame.type === "user"
    ? content.filter(block => block?.type === "text")
    : content.map(retainedClaudeBlock);
  const { toolUseResult: result, ...retained } = frame;
  const backgroundTaskId = result?.backgroundTaskId;
  const { id, role, model, stop_reason: stopReason } = frame.message;
  const message = frame.type === "user" ? { ...frame.message, content: blocks }
    : { id, role, model, ...(stopReason === undefined ? {} : { stop_reason: stopReason }), content: blocks };
  return { ...retained, message,
    ...(typeof backgroundTaskId === "string" && backgroundTaskId ? { toolUseResult: { backgroundTaskId } } : {}) };
}

// The state a read extends: the conversation's own, or the shared cache's for its file.
function historyState(file, own) {
  if (own) {
    if (own.path !== file.path) Object.assign(own, createClaudeHistoryState(), { path: file.path });
    return own;
  }
  const state = historyCache.get(file.path) || Object.assign(createClaudeHistoryState(), { path: file.path });
  historyCache.delete(file.path);
  historyCache.set(file.path, state);
  while (historyCache.size > HISTORY_CACHE_LIMIT) historyCache.delete(historyCache.keys().next().value);
  return state;
}

function claudeHistoryFrames(file, state) {
  // Reads of one file are serialized so each extends the same parsed prefix.
  const reading = Promise.resolve(state.reading).catch(() => {}).then(() => readClaudeHistoryFrames(file, state));
  state.reading = reading;
  return reading;
}

// The offset just after the last newline between start and size.
async function completeHistoryOffset(handle, start, size) {
  const block = Buffer.alloc(64 * 1024);
  for (let end = size; end > start;) {
    const from = Math.max(start, end - block.length);
    await handle.read(block, 0, end - from, from);
    const newline = block.subarray(0, end - from).lastIndexOf(10);
    if (newline !== -1) return from + newline + 1;
    end = from;
  }
  return start;
}

async function readClaudeHistoryFrames(file, state) {
  const cached = state.value;
  const handle = await open(file.path, "r");
  try {
    let reusable = cached && cached.dev === file.dev && cached.ino === file.ino && cached.offset <= file.size;
    if (reusable) {
      const check = Buffer.alloc(cached.check.length);
      await handle.read(check, 0, check.length, cached.offset - check.length);
      reusable = check.equals(cached.check);
    }
    const start = reusable ? cached.offset : 0;
    // Only newline-terminated frames are complete; a writer may still be
    // writing the unfinished tail, which the next read parses.
    const offset = await completeHistoryOffset(handle, start, file.size);
    // A reused prefix is extended in place: its frames are never copied.
    const frames = reusable ? cached.frames : [];
    if (offset > start) {
      // Streamed, so a long conversation's history is never held whole in memory.
      for await (const frame of readClaudeJsonFrames(handle.createReadStream({ start, end: offset - 1, autoClose: false }))) {
        if (!frame.isSidechain) frames.push(retainedClaudeFrame(frame));
      }
    }
    const check = Buffer.alloc(Math.min(HISTORY_CHECK_BYTES, offset));
    await handle.read(check, 0, check.length, offset - check.length);
    state.value = { dev: file.dev, ino: file.ino, offset, check, frames };
    return state.value;
  } catch (error) {
    state.value = null;
    throw error;
  } finally {
    await handle.close();
  }
}

// The frames' indexes the projection reads before it folds them: by uuid, the
// goal sentinels a command names, the branch leaf, a rewind, and the messages
// with a tool call. Each only grows as frames are appended.
function emptyHistoryScan(frames) {
  return { frames, scanned: 0, byId: new Map(), positions: new Map(), commandedSentinels: new Set(),
    leafUuid: "", rewound: false, toolMessages: new Set() };
}

// Extends the scan over appended frames; answers whether one of them changes
// how a frame before `foldedUpTo` was folded.
function extendHistoryScan(scan, foldedUpTo, foldedMessageIds) {
  let changesFolded = false;
  for (; scan.scanned < scan.frames.length; scan.scanned++) {
    const frame = scan.frames[scan.scanned];
    if (frame.uuid) {
      scan.byId.set(frame.uuid, frame);
      if (!scan.positions.has(frame.uuid)) scan.positions.set(frame.uuid, scan.scanned);
    }
    if (claudeAuthoredMessage(frame) && frame.parentUuid &&
        GOAL_COMMAND_PATTERN.test(claudeUserText(frame.message?.content))) {
      scan.commandedSentinels.add(frame.parentUuid);
      changesFolded ||= (scan.positions.get(frame.parentUuid) ?? Infinity) < foldedUpTo;
    }
    if (["user", "assistant"].includes(frame.type) && frame.uuid) scan.leafUuid = frame.uuid;
    if (frame.type === "last-prompt" && frame.leafUuid) {
      scan.leafUuid = frame.leafUuid;
      scan.rewound ||= frame.rewound === true;
    }
    if (frame.type === "assistant" && !frame.parent_tool_use_id && frame.message?.id &&
        frame.message.content?.some(block => block.type === "tool_use") && !scan.toolMessages.has(frame.message.id)) {
      scan.toolMessages.add(frame.message.id);
      changesFolded ||= foldedMessageIds.has(frame.message.id);
    }
  }
  return changesFolded;
}

// The projection's running state over the frames it folded, in file order.
function emptyHistoryFold() {
  return { messages: [], messageIndex: new Map(), messageIds: new Set(), userIds: [], userMessages: [],
    commandMessages: [], completedResults: [], failedResults: [], structuredOutputs: [],
    scalars: { lastUserId: "", lastUserStart: 0, goal: null, clearedGoal: null, goalStartId: "", goalCommandId: "", lastAt: NaN } };
}

const FOLD_LISTS = ["messages", "userIds", "userMessages", "commandMessages", "completedResults", "failedResults", "structuredOutputs"];

function copiedScalars(scalars) {
  return { ...scalars, goal: scalars.goal && { ...scalars.goal }, clearedGoal: scalars.clearedGoal && { ...scalars.clearedGoal } };
}

// The fold as it stood after a frame boundary, to continue from there.
function foldCheckpoint(fold, at) {
  return { at, lengths: Object.fromEntries(FOLD_LISTS.map((name) => [name, fold[name].length])),
    scalars: copiedScalars(fold.scalars), added: [] };
}

// Back to the checkpoint: frames after it are folded again by this read.
function rewindFold(fold, checkpoint) {
  for (const name of FOLD_LISTS) fold[name].length = checkpoint.lengths[name];
  for (const { messageId, apiMessageId } of checkpoint.added) {
    if (messageId) fold.messageIndex.delete(messageId);
    if (apiMessageId) fold.messageIds.delete(apiMessageId);
  }
  checkpoint.added = [];
  fold.scalars = copiedScalars(checkpoint.scalars);
}

class HistoryFoldConflict extends Error {}

/**
 * Folds one frame into the projection. Frames before a checkpoint are never
 * folded again; a frame that would change an earlier message's place throws
 * HistoryFoldConflict, and the read folds the whole history again.
 */
function foldHistoryFrame(fold, frame, scan, options, checkpoint) {
  const state = fold.scalars;
  // Claude saves its history as it works, so the time up to each frame it
  // saves itself is the goal's running time. The wait before a message the
  // person or the host sent (between turns, while paused, or across a
  // restart) is not, nor the wait before the placeholder Claude saves when it
  // starts again after an interrupted request: that spans a stopped server.
  const at = ["user", "assistant", "attachment", "system"].includes(frame.type) ? Date.parse(frame.timestamp) / 1000 : NaN;
  if (Number.isFinite(at)) {
    const waited = claudeAuthoredMessage(frame) || claudeNoResponsePlaceholder(frame) ||
      frame.type === "attachment" && scan.commandedSentinels.has(frame.uuid);
    if (state.goal?.status === "active" && !waited && at > state.lastAt) state.goal.timeUsedSeconds += at - state.lastAt;
    state.lastAt = Number.isFinite(state.lastAt) ? Math.max(state.lastAt, at) : at;
    if (state.goal?.status === "active") state.goal.updatedAt = state.lastAt;
  }
  // The exact native local-command receipt owns clear identity. Claude may
  // insert a caveat between the sentinel and authored command, or omit the
  // sentinel after an impossible evaluation. Neither case changes delivery.
  // Ordinary model text is never goal-state evidence.
  if (frame.type === "system" && frame.subtype === "local_command" &&
      !frame.parent_tool_use_id && !frame.isMeta && frame.commandRun?.command === "goal" &&
      frame.commandRun.args === "clear" && typeof frame.content === "string" &&
      /^<local-command-stdout>(?:No goal set|Goal cleared: [\s\S]+)<\/local-command-stdout>$/u.test(frame.content)) {
    if (state.goal && state.goal.status !== "complete") state.clearedGoal = state.goal;
    state.goal = null;
    state.goalStartId = "";
    const command = scan.byId.get(frame.parentUuid);
    state.goalCommandId = command?.type === "user" && !command.isMeta && !command.parent_tool_use_id
      ? command.uuid : "";
  }
  if (frame.type === "system" && frame.subtype === "local_command" &&
      frame.uuid && !frame.parent_tool_use_id && !frame.isMeta &&
      typeof frame.commandRun?.command === "string" && frame.commandRun.command) {
    const output = typeof frame.content === "string"
      ? /^<local-command-(stdout|stderr)>([\s\S]*)<\/local-command-\1>$/u.exec(frame.content) : null;
    if (output) fold.commandMessages.push({ id: `claude_${frame.uuid}_0`, text: output[2],
      data: { native: { engineId: "claude", type: "system", subtype: "local_command",
        command: frame.commandRun.command, output: output[1] } } });
  }
  const status = frame.attachment;
  if (frame.type === "attachment" && !frame.parent_tool_use_id &&
      status?.type === "goal_status" && typeof status.condition === "string") {
    const goal = state.goal;
    // A sentinel no command follows re-attaches the unfinished goal after
    // Claude compacts its context: it stays the same goal, with its identity.
    const sentinel = status.sentinel === true && !(status.met === false && status.failed !== true &&
      goal?.objective === status.condition && goal.status !== "complete" && !scan.commandedSentinels.has(frame.uuid));
    if (sentinel || goal?.objective !== status.condition) {
      state.goalStartId = sentinel && typeof status.met === "boolean" ? frame.uuid || "" : "";
      state.goalCommandId = "";
    }
    if (status.met === true && sentinel) {
      if (goal && goal.status !== "complete") state.clearedGoal = goal;
      state.goal = null;
    } else if (status.met === false || status.met === true) {
      const timestamp = Date.parse(frame.timestamp) / 1000;
      const createdAt = goal?.objective === status.condition && !sentinel ? goal.createdAt : timestamp;
      // Resume sends the same objective again and Claude starts it anew;
      // the unfinished goal keeps the running time it already had.
      const previous = goal || state.clearedGoal;
      const carried = previous?.objective === status.condition &&
        (previous.status !== "complete" || previous.createdAt === createdAt);
      state.goal = {
        threadId: options.conversationId, objective: status.condition, createdAt,
        timeUsedSeconds: carried ? previous.timeUsedSeconds : 0,
        status: status.met ? "complete" : status.failed === true ? "blocked" : "active", updatedAt: timestamp,
        reason: typeof status.reason === "string" ? status.reason : ""
      };
      state.clearedGoal = null;
    }
  }
  // This is native terminal evidence, not an inference from the assistant's
  // answer or its wording. Retain it across process and application restarts.
  if (state.goal?.status === "active" && frame.type === "system" && frame.subtype === "informational" &&
      !frame.parent_tool_use_id && typeof frame.content === "string" &&
      /^A hook blocked the turn from ending \d+ consecutive times — overriding and ending turn\./u.test(frame.content)) {
    state.goal = { ...state.goal, status: "blocked", updatedAt: Date.parse(frame.timestamp) / 1000,
      reason: ["Claude stopped after repeated attempts to continue the unfinished goal. Resolve the blocker, then resume the goal.", state.goal.reason].filter(Boolean).join("\n\n") };
  }
  // Claude's own API-error message ends the goal's turn at the account's
  // usage limit (with its reset time) or an exhausted credit balance. The
  // goal waits there until a later answer shows the account working again.
  if (["active", "usageLimited"].includes(state.goal?.status) && frame.type === "assistant" &&
      !frame.parent_tool_use_id && !frame.isSidechain) {
    const outOfCredit = frame.isApiErrorMessage === true && frame.error === "billing_error";
    const limited = outOfCredit || (frame.isApiErrorMessage === true &&
      ["usage_limit_reached", "model_requires_usage_credits"].includes(frame.apiError));
    if (limited || (state.goal.status === "usageLimited" && frame.isApiErrorMessage !== true)) {
      const resetsAt = frame.apiErrorParams?.rate_limit_info?.resetsAt;
      const { resetsAt: _resetsAt, outOfCredit: _outOfCredit, ...rest } = state.goal;
      state.goal = { ...rest, status: limited ? "usageLimited" : "active", updatedAt: Date.parse(frame.timestamp) / 1000,
        ...(outOfCredit ? { outOfCredit: true } : limited && Number.isSafeInteger(resetsAt) && resetsAt > 0 ? { resetsAt } : {}) };
    }
  }
  // Native /goal appends its sentinel before the authored command, whose
  // parent identifies that exact attachment. A later evaluation keeps it.
  if (frame.type === "user" && !frame.isMeta && frame.uuid && state.goalStartId && frame.parentUuid === state.goalStartId) {
    state.goalCommandId = frame.uuid;
  }
  if (frame.type === "user" && !frame.isMeta && frame.uuid &&
      (typeof frame.message?.content === "string" || frame.message?.content?.some((block) => block.type === "text"))) {
    fold.userIds.push(frame.uuid);
    state.lastUserId = frame.uuid;
    state.lastUserStart = fold.messages.length;
    if (!frame.parent_tool_use_id) fold.userMessages.push({ id: frame.uuid, text: claudeUserText(frame.message.content) });
  }
  if (!frame.parent_tool_use_id && !frame.isMeta) {
    if (frame.type === "result" && frame.subtype === "success" && !frame.is_error &&
        !["aborted_streaming", "aborted_tools"].includes(frame.terminal_reason)) {
      // Same final normalization as the live native turn; this is an actual
      // saved result, never a result invented from a tool-use candidate.
      const text = typeof frame.structured_output === "object" ? JSON.stringify(frame.structured_output) : String(frame.result || "");
      fold.completedResults.push({ id: frame.uuid || "", userId: state.lastUserId, text });
    } else if (frame.type === "result") {
      // Preserve the live terminal-failure/interruption contradiction without
      // copying native error details into stopped application inspection.
      fold.failedResults.push({ id: frame.uuid || "", userId: state.lastUserId });
    }
    if (frame.type === "assistant") {
      for (const block of frame.message?.content || []) {
        if (block.type === "tool_use" && block.name === "StructuredOutput" && typeof block.id === "string" && block.id &&
            block.input && typeof block.input === "object" && !Array.isArray(block.input)) {
          // Raw native carrier only. A stopped importer must independently
          // verify the original completed receipt and exact final/user custody.
          fold.structuredOutputs.push({ id: frame.uuid || "", userId: state.lastUserId,
            toolUseId: block.id, text: JSON.stringify(block.input) });
        }
      }
    }
  }
  if (frame.type === "assistant" && !frame.parent_tool_use_id && frame.message?.id && !fold.messageIds.has(frame.message.id)) {
    fold.messageIds.add(frame.message.id);
    checkpoint.added.push({ apiMessageId: frame.message.id });
  }
  for (const message of claudeMessageBlocks(frame, { commentary: scan.toolMessages.has(frame.message?.id) })) {
    const projected = { ...message, userId: state.lastUserId,
      ...(frame.message.content.length === 1 && typeof frame.message.id === "string" && frame.message.id &&
          Number.isSafeInteger(frame.apiBlockIndex) && frame.apiBlockIndex >= 0
        ? { outputId: `claude_${frame.message.id}_${frame.apiBlockIndex}` } : {}) };
    const position = fold.messageIndex.get(message.id);
    if (position === undefined) {
      fold.messageIndex.set(message.id, fold.messages.length);
      checkpoint.added.push({ messageId: message.id });
      fold.messages.push(projected);
    } else {
      // A message saved again keeps its place, as a Map keeps a key's.
      if (position < checkpoint.lengths.messages) throw new HistoryFoldConflict();
      fold.messages[position] = projected;
      state.lastUserStart = Math.min(state.lastUserStart, position);
    }
  }
}

/**
 * The projection of a conversation's frames. A conversation's own state folds
 * only the frames after its last checkpoint (just after its newest user frame,
 * where every earlier message is complete); a rewind, or a frame that changes
 * how an earlier one was folded, folds them all again.
 */
function projectClaudeHistory(frames, options, state = null) {
  let projection = state?.projection;
  if (projection?.scan.frames !== frames) projection = null;
  projection ||= { scan: emptyHistoryScan(frames), fold: emptyHistoryFold(), checkpoint: null };
  const { scan } = projection;
  // Frames after the checkpoint are folded again, so only an appended frame
  // that changes a frame before it makes this read fold everything.
  if (projection.checkpoint) rewindFold(projection.fold, projection.checkpoint);
  const changesFolded = extendHistoryScan(scan, projection.checkpoint?.at ?? 0, projection.fold.messageIds);
  let retained = null;
  if (scan.rewound) {
    // Native rewind appends a resume anchor; it retains the discarded branch.
    // Follow the selected branch so restart/admission reads cannot revive it.
    retained = new Set();
    for (let leafUuid = scan.leafUuid; leafUuid && !retained.has(leafUuid); leafUuid = scan.byId.get(leafUuid)?.parentUuid) {
      retained.add(leafUuid);
    }
  }
  function foldFrames(fromStart) {
    if (fromStart) {
      projection.fold = emptyHistoryFold();
      projection.checkpoint = foldCheckpoint(projection.fold, 0);
    }
    const from = projection.checkpoint.at;
    // The next checkpoint: just after the newest user frame. A rewound history keeps none.
    let next = frames.length;
    while (next > from && frames[next - 1].type !== "user") next--;
    for (let index = from; index < frames.length; index++) {
      if (!retained && index === next && next > from) projection.checkpoint = foldCheckpoint(projection.fold, next);
      const frame = frames[index];
      if (retained && frame.uuid && !retained.has(frame.uuid)) continue;
      foldHistoryFrame(projection.fold, frame, scan, options, projection.checkpoint);
    }
    if (!retained && next === frames.length && next > from) projection.checkpoint = foldCheckpoint(projection.fold, next);
  }
  try {
    foldFrames(Boolean(retained) || changesFolded || !projection.checkpoint);
  } catch (error) {
    if (!(error instanceof HistoryFoldConflict)) throw error;
    foldFrames(true);
  }
  if (retained) projection.checkpoint = null;
  if (state) state.projection = projection;
  return { scan, fold: projection.fold };
}

async function readClaudeHistory(options) {
  const file = await claudeHistoryPath(options);
  if (!file || file.size === 0) {
    return { exists: false, messages: [], userIds: [], text: "",
      ...(options.includeUserMessages ? { userMessages: [] } : {}),
      ...(options.includeCommandMessages ? { commandMessages: [] } : {}),
      ...(options.includeFinalCarriers ? { completedResults: [], failedResults: [], structuredOutputs: [] } : {}) };
  }
  // Snapshot the file length. A writer can be in the middle of its last frame;
  // Live history reads allow that unfinished tail. Stopped maintenance can
  // require the existing strict parser without changing live observation.
  // Whether the file ends with a complete frame.
  let complete = true;
  let frames = [];
  let state = null;
  if (options.allowIncompleteTail ?? true) {
    state = historyState(file, options.history);
    const read = await claudeHistoryFrames(file, state);
    frames = read.frames;
    complete = read.offset === file.size;
  } else {
    for await (const frame of readClaudeJsonFrames(createReadStream(file.path, { end: file.size - 1 }))) {
      if (!frame.isSidechain) frames.push(frame);
    }
  }
  const { scan, fold } = projectClaudeHistory(frames, options, state);
  const { lastUserId, lastUserStart, goal, goalCommandId } = fold.scalars;
  const messages = fold.messages.slice();
  return { exists: true, messages, userIds: fold.userIds.slice(), goal, goalCommandId,
    ...(options.includeUserMessages ? { userMessages: fold.userMessages.slice() } : {}),
    ...(options.includeCommandMessages ? { commandMessages: fold.commandMessages.slice() } : {}),
    ...(options.includeFinalCarriers ? { completedResults: fold.completedResults.slice(),
      failedResults: fold.failedResults.slice(), structuredOutputs: fold.structuredOutputs.slice() } : {}),
    // An unfinished goal judges the turn's answer before the turn ends.
    ...(options.answeredTurn ? { turnAnswered: complete && goal?.status !== "active" &&
      claudeTurnAnswered(frames, scan.byId, options.answeredTurn) } : {}),
    text: messages.slice(lastUserStart).filter((message) => message.role === "assistant" && message.userId === lastUserId)
      .map((message) => message.text).join("\n") };
}

const ENDED_TASK_PATTERN = /<status>(?:completed|failed|killed|stopped)<\/status>/u;

/**
 * Whether Claude's saved frames end with the last answer of the turn `turnId`
 * began, whose latest prompt is `lastMessageId` (the turn's own, without a
 * steer). Claude Code (2.1.331, stream-json) saves no result frame: it saves
 * the turn's last answer, with stop_reason "end_turn", before it reports the
 * turn's result. That answer must be the history's last message, with no input
 * queued after it, and reach, through the frames it follows, the turn's latest
 * prompt and then its first; every background task the turn started must have
 * reported its end. Anything else (a tool call, an API error, a placeholder,
 * another prompt's answer) leaves the turn unanswered.
 * @param {object[]} frames the history's frames, in file order
 * @param {Map<string, object>} byId those frames by uuid
 * @param {{ turnId: string, lastMessageId?: string }} turn
 */
function claudeTurnAnswered(frames, byId, { turnId, lastMessageId }) {
  let index = frames.length - 1;
  while (index >= 0 && !["user", "assistant"].includes(frames[index].type)) index--;
  const answer = frames[index];
  if (!turnId || answer?.type !== "assistant" || answer.parent_tool_use_id || answer.isApiErrorMessage ||
      answer.message?.stop_reason !== "end_turn" || claudeNoResponsePlaceholder(answer) ||
      !answer.message.content?.some(block => block.type === "text" && block.text?.trim())) return false;
  if (frames.slice(index + 1).some(frame => frame.type === "queue-operation" && frame.operation === "enqueue" ||
      frame.type === "last-prompt" && frame.rewound === true)) return false;
  const started = new Set();
  const ended = new Set();
  const seen = new Set();
  let latestPrompt = "";
  for (let frame = answer; frame && !seen.has(frame); frame = byId.get(frame.parentUuid || frame.logicalParentUuid)) {
    seen.add(frame);
    if (frame.type === "assistant") {
      for (const block of frame.message?.content || []) {
        if (block.type === "tool_use" && block.input?.run_in_background === true) started.add(block.id);
      }
    } else if (frame.type === "user" && frame.toolUseResult?.backgroundTaskId) {
      started.add(frame.toolUseResult.backgroundTaskId);
    } else if (frame.type === "user" && frame.origin?.kind === "task-notification") {
      const notification = claudeUserText(frame.message?.content);
      if (ENDED_TASK_PATTERN.test(notification)) {
        for (const [, , id] of notification.matchAll(/<(task-id|tool-use-id)>([^<]+)<\/\1>/gu)) ended.add(id);
      }
    } else if (claudeAuthoredMessage(frame)) {
      latestPrompt ||= frame.uuid;
      if (frame.uuid === turnId) return latestPrompt === (lastMessageId || turnId) && [...started].every(id => ended.has(id));
    }
  }
  return false;
}

/** Remove the stopped temporary conversation's active native transcript. */
export async function deleteClaudeConversationHistory({ configRoot, workdir, conversationId }) {
  const file = await claudeHistoryPath({ configRoot, workdir, conversationId });
  if (file) await rm(file.path, { force: true });
}

export { claudeHistoryPath, claudeMessageBlocks, readClaudeHistory, requireClaudeSessionId, archivedClaudeProjectDirectory, matchingClaudeProjectDirectories };

export async function retireClaudeConversationHistory({ configRoot, binding, beforeDelete, requireIdle, signal }) {
  const id = requireClaudeSessionId(binding.conversationId);
  if (!path.isAbsolute(configRoot)) throw new TypeError("Claude retirement requires an absolute configuration root.");
  const root = path.resolve(configRoot);
  const projects = path.join(root, "projects");
  const isTranscript = (file) => !file.directory &&
    file.path.startsWith(`${projects}${path.sep}`) && TRANSCRIPT_PATH_PATTERN.test(file.path);
  const missing = (error) => { if (error.code === "ENOENT") return null; throw error; };
  const inspect = async () => {
    await requireIdle();
    const rootInfo = await lstat(root).catch(missing);
    if (!rootInfo) return [];
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(root) !== root) {
      throw new Error("Claude storage root must be a canonical directory without symlink parents.");
    }
    const directory = await archivedClaudeProjectDirectory(binding.workdir);
    const directories = async (parent) => {
      const info = await lstat(parent).catch(missing);
      if (!info) return [];
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Claude storage contains an unsafe directory.");
      const names = await readdir(parent);
      if (names.length > 10000) throw new Error("Claude storage directory exceeds its inspection limit.");
      return names;
    };
    const projectNames = await directories(projects);
    const candidates = matchingClaudeProjectDirectories(projectNames, directory);
    const targets = [];
    let matches = 0;
    for (const name of candidates) {
      const parent = path.join(projects, name);
      const names = await directories(parent);
      const owned = names.filter((name) => name === id || name === `${id}.jsonl` ||
        name.startsWith(`${id}.jsonl.superseded-`) || name.startsWith(`${id}.jsonl.orphaned-`));
      if (owned.length) matches += 1;
      targets.push(...owned.map((name) => path.join(parent, name)));
    }
    if (matches > 1) throw new Error("Claude conversation occurs in more than one native project directory.");
    for (const kind of ["file-history", "image-cache", "uploads"]) {
      const parent = path.join(root, kind);
      if ((await directories(parent)).includes(id)) targets.push(path.join(parent, id));
    }
    const files = [];
    const visit = async (file) => {
      const info = await lstat(file);
      if ((!info.isFile() && !info.isDirectory()) || info.isSymbolicLink() || files.length >= 10000) {
        throw new Error("Claude conversation contains unsafe paths or exceeds its inspection limit.");
      }
      files.push({ path: file, directory: info.isDirectory(), inode: info.ino, size: info.size, modified: info.mtimeMs });
      if (info.isDirectory()) for (const name of (await directories(file)).sort()) await visit(path.join(file, name));
    };
    for (const target of targets.sort()) await visit(target);
    const transcripts = files.filter(isTranscript);
    return targets.length ? [{ conversationId: id, workdir: binding.workdir, paths: targets, files,
      ...(transcripts.length ? { updatedAt: new Date(Math.max(...transcripts.map((file) => file.modified))).toISOString() } : {}) }] : [];
  };
  return retireNativeConversation({ binding, inspect, beforeDelete,
    exportConversation: async (_id, onRecord) => {
      const deadline = AbortSignal.timeout(300_000);
      const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const output = createNativeHistoryExport(onRecord, { signal: boundedSignal });
      const [conversation] = await inspect();
      if (!conversation) throw new Error("Claude conversation disappeared before export.");
      for (const file of conversation.files.filter(isTranscript)) {
        const branchId = path.relative(projects, file.path).split(path.sep).join("/");
        if (!file.size) continue;
        const stream = createReadStream(file.path, { end: file.size - 1, signal: boundedSignal });
        for await (const frame of readClaudeJsonFrames(stream)) {
          const provenance = { branchId,
            ...(frame.uuid || frame.message?.id ? { messageId: frame.uuid || frame.message.id } : {}),
            ...(frame.parentUuid ? { parentMessageId: frame.parentUuid } : {}),
            ...(frame.timestamp ? { createdAt: frame.timestamp } : {}),
            ...(frame.message?.model ? { modelId: frame.message.model } : {}) };
          const text = claudeMessageBlocks(frame, { includeNested: true })
            .filter((message) => message.role !== "thinking")
            .map((message) => ({ ...provenance, role: "assistant", text: message.text }));
          if (frame.type === "user") {
            const user = claudeUserText(frame.message?.content);
            if (user) text.push({ ...provenance, role: "user", text: user });
          }
          if (frame.attachment?.type === "goal_status" && typeof frame.attachment.condition === "string") {
            text.push({ ...provenance, role: "goal", text: frame.attachment.condition });
          }
          await output.emit({ type: "frame", branchId, frame, text });
        }
      }
      return output.complete();
    },
    remove: async (records) => {
      await requireIdle();
      for (const target of records[0].paths) await rm(target, { recursive: true, force: true });
    }
  });
}
