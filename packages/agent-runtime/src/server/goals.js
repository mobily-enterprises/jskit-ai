import { z } from "zod";
import { assertCallbacks, createTool } from "@jskit-ai/agent/server";
import { NO_NOTICES } from "./notices.js";
import { createGoalsRepository } from "./repositories/goalsRepository.js";

// Goals and goal rounds, after DeepSeek Harness (MIT; P3–P5 in @jskit-ai/agent's
// docs/deepseek-harness.md). For a job of several steps the model opens a goal; whenever its turn
// ends while the goal is active, another round is queued telling it to check the real state and
// carry on, until it marks the goal complete with evidence, or blocked (not before round 3), or a
// limit is reached: rounds, or what the job may spend (AGENT_JOB_COST_USD, 5 dollars by default, 0
// for none). The person's own message always comes first. Rounds are claimed through the database
// with a lease, so any server carries them on.
//
// The table (agentGoals, resources.js) has: id, conversation_id, objective, status (active, paused,
// complete, blocked), rounds, max_rounds, reason, time_zone, language, round_at, lease_until,
// attempts, created_at, updated_at, plus whatever `owner(row)` columns the app adds.
const JOB_COST = process.env.AGENT_JOB_COST_USD;
export const GOAL_LIMITS = { maxRounds: 24, minRoundsBeforeBlocked: 3, leaseSeconds: 120, retryMs: 5000, costUsd: JOB_COST === undefined || JOB_COST === "" ? 5 : Number(JOB_COST) };

export function roundPrompt(goal) {
  return [
    "<goal_round>",
    `Objective: ${JSON.stringify(goal.objective)}`,
    `Round: ${goal.rounds}/${goal.max_rounds}`,
    "",
    "Continue working toward the objective in this same conversation. Treat the current files, tool results and saved state as authoritative; inspect them instead of assuming earlier narration is still current. Make concrete progress and verify the result. Before claiming completion, gather evidence that the whole objective is achieved, read the current goal with get_goal, and mark it complete with update_goal. If work remains, leave the goal active for the next round. Mark it blocked only for a real blocker that needs the person.",
    "</goal_round>"
  ].join("\n");
}

const COMPLETE_NOTE = "The goal is marked complete and this run is ending. Write the closing message to the person now: state the outcome, summarise what was done and how it was verified, and point to the concrete results (files, apps, records). Report only what this conversation's tool results actually establish; when a detail isn't established, say so instead of inventing it. Note anything they should review or do next. Don't call any more tools.";
const BLOCKED_NOTE = "The goal is marked blocked and this run is ending. Write the closing message to the person now: what was completed, the concrete blocking condition, what you tried, and exactly what you need from them. Don't call any more tools.";

/**
 * The goal tools, for one turn: `operations` is what goals.operationsFor(row, …) returns.
 * @param {import("./types.js").AgentGoalOperations} operations
 */
export function goalTools(operations) {
  return {
    createGoal: createTool(Object.freeze({
      id: "create_goal",
      description: "Set up a goal that keeps you working on the person's request across automatic rounds until it's done. Use it whenever their request is a job with several steps (building or changing an app, working on files, a multi-step errand), even if they didn't say \"goal\"; not for a quick answer. Then start working on it straight away.",
      inputSchema: z.object({ objective: z.string().min(5).max(2000).describe("The whole job, with what counts as done") }),
      execute: ({ objective }) => operations.create(objective.trim())
    })),
    getGoal: createTool(Object.freeze({
      id: "get_goal",
      description: "Read the current goal: its objective, status and round.",
      inputSchema: z.object({}),
      execute: () => operations.get()
    })),
    updateGoal: createTool(Object.freeze({
      id: "update_goal",
      description: "Change the goal: complete (only with evidence that the whole objective is achieved), blocked (a real blocker only the person can remove; not before 3 rounds of trying), pause, or edit its objective.",
      inputSchema: z.object({
        action: z.enum(["complete", "blocked", "pause", "edit"]),
        objective: z.string().max(2000).optional(),
        reason: z.string().max(1000).optional().describe("For blocked: what's blocking and what you need")
      }),
      execute: (input) => operations.update(input)
    }))
  };
}

