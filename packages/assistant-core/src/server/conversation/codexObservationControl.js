import {
  codexAppServerTurnStatusIsSuccessfulComplete,
  codexAppServerThreadStatus,
  codexAppServerAgentRun,
  codexAppServerTurnOwnsActiveGoal,
  codexAppServerConversationTurnIsActive,
  CODEX_APP_SERVER_AGENT_RUN_ID,
  CODEX_APP_SERVER_RUN_STATE
} from "./codexTurnState.js";

// Original observation-loss barriers, stop settlement and saved-stop inspection.
// The shared conversation registry and journal remain their existing owners.
export function createCodexObservationControl({
  conversations,
  output,
  journal,
  namespace,
  createRuntime,
  publish,
  runInContext,
  turnState,
  errorPrefix
}) {
  const { codexAppServerConversations } = conversations;
  const { readAgentRunForSession: readCodexAppServerAgentRunForSession } = output;
  const {
    agentRunRealtimePayload: codexAppServerAgentRunRealtimePayload,
    clearActiveTimer: clearCodexAppServerActiveTimer
  } = journal;

  function assertCodexAppServerThreadCanResume(run, threadId) {
    if (run?.providerThreadId === threadId && run.providerStatus === "observation_lost") {
      throw Object.assign(new Error(run.error || "Codex is stopped. Use Resume or Send to continue."), {
        code: `${errorPrefix}codex_observation_lost`
      });
    }
  }

  function createCodexAppServerObservation(sessionId, context = {}) {
    const { projectContext, target, retireProvider } = context;
    return {
      prepare({ provider, error }) {
        return runInContext(projectContext, async () => {
          const managed = target(error);
          const threads = new Map();
          for (const entry of codexAppServerConversations.get(namespace(sessionId))?.values() || []) {
            if (entry.provider !== provider) continue;
            threads.set(entry.conversationId, entry.runId);
            if (codexAppServerConversationTurnIsActive(entry.status) || entry.goal?.status === "active") {
              entry.error = managed.pendingMessage;
            }
          }
          // A helper owns only its own threads. Main chat belongs to its managed provider.
          if (managed.threadId) {
            const runtime = await createRuntime();
            const turn = turnState(await runtime.getSession(sessionId));
            threads.set(managed.threadId, turn.turnId);
            if (turn.active || codexAppServerTurnOwnsActiveGoal(turn, managed.threadId)) {
              await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
                event: { kind: "observation-lost", message: error.message },
                patch: { providerStatus: "observation_lost", error: managed.pendingMessage }
              });
              await publish(sessionId, { reason: "codex-observation-lost" });
            }
          }
          return threads;
        });
      },
      barrier({ error }) {
        return runInContext(projectContext, async () => {
          const managed = target(error);
          if (!managed.threadId) return;
          const runtime = await createRuntime();
          const turn = turnState(await runtime.getSession(sessionId));
          if (!turn.active && !codexAppServerTurnOwnsActiveGoal(turn, managed.threadId)) return;
          await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
            event: { kind: "observation-lost", message: error.message },
            patch: { providerStatus: "observation_lost", error: managed.pendingMessage }
          });
        });
      },
      complete({ provider, error, sharedStop }) {
        return runInContext(projectContext, async () => {
          const managed = target(error);
          let stoppedRun = null;
          let conversationStream = null;
          if (managed.threadId) {
            const runtime = await createRuntime();
            stoppedRun = await runtime.store.mutateSession(sessionId, async () => {
              const run = await readCodexAppServerAgentRunForSession(runtime.store, sessionId);
              if (run?.providerThreadId !== managed.threadId || run.providerStatus !== "observation_lost") return null;
              const stopped = await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
                event: { kind: "codex-observation-stopped", state: CODEX_APP_SERVER_RUN_STATE.INTERRUPTED },
                patch: {
                  error: sharedStop ? `${managed.message} Its shared service was stopped, affecting other sessions using it.` : managed.message,
                  providerStatus: "observation_lost", state: CODEX_APP_SERVER_RUN_STATE.INTERRUPTED
                }
              });
              conversationStream = runtime.store.clearConversationStream(sessionId);
              return stopped;
            });
          }
          // Retain the stop owner until the stopped state is durable. Make the
          // provider ready for explicit control before publishing that state.
          if (sharedStop) await retireProvider(provider);
          else provider.observationFailure = null;
          for (const entry of codexAppServerConversations.get(namespace(sessionId))?.values() || []) {
            if (entry.provider === provider && (
              codexAppServerConversationTurnIsActive(entry.status) || entry.goal?.status === "active"
            )) {
              entry.status = "interrupted";
              entry.error = managed.message;
              entry.watcher?.failNow(error);
            }
          }
          if (stoppedRun) {
            await publish(sessionId, {
              payload: { ...codexAppServerAgentRunRealtimePayload(stoppedRun), conversationStream },
              reason: "codex-observation-stopped"
            });
          }
        });
      }
    };
  }

  async function recoverCodexAppServerObservationLoss(runtime, session, context = {}) {
    const sessionId = session.sessionId;
    const current = await runtime.getSession(sessionId);
    const turn = turnState(current);
    if (turn.status !== "observation_lost" || !turn.active) return current;
    const threadId = context.threadId(current);
    if (!threadId || (turn.threadId && turn.threadId !== threadId)) return current;

    // Reconnect only to inspect. Resuming a thread could restart its goal.
    const provider = await context.acquireProvider(current);
    const { goal } = await provider.readGoal(threadId);
    if (goal !== null && !["paused", "complete"].includes(goal?.status)) return current;
    const status = codexAppServerThreadStatus(await provider.readThreadStatus(threadId));
    if (!codexAppServerTurnStatusIsSuccessfulComplete(status)) return current;

    const stoppedRun = await runtime.store.mutateSession(sessionId, async () => {
      const latest = await readCodexAppServerAgentRunForSession(runtime.store, sessionId);
      if (JSON.stringify(latest) !== JSON.stringify(codexAppServerAgentRun(current))) return null;
      return runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: { kind: "codex-observation-stop-recovered", message: "Codex confirmed that the conversation is stopped." },
        patch: {
          error: "",
          providerThreadId: threadId,
          providerGoalThreadId: threadId,
          providerGoalStatus: goal?.status || "",
          state: CODEX_APP_SERVER_RUN_STATE.INTERRUPTED
        }
      });
    });
    if (stoppedRun) {
      clearCodexAppServerActiveTimer(sessionId);
      await publish(sessionId, {
        payload: {
          ...codexAppServerAgentRunRealtimePayload(stoppedRun),
          conversationStream: runtime.store.clearConversationStream(sessionId)
        },
        reason: "codex-observation-stop-recovered"
      });
    }
    return runtime.getSession(sessionId);
  }

  return {
    assertThreadCanResume: assertCodexAppServerThreadCanResume,
    createObservation: createCodexAppServerObservation,
    recoverObservationLoss: recoverCodexAppServerObservationLoss
  };
}
