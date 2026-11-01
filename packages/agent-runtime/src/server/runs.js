// Replies in progress, one per conversation at a time, kept in the database so any server can see
// them (one claimed per conversation, with a heartbeat). Each finished step is saved as it happens,
// so a reply whose server stops (deploy, crash) is carried on from its last step by any server, as
// Claude Code resumes from its transcript.
//
// The table has: conversation_id (unique), started_at, heartbeat_at, steps (jsonb), input (jsonb),
// plus whatever `owner` columns the app adds (for example bot_id).
// A run is stale once its heartbeat (every heartbeatMs) is older than staleSeconds.
export const RUN_LIMITS = { staleSeconds: 60, heartbeatMs: 15000 };

export function createRuns({ knex, table = "agent_runs", limits = RUN_LIMITS }) {
  const stale = (query) => query.where("heartbeat_at", "<", knex.raw(`now() - interval '${Number(limits.staleSeconds)} seconds'`));

  return {
    limits,

    // Claims the conversation for one reply: a new run, or one whose server stopped beating.
    async claim(conversationId, owner = {}) {
      const [fresh] = await knex(table).insert({ conversation_id: conversationId, ...owner }).onConflict("conversation_id").ignore().returning("conversation_id");
      if (fresh) return true;
      const [taken] = await stale(knex(table).where({ conversation_id: conversationId }))
        .update({ started_at: knex.fn.now(), heartbeat_at: knex.fn.now() }).returning("conversation_id");
      return Boolean(taken);
    },

    heartbeat(conversationId) {
      return knex(table).where({ conversation_id: conversationId }).update({ heartbeat_at: knex.fn.now() });
    },

    release(conversationId) {
      return knex(table).where({ conversation_id: conversationId }).del();
    },

    // What a reply saved so far: its steps and what started it.
    saved(conversationId) {
      return knex(table).where({ conversation_id: conversationId }).first("steps", "input");
    },

    save(conversationId, steps, input) {
      return knex(table).where({ conversation_id: conversationId }).update({ steps: JSON.stringify(steps), input: JSON.stringify(input), heartbeat_at: knex.fn.now() });
    },

    // Replies left part-way by a stopped server, each taken over by this one (still stale when
    // claimed, so two servers can't both take it). `resumable(query)` narrows which kinds count.
    async takeOverStalled({ resumable = (query) => query, count = 10 } = {}) {
      const rows = await resumable(stale(knex(table).whereNotNull("steps"))).limit(count);
      const taken = [];
      for (const row of rows) {
        const [mine] = await stale(knex(table).where({ conversation_id: row.conversation_id }))
          .update({ started_at: knex.fn.now(), heartbeat_at: knex.fn.now() }).returning("*");
        if (mine) taken.push(mine);
      }
      return taken;
    }
  };
}

// Carries on, every `everyMs`, the replies stopped servers left; `resume(run)` restarts one.
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
  timer.unref?.();
  tick();
  return {
    async drain(ms) {
      stopped = true;
      clearInterval(timer);
      await Promise.race([running || Promise.resolve(), new Promise((resolve) => setTimeout(resolve, ms))]);
    }
  };
}
