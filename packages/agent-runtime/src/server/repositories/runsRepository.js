import { isLostDuplicateInsertRace } from "@jskit-ai/database-runtime/shared";
import { AGENT_ROWS } from "../resources.js";
import { conversationKey, rowOf } from "./rows.js";

/**
 * Every statement on the replies in progress (createRuns), on the agentRuns handle, in the
 * owner's system context (`options`). The writes answer how many runs they touched.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.runs
 * @param {Readonly<{ context: object }>} dependencies.options
 */
export function createRunsRepository({ runs, options }) {
  const now = () => runs.raw("now()");
  const touching = Object.freeze({ ...options, missing: "skip", returning: "id" });
  // How many runs a write touched: none when the conversation has no run.
  const touched = (answer) => (answer === null ? 0 : 1);

  /** A new run for the conversation; false when it already has one. */
  async function insert(conversationId, owner) {
    try {
      await runs.create({ ...owner, id: conversationKey(conversationId) }, { ...options, returning: "none" });
      return true;
    } catch (error) {
      if (!isLostDuplicateInsertRace(error, options)) {
        throw error;
      }
      return false;
    }
  }

  /**
   * The run, taken over by this server while it is still stale (no other server beat or took it
   * meanwhile): its whole row, or null.
   */
  function takeOver(conversationId, staleSeconds) {
    conversationKey(conversationId);
    return runs.withTransaction(options, async (txOptions) => {
      const [stale] = await runs.claim({ filters: { id: conversationId, staleFor: staleSeconds } }, txOptions);
      if (!stale) {
        return null;
      }
      return rowOf(AGENT_ROWS.runs, await runs.patch(stale.id, { started_at: now(), heartbeat_at: now() }, { ...txOptions, missing: "skip" }));
    });
  }

  // Knex: subquery - the app narrows which stalled replies count with its own resumable(query)
  async function stalledIds({ staleSeconds, resumable, count }) {
    const { query } = await runs.scopedQuery({ filters: { staleFor: staleSeconds, withSteps: true } }, options);
    return resumable(query).limit(count).pluck(runs.column("id"));
  }

  /** The steps and input saved so far, or undefined without a run. */
  async function saved(conversationId) {
    const run = await runs.get(conversationKey(conversationId), { fields: ["steps", "input"] }, { ...options, missing: "skip" });
    return run ? { steps: run.steps, input: run.input } : undefined;
  }

  async function heartbeat(conversationId) {
    return touched(await runs.patch(conversationKey(conversationId), { heartbeat_at: now() }, touching));
  }

  async function save(conversationId, steps, input) {
    return touched(await runs.patch(conversationKey(conversationId), { steps, input, heartbeat_at: now() }, touching));
  }

  async function release(conversationId) {
    return touched(await runs.delete(conversationKey(conversationId), { ...options, missing: "skip" }));
  }

  return Object.freeze({
    insert,
    takeOver,
    stalledIds,
    saved,
    heartbeat,
    save,
    release
  });
}
