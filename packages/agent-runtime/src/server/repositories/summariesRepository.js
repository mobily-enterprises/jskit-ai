import { isLostDuplicateInsertRace } from "@jskit-ai/database-runtime/shared";
import { AGENT_ROWS } from "../resources.js";
import { conversationKey, firstRow, rowOf } from "./rows.js";

/**
 * Every statement on summaries and their queue (createSummaries), on the agentSummaries and
 * agentSummaryQueue handles, in the owner's system context (`options`).
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.summaries
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.queue
 * @param {Readonly<{ context: object }>} dependencies.options
 */
export function createSummariesRepository({ summaries, queue, options }) {
  const inSeconds = (seconds) => queue.raw("now() + make_interval(secs => ?)", [seconds]);

  /** The conversation's newest summary, or undefined. */
  async function latest(conversationId, callOptions = options) {
    return firstRow(AGENT_ROWS.summaries, await summaries.query({ filters: { conversation_id: conversationKey(conversationId) }, sort: ["-id"], page: { size: 1 } }, callOptions));
  }

  /**
   * Saves a summary unless another server saved a newer one first (the newest is locked while this
   * decides), and keeps only the newest `keep` of the conversation's summaries.
   */
  function saveUnlessNewer(conversationId, { coversUpTo, summary, messages }, keep) {
    conversationKey(conversationId);
    return summaries.withTransaction(options, async (txOptions) => {
      const newest = await latest(conversationId, txOptions);
      const [locked] = newest ? await summaries.lockMany([newest.id], { ...txOptions, missing: "skip" }) : [];
      if (locked && Number(locked.covers_up_to) >= coversUpTo) return;
      await summaries.create({ conversation_id: conversationId, covers_up_to: coversUpTo, summary, messages }, { ...txOptions, returning: "none" });
      const newestFirst = await summaries.queryAll({ filters: { conversation_id: conversationId }, sort: ["-id"], fields: ["covers_up_to"] }, txOptions);
      const old = newestFirst.slice(keep).map((row) => row.id);
      if (old.length) await summaries.deleteMany(old, { ...txOptions, missing: "skip" });
    });
  }

  /** Queues the conversation; one that is queued already keeps its place. */
  async function enqueue(conversationId) {
    try {
      await queue.create({ id: conversationKey(conversationId) }, { ...options, returning: "none" });
    } catch (error) {
      if (!isLostDuplicateInsertRace(error, options)) {
        throw error;
      }
    }
  }

  /** The oldest due request no server holds, as it was before this server leased it; null when none. */
  function claimDue(leaseSeconds) {
    return queue.withTransaction(options, async (txOptions) => {
      const [due] = await queue.claim({ summaryDue: true }, { sort: ["requested_at"] }, txOptions);
      if (!due) {
        return null;
      }
      await queue.patchWhereIds([due.id], { lease_until: inSeconds(leaseSeconds) }, txOptions);
      return rowOf(AGENT_ROWS.summaryQueue, due);
    });
  }

  async function dequeue(conversationId) {
    await queue.deleteMany([conversationKey(conversationId)], { ...options, missing: "skip" });
  }

  /** A failed request waits `waitSeconds` before its next try, its lease let go. */
  async function retryLater(conversationId, { attempts, lastError, waitSeconds }) {
    await queue.patchWhereIds([conversationKey(conversationId)], { attempts, lease_until: null, last_error: lastError, run_after: inSeconds(waitSeconds) }, { ...options, missing: "skip" });
  }

  return Object.freeze({
    latest,
    saveUnlessNewer,
    enqueue,
    claimDue,
    dequeue,
    retryLater
  });
}
