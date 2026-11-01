import { SUMMARY_LIMITS, cutPoint, estimateTokens, transcriptText, writeSummary } from "@jskit-ai/agent/server";

// Summaries between turns, in the background. A reply reads the conversation's newest summary and
// every message after it word for word. When that part grows past `compactAt`, the conversation is
// queued; one server claims it and summarises everything but the latest turns, folding in the
// previous summary. A summary replaces exactly the messages it covers, so anything said meanwhile
// stays as it was, and no reply waits for it. Summaries are written recall first: what was asked
// and decided, facts, what was done and promised, what's open. Sized for a 1-million-token window,
// close to DeepSeek Harness's 727k/127k: a chat is read word for word until it's far into the
// window, leaving room for one long turn's own steps on top.
//
// Tables: summaries (id, conversation_id, covers_up_to, summary, messages, created_at) and a queue
// (conversation_id unique, requested_at, run_after, lease_until, attempts, last_error).

// Hooks: `history(conversationId, { after })` gives { messages, inherited, toModel, named }: the
// stored messages after `after` (message ids), what a conversation inherits from one it continues
// (only needed before its first summary), the app's way of turning messages into model messages, and
// whether people's lines carry their names (groups and rooms). `track(conversationId, work)` meters
// the summary to whoever the conversation belongs to. `summarize({ previous, text })` may replace
// the model call (tests).
export function createSummaries({
  knex, model, app = "the app", history, track = (_conversationId, work) => work(), notices = null,
  tables = { summaries: "agent_summaries", queue: "agent_summary_queue" }, channel = "agent-summaries",
  summarize = (input) => writeSummary({ model, app, ...input, limits }), limits = SUMMARY_LIMITS
}) {
  async function latest(conversationId) {
    return knex(tables.summaries).where({ conversation_id: conversationId }).orderBy("id", "desc").first();
  }

  // What a reply reads: the newest summary's text, and the id after which messages are read whole.
  async function current(conversationId) {
    const row = await latest(conversationId);
    return row ? { summary: row.summary, after: Number(row.covers_up_to) } : { summary: "", after: 0 };
  }

  // After a reply: queue a summary when the part since the last one has grown too big.
  async function consider(conversationId) {
    const { after } = await current(conversationId);
    const { messages, inherited, toModel } = await history(conversationId, { after });
    const size = estimateTokens(await toModel([...(after ? [] : inherited), ...messages]));
    if (size <= limits.compactAt) return false;
    await knex(tables.queue).insert({ conversation_id: conversationId }).onConflict("conversation_id").ignore();
    await notices?.publish?.(channel, "all", {}).catch(() => {});
    return true;
  }

  // One summary: everything after the previous one up to the kept turns, folded into it.
  async function compact(conversationId) {
    const previous = await latest(conversationId);
    const after = previous ? Number(previous.covers_up_to) : 0;
    const { messages, inherited, toModel, named = false } = await history(conversationId, { after });
    const sizes = await Promise.all(messages.map(async (message) => estimateTokens(await toModel([message]))));
    let cut = cutPoint(messages, sizes, limits);
    if (!cut) return { skipped: "nothing to summarise yet" };
    // A huge backlog is folded in a piece at a time, oldest first; the next run takes the rest.
    let reading = estimateTokens(await toModel(previous ? [] : inherited));
    for (let index = 0; index < cut; index += 1) {
      reading += sizes[index];
      if (reading > limits.readTokens && index > 0) {
        cut = index;
        break;
      }
    }
    const folded = messages.slice(0, cut);
    const modelMessages = await toModel([...(previous ? [] : inherited), ...folded]);
    if (!previous && estimateTokens(modelMessages) < limits.minTokens) return { skipped: "too little to summarise" };
    const summary = await track(conversationId, () => summarize({ previous: previous?.summary || "", text: transcriptText(modelMessages, { named }) }));
    if (!summary) throw new Error("The summary came back empty.");
    const coversUpTo = Number(folded.at(-1).id);
    await knex.transaction(async (trx) => {
      // Another server's newer summary wins; this one is dropped.
      const newest = await trx(tables.summaries).where({ conversation_id: conversationId }).orderBy("id", "desc").forUpdate().first();
      if (newest && Number(newest.covers_up_to) >= coversUpTo) return;
      await trx(tables.summaries).insert({ conversation_id: conversationId, covers_up_to: coversUpTo, summary, messages: folded.length });
      const old = await trx(tables.summaries).where({ conversation_id: conversationId }).orderBy("id", "desc").offset(limits.keepSummaries).pluck("id");
      if (old.length) await trx(tables.summaries).whereIn("id", old).del();
    });
    return { coversUpTo, messages: folded.length };
  }

  // Before a reply: if summarising fell behind and the part a reply reads is past
  // `summariseNowAt`, summarise now, a few pieces at most, rather than let the oldest messages drop
  // off unseen. A failure leaves the reply its last-resort cut (withinBudget, @jskit-ai/agent).
  async function ensureWithin(conversationId) {
    for (let piece = 0; piece < 4; piece += 1) {
      const { after } = await current(conversationId);
      const { messages, inherited, toModel } = await history(conversationId, { after });
      if (estimateTokens(await toModel([...(after ? [] : inherited), ...messages])) <= limits.summariseNowAt) return;
      const done = await compact(conversationId).catch((error) => {
        console.error(`Summarising conversation ${conversationId} before a reply: ${error?.message || error}`);
        return {};
      });
      if (!done.coversUpTo) return;
    }
  }

  // Claimed once across servers with a lease; a failure waits longer before the next try.
  async function claim() {
    return knex.transaction(async (trx) => {
      const due = await trx(tables.queue).where("run_after", "<=", trx.fn.now())
        .where((query) => query.whereNull("lease_until").orWhere("lease_until", "<", trx.fn.now()))
        .orderBy("requested_at").forUpdate().skipLocked().first();
      if (!due) return null;
      await trx(tables.queue).where({ conversation_id: due.conversation_id }).update({ lease_until: trx.raw(`now() + interval '${Number(limits.leaseMinutes)} minutes'`) });
      return due;
    });
  }

  async function runOne() {
    const job = await claim();
    if (!job) return false;
    try {
      await compact(job.conversation_id);
      await knex(tables.queue).where({ conversation_id: job.conversation_id }).del();
      // Still too long (a backlog folded in pieces)? Queue the next piece.
      await consider(job.conversation_id);
    } catch (error) {
      const wait = Math.min(60, 2 ** job.attempts);
      await knex(tables.queue).where({ conversation_id: job.conversation_id })
        .update({ attempts: job.attempts + 1, lease_until: null, last_error: String(error?.message || error).slice(0, 500), run_after: knex.raw(`now() + interval '${wait} minutes'`) }).catch(() => {});
    }
    return true;
  }

  // Every serving server runs this loop; a notice wakes it as soon as something is queued.
  function start({ everyMs = 15000 } = {}) {
    let stopped = false;
    let running = null;
    const tick = () => {
      if (running || stopped) return;
      running = (async () => {
        try {
          for (let count = 0; !stopped && count < 20 && (await runOne()); count += 1);
        } catch {
          // The database is unreachable; the next tick tries again.
        }
      })().finally(() => {
        running = null;
      });
    };
    const timer = setInterval(tick, everyMs);
    timer.unref?.();
    const unsubscribe = notices?.subscribe?.(channel, "all", () => tick()) || (() => {});
    tick();
    return {
      async drain(ms) {
        stopped = true;
        clearInterval(timer);
        unsubscribe();
        await Promise.race([running, new Promise((resolve) => setTimeout(resolve, ms))]);
      }
    };
  }

  return { current, consider, compact, ensureWithin, runOne, start };
}