/**
 * Goals, on the agentGoals handle of the feature that owns the agent's tables, and their rounds.
 * Hooks: `find(goal)` the conversation a goal is in (null when it's gone); `respond(row, options)`
 * runs one reply there; `claim(row)` takes the conversation's reply slot (runs.claim);
 * `record(row, { text, detail })` shows an event line; `notify(row, event)` tells open pages;
 * `owner(row)` extra columns for a new goal; `spent(goal)` what the job has cost so far;
 * `track(goal, work)` meters it; `background(work)` keeps a round going after the turn that queued
 * it. Each optional hook is a function, or left out for its named default. Without
 * `notices`, each server finds due rounds on its own timer.
 * @param {object} dependencies
 * @param {Readonly<Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>>} dependencies.resources The owner's handles (agentResources()).
 * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext The owner's system context factory.
 * @param {import("./types.js").AgentRuns} dependencies.runs
 * @param {string} [dependencies.channel]
 * @param {import("./types.js").AgentNotices | null} [dependencies.notices]
 * @param {typeof GOAL_LIMITS} [dependencies.limits]
 * @param {(goal: object) => Promise<object | null>} dependencies.find
 * @param {(row: object, options: { timeZone: string, language: string, prompt: string, goalTurn: boolean }) => Promise<unknown>} dependencies.respond
 * @param {(row: object) => Promise<boolean>} dependencies.claim
 * @param {(row: object, event: { text: string, detail: string }) => Promise<unknown>} dependencies.record
 * @param {(row: object, event: object) => Promise<unknown>} [dependencies.notify]
 * @param {(row: object) => object} [dependencies.owner]
 * @param {(goal: object) => Promise<number>} [dependencies.spent]
 * @param {(goal: object, work: () => Promise<unknown>) => Promise<unknown>} [dependencies.track]
 * @param {(work: Promise<unknown>) => unknown} [dependencies.background]
 */
