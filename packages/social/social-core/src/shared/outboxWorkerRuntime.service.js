import { ACTION_IDS } from "@jskit-ai/action-runtime-core/actionIds";

function toMs(seconds, fallbackSeconds = 1) {
  const normalizedSeconds = Math.max(1, Number(seconds) || Number(fallbackSeconds) || 1);
  return normalizedSeconds * 1000;
}

function createSocialOutboxWorkerRuntimeService({
  enabled = false,
  federationEnabled = false,
  actionExecutor = null,
  socialRepository = null,
  logger = console,
  pollSeconds = 10,
  workspaceBatchSize = 25
} = {}) {
  const workerEnabled = enabled === true && federationEnabled === true;
  if (!workerEnabled) {
    return {
      start() {},
      stop() {},
      isStarted() {
        return false;
      }
    };
  }

  if (!actionExecutor || typeof actionExecutor.execute !== "function") {
    throw new Error("actionExecutor.execute is required for social outbox worker runtime.");
  }
  if (typeof socialRepository?.outboxDeliveries?.listReadyWorkspaceIds !== "function") {
    throw new Error("socialRepository.outboxDeliveries.listReadyWorkspaceIds is required for social outbox worker runtime.");
  }

  let started = false;
  let timer = null;
  let isTickRunning = false;

  function logInfo(payload, message) {
    if (logger && typeof logger.info === "function") {
      logger.info(payload, message);
    }
  }

  function logWarn(payload, message) {
    if (logger && typeof logger.warn === "function") {
      logger.warn(payload, message);
    }
  }

  async function tick() {
    if (isTickRunning) {
      return;
    }

    isTickRunning = true;
    try {
      const readyWorkspaceIds = await socialRepository.outboxDeliveries.listReadyWorkspaceIds({
        now: new Date(),
        limit: Math.max(1, Number(workspaceBatchSize) || 25)
      });

      for (const workspaceIdValue of readyWorkspaceIds) {
        const workspaceId = Number(workspaceIdValue);
        if (!Number.isInteger(workspaceId) || workspaceId < 1) {
          continue;
        }

        try {
          await actionExecutor.execute({
            actionId: ACTION_IDS.SOCIAL_FEDERATION_OUTBOX_DELIVERIES_PROCESS,
            input: {
              workspaceId
            },
            context: {
              channel: "worker",
              surface: "app",
              workspace: {
                id: workspaceId,
                slug: `workspace-${workspaceId}`
              }
            }
          });
        } catch (error) {
          logWarn(
            {
              workspaceId,
              error: String(error?.message || error)
            },
            "social.worker.outbox.workspace_failed"
          );
        }
      }
    } catch (error) {
      logWarn(
        {
          error: String(error?.message || error)
        },
        "social.worker.outbox.tick_failed"
      );
    } finally {
      isTickRunning = false;
    }
  }

  function start() {
    if (started) {
      return;
    }

    const run = () => {
      void tick();
    };

    timer = setInterval(run, toMs(pollSeconds, 10));
    timer.unref?.();
    run();
    started = true;

    logInfo(
      {
        pollSeconds: Math.max(1, Number(pollSeconds) || 10),
        workspaceBatchSize: Math.max(1, Number(workspaceBatchSize) || 25)
      },
      "social.worker.outbox.started"
    );
  }

  function stop() {
    if (!started) {
      return;
    }

    if (timer) {
      clearInterval(timer);
    }
    timer = null;
    started = false;
    isTickRunning = false;

    logInfo({}, "social.worker.outbox.stopped");
  }

  function isStarted() {
    return started;
  }

  return {
    start,
    stop,
    isStarted
  };
}

export { createSocialOutboxWorkerRuntimeService };
