import { createRunsRepository } from "./repositories/runsRepository.js";

// Replies in progress, one per conversation at a time, kept in the database so any server can see
// them (one claimed per conversation, with a heartbeat). Each finished step is saved as it happens,
// so a reply whose server stops (deploy, crash) is carried on from its last step by any server, as
// Claude Code resumes from its transcript.
//
// The table (agentRuns, resources.js) has: conversation_id (its key), started_at, heartbeat_at,
// steps (jsonb), input (jsonb), plus whatever `owner` columns the app adds (for example bot_id).
// A run is stale once its heartbeat (every heartbeatMs) is older than staleSeconds.
export const RUN_LIMITS = { staleSeconds: 60, heartbeatMs: 15000 };

/**
 * The replies in progress, on the agentRuns handle of the feature that owns the agent's tables.
 * @param {object} dependencies
 * @param {Readonly<Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>>} dependencies.resources The owner's handles (agentResources()).
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext The owner's system context factory.
 * @param {typeof RUN_LIMITS} [dependencies.limits]
 */
export function createRuns({
  resources,
  systemContext,
  limits = RUN_LIMITS
}) {
  const repository = createRunsRepository({
    runs: resources.agentRuns,
    options: Object.freeze({ context: systemContext("a reply runs in any conversation, and one a stopped server left is carried on by another server") })
  });
  const staleSeconds = () => Number(limits.staleSeconds);

  /** Claims the conversation for one reply: a new run, or one whose server stopped beating. */
  async function claim(conversationId, owner = {}) {
    if (await repository.insert(conversationId, owner)) return true;
    return Boolean(await repository.takeOver(conversationId, staleSeconds()));
  }

  /** Keeps the run alive; answers the number of runs it touched. */
  function heartbeat(conversationId) {
    return repository.heartbeat(conversationId);
  }

  function release(conversationId) {
    return repository.release(conversationId);
  }

  /** What a reply saved so far: its steps and what started it. */
  function saved(conversationId) {
    return repository.saved(conversationId);
  }

  function save(conversationId, steps, input) {
    return repository.save(conversationId, steps, input);
  }

  /**
   * Replies left part-way by a stopped server, each taken over by this one (still stale when
   * claimed, so two servers can't both take it). `resumable(query)` narrows which kinds count, on
   * the store's read-only query builder.
   */
  async function takeOverStalled({ resumable = (query) => query, count = 10 } = {}) {
    const ids = await repository.stalledIds({ staleSeconds: staleSeconds(), resumable, count });
    const taken = [];
    for (const id of ids) {
      const mine = await repository.takeOver(id, staleSeconds());
      if (mine) taken.push(mine);
    }
    return taken;
  }

  return Object.freeze({
    limits,
    claim,
    heartbeat,
    release,
    saved,
    save,
    takeOverStalled
  });
}

/**
 * Carries on, every `everyMs`, the replies stopped servers left; `resume(run)` restarts one.
 * @param {object} dependencies
 * @param {import("./types.js").AgentRuns} dependencies.runs
 * @param {(run: object) => Promise<unknown>} dependencies.resume
 * @param {(query: object) => object} [dependencies.resumable]
 * @param {number} [dependencies.everyMs]
 */
export function startResumer({ runs, resume, resumable, everyMs = 30000 }) {
  let stopped = false;
  let running = null;
  const tick = () => {
    if (stopped || running) return;
    running = runs.takeOverStalled({ resumable })
      .then((taken) => Promise.all(taken.map((run) => resume(run))))
      .catch((error) => console.error(`Resuming replies: ${error?.message || error}`))
      .finally(() => { running = null; });
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  tick();
  return {
    async drain(ms) {
      stopped = true;
      clearInterval(timer);
      await Promise.race([running || Promise.resolve(), new Promise((resolve) => setTimeout(resolve, ms))]);
    }
  };
}
