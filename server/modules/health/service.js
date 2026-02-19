function normalizeUptimeSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function createService(options) {
  const healthRepository = options?.healthRepository;
  const now = typeof options?.now === "function" ? options.now : () => new Date();
  const uptimeSeconds =
    typeof options?.uptimeSeconds === "function" ? options.uptimeSeconds : () => normalizeUptimeSeconds(process.uptime());

  if (!healthRepository || typeof healthRepository.checkDatabase !== "function") {
    throw new Error("healthRepository.checkDatabase is required.");
  }

  function buildBaseSnapshot({ ok, status }) {
    return {
      ok,
      status,
      timestamp: now().toISOString(),
      uptimeSeconds: normalizeUptimeSeconds(uptimeSeconds())
    };
  }

  async function health() {
    return buildBaseSnapshot({
      ok: true,
      status: "ok"
    });
  }

  async function readiness() {
    try {
      await healthRepository.checkDatabase();
      return {
        ...buildBaseSnapshot({
          ok: true,
          status: "ok"
        }),
        dependencies: {
          database: "up"
        }
      };
    } catch {
      return {
        ...buildBaseSnapshot({
          ok: false,
          status: "degraded"
        }),
        dependencies: {
          database: "down"
        }
      };
    }
  }

  return {
    health,
    readiness
  };
}

const __testables = {
  normalizeUptimeSeconds
};

export { createService, __testables };