export function createGoals({
  resources,
  systemContext,
  runs,
  channel = "agent-goals",
  notices,
  limits = GOAL_LIMITS,
  find,
  respond,
  claim,
  record,
  notify = notifyNoPages,
  owner = noOwnerColumns,
  spent = nothingSpent,
  track = runUnmetered,
  background = leaveRunning
}) {
  assertCallbacks("createGoals", { notify, owner, spent, track, background });
  const channelNotices = notices ?? NO_NOTICES;
  const wake = () => channelNotices.publish(channel, "all", {}).catch(() => {});
  const goals = createGoalsRepository({
    goals: resources.agentGoals,
    options: Object.freeze({ context: systemContext("goal rounds are queued, claimed and carried on in every conversation by any server") })
  });
  const openGoal = (conversationId) => goals.open(conversationId);
  const view = (goal) => goal && { objective: goal.objective, status: goal.status, rounds: goal.rounds, maxRounds: goal.max_rounds, ...(goal.reason ? { reason: goal.reason } : {}) };

  /**
   * What the goal tools do, for one turn in one conversation. Only a turn started by the person can
   * open a goal; another bot's request or a routine can't (DSH P5).
   */
  function operationsFor(row, { human = false, timeZone = "UTC", language = "" } = {}) {
    return {
      async create(objective) {
        if (!human) return { error: "A goal can only be set up in reply to the person's own message." };
        const existing = await openGoal(row.conversation_id);
        if (existing) return { error: "There's already a goal here; read it with get_goal, or update it.", goal: view(existing) };
        const goal = await goals.create({
          ...owner(row), conversation_id: row.conversation_id,
          objective: objective.slice(0, 2000), max_rounds: limits.maxRounds, time_zone: timeZone, language
        });
        await record(row, { text: "Working on a goal", detail: `Goal set: ${goal.objective}` });
        return { status: "created", goal: view(goal), note: "Work on it now. If this turn ends before it's done, you'll get another round to carry on." };
      },
      async get() {
        const goal = await openGoal(row.conversation_id);
        return goal ? { goal: view(goal) } : { goal: null };
      },
      async update({ action, objective, reason }) {
        const goal = await openGoal(row.conversation_id);
        if (!goal) return { error: "There's no open goal here." };
        if (action === "edit") {
          if (!objective) return { error: "Give the new objective." };
          await goals.editObjective(goal.id, objective.slice(0, 2000));
          return { status: "edited" };
        }
        if (action === "pause") {
          await goals.markStatus(goal.id, "paused");
          return { status: "paused", note: "Rounds stop until the person asks you to carry on." };
        }
        if (action === "blocked") {
          if (goal.rounds < limits.minRoundsBeforeBlocked) {
            return { error: `blocked needs at least ${limits.minRoundsBeforeBlocked} rounds of real attempts; this is round ${goal.rounds}. Keep working.` };
          }
          await goals.markStatus(goal.id, "blocked", String(reason || "").slice(0, 1000));
          await record(row, { text: "Goal blocked", detail: `Blocked: ${goal.objective}. ${reason || ""}` });
          return { status: "blocked", note: BLOCKED_NOTE };
        }
        if (action === "complete") {
          await goals.markStatus(goal.id, "complete");
          await record(row, { text: "Goal complete", detail: `Complete: ${goal.objective}` });
          return { status: "complete", note: COMPLETE_NOTE };
        }
        return { error: "Use edit, pause, complete or blocked." };
      }
    };
  }

  /** Opens a goal for a request whose reply ran out of steps or time, so it carries on by itself. */
  function openFor(row, request, options) {
    return operationsFor(row, { ...options, human: true }).create(`Finish what the person asked: ${String(request).slice(0, 1500)}`);
  }

  /** A goal that stops at a limit says so plainly, so the person can ask for more. */
  async function stopAt(goal, reason, detail) {
    await goals.markStatus(goal.id, "blocked", reason);
    const row = await find(goal);
    if (row) {
      await record(row, { text: "Stopped working on the goal", detail: `${detail}: ${goal.objective}. Ask to carry on to continue.` });
      await notify(row, { type: "messages" });
    }
  }

  /** After any turn in a conversation: an active goal gets its next round, unless a limit is reached. */
  async function afterTurn(conversationId) {
    const goal = await goals.active(conversationId);
    if (!goal) return;
    if (goal.rounds >= goal.max_rounds) {
      await stopAt(goal, `Goal reached its limit of ${goal.max_rounds} rounds.`, `Stopped after ${goal.max_rounds} rounds without finishing`);
      return;
    }
    if (limits.costUsd > 0 && await spent(goal) >= limits.costUsd) {
      await stopAt(goal, `Goal reached its cost limit of $${limits.costUsd}.`, `Stopped at the job's cost limit ($${limits.costUsd}) without finishing`);
      return;
    }
    await goals.queueRound(goal.id);
    wake();
    background(runDue());
  }

  /** The person carrying on with a paused goal makes it active again. */
  async function resume(conversationId) {
    await goals.resumePaused(conversationId);
  }

  async function round(goal) {
    const row = await find(goal);
    if (!row) {
      await goals.stopRounds(goal.id);
      return;
    }
    // A person's reply (or anything else) running here goes first; the round waits.
    if (!await claim(row)) {
      await goals.retryLater(goal.id, limits.retryMs / 1000);
      return;
    }
    const keep = setInterval(() => {
      goals.extendLease(goal.id, limits.leaseSeconds).catch(() => {});
      runs.heartbeat(row.conversation_id).catch(() => {});
    }, runs.limits.heartbeatMs);
    const current = await goals.startRound(goal.id, goal.rounds + 1);
    try {
      await notify(row, { type: "working", working: true, status: "Carrying on with the goal" });
      await track(goal, () => respond(row, { timeZone: goal.time_zone, language: goal.language, prompt: roundPrompt(current), goalTurn: true }));
      await goals.finishRound(goal.id);
    } catch (error) {
      // An error stops the rounds (DSH: disarm); the person can ask to carry on.
      console.error(`Goal ${goal.id} round failed: ${error?.message || error}`);
      await goals.stopRounds(goal.id, String(error?.message || error).slice(0, 500));
    } finally {
      clearInterval(keep);
      await runs.release(row.conversation_id).catch(() => {});
      await notify(row, { type: "messages" });
      await notify(row, { type: "working", working: false });
    }
    await afterTurn(goal.conversation_id);
  }

  let running = null;
  function runDue() {
    if (running) return running;
    running = (async () => {
      try {
        for (let count = 0; count < 100; count += 1) {
          const goal = await goals.claimDue(limits.leaseSeconds);
          if (!goal) break;
          await round(goal);
        }
      } catch (error) {
        console.error(`Goals: ${error?.message || error}`);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function start({ everyMs = 5000 } = {}) {
    let stopped = false;
    const tick = () => { if (!stopped) background(runDue()); };
    const timer = setInterval(tick, everyMs);
    timer.unref();
    const unsubscribe = channelNotices.subscribe(channel, "all", () => tick());
    tick();
    return {
      async drain(ms) {
        stopped = true;
        clearInterval(timer);
        unsubscribe();
        await Promise.race([running || Promise.resolve(), new Promise((resolve) => setTimeout(resolve, ms))]);
      }
    };
  }

  return Object.freeze({
    operationsFor,
    openFor,
    afterTurn,
    resume,
    runDue,
    start,
    openGoal
  });
}

async function notifyNoPages() {}

/** A job whose cost nobody meters has spent nothing. */
async function nothingSpent() {
  return 0;
}

/** Runs a goal round's work without metering it. */
function runUnmetered(_goal, work) {
  return work();
}

/** Leaves a round's work running in this process after the turn that queued it. */
function leaveRunning(work) {
  return work;
}

function noOwnerColumns() {
  return {};
}
