import { AGENT_ROWS } from "../resources.js";
import { firstRow, rowOf } from "./rows.js";

const OPEN = Object.freeze(["active", "paused"]);

/**
 * Every statement on goals (createGoals), on the agentGoals handle, in the owner's system context
 * (`options`). Each change answers nothing and leaves a goal that is gone as it is.
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.goals
 * @param {Readonly<{ context: object }>} dependencies.options
 */
export function createGoalsRepository({ goals, options }) {
  const now = () => goals.raw("now()");
  const inSeconds = (seconds) => goals.raw("now() + make_interval(secs => ?)", [seconds]);
  const change = async (id, changes, more = {}) => {
    await goals.patchWhereIds([id], changes, { ...options, missing: "skip", ...more });
  };
  const first = async (filters) => firstRow(AGENT_ROWS.goals, await goals.query({ filters, page: { size: 1 } }, options));

  /** The conversation's active or paused goal, or undefined. */
  function open(conversationId) {
    return first({ conversation_id: conversationId, statusIn: OPEN });
  }

  function active(conversationId) {
    return first({ conversation_id: conversationId, status: "active" });
  }

  async function create(attributes) {
    return rowOf(AGENT_ROWS.goals, await goals.create(attributes, options));
  }

  function editObjective(id, objective) {
    return change(id, { objective, updated_at: now() });
  }

  /** Paused, blocked (with its reason) or complete: no round queued. */
  function markStatus(id, status, reason) {
    return change(id, { status, ...(reason === undefined ? {} : { reason }), round_at: null, updated_at: now() });
  }

  /** Queues the next round now, unless one is queued already. */
  function queueRound(id) {
    return change(id, { round_at: now(), updated_at: now() }, { onlyIf: { round_at: null } });
  }

  async function resumePaused(conversationId) {
    await goals.patchWhere({ conversation_id: conversationId, status: "paused" }, { status: "active", updated_at: now() }, { ...options, onlyIf: { status: "paused" } });
  }

  /** The goal's row once it is leased to this server for a round, or null when no round is due. */
  function claimDue(leaseSeconds) {
    return goals.withTransaction(options, async (txOptions) => {
      const [due] = await goals.claim({ status: "active", roundDue: true }, { sort: ["round_at"] }, txOptions);
      if (!due) {
        return null;
      }
      const [leased] = await goals.patchWhereIds([due.id], { lease_until: inSeconds(leaseSeconds) }, { ...txOptions, returning: "records" });
      return rowOf(AGENT_ROWS.goals, leased);
    });
  }

  /** Rounds stop: paused, with the reason of the error that stopped them when there is one. */
  function stopRounds(id, reason) {
    return change(id, { status: "paused", ...(reason === undefined ? {} : { reason }), lease_until: null, round_at: null });
  }

  /** The round waits: its lease let go, the round queued `seconds` from now. */
  function retryLater(id, seconds) {
    return change(id, { lease_until: null, round_at: inSeconds(seconds) });
  }

  function extendLease(id, seconds) {
    return change(id, { lease_until: inSeconds(seconds) });
  }

  /** The goal's row once its round has started (one more round, none queued), or undefined when it is gone. */
  async function startRound(id, rounds) {
    const [current] = await goals.patchWhereIds([id], { rounds, round_at: null, updated_at: now() }, { ...options, missing: "skip", returning: "records" });
    return rowOf(AGENT_ROWS.goals, current);
  }

  function finishRound(id) {
    return change(id, { lease_until: null, attempts: 0 });
  }

  return Object.freeze({
    open,
    active,
    create,
    editObjective,
    markStatus,
    queueRound,
    resumePaused,
    claimDue,
    stopRounds,
    retryLater,
    extendLease,
    startRound,
    finishRound
  });
}
