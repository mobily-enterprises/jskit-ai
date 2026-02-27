import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { normalizePagination } from "@jskit-ai/server-runtime-core/pagination";
import { createConsoleErrorPayloadNormalizer, SERVER_SIMULATION_KINDS } from "@jskit-ai/observability-core/serverPayload";
import { hasPermission, resolveRolePermissions } from "@jskit-ai/workspace-console-core/consoleRoles";

const BROWSER_ERRORS_READ_PERMISSION = "console.errors.browser.read";
const SERVER_ERRORS_READ_PERMISSION = "console.errors.server.read";
const payloadNormalizer = createConsoleErrorPayloadNormalizer({
  parsePositiveInteger
});
const { normalizeBrowserPayload, normalizeServerPayload } = payloadNormalizer;

function normalizeErrorEntryId(value) {
  const errorId = parsePositiveInteger(value);
  if (!errorId) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          errorId: "errorId must be a positive integer."
        }
      }
    });
  }

  return errorId;
}

function normalizeSimulationKind(value) {
  const normalized = payloadNormalizer.normalizeSimulationKind(value);
  if (normalized) {
    return normalized;
  }

  throw new AppError(400, "Validation failed.", {
    details: {
      fieldErrors: {
        kind: `kind must be one of: ${SERVER_SIMULATION_KINDS.join(", ")}, auto`
      }
    }
  });
}

function createSimulationId() {
  return payloadNormalizer.createSimulationId();
}

function recordIngestionMetric(observabilityService, { source, outcome }) {
  if (!observabilityService || typeof observabilityService.recordConsoleErrorIngestion !== "function") {
    return;
  }

  observabilityService.recordConsoleErrorIngestion({
    source,
    outcome
  });
}

function createService({ consoleMembershipsRepository, consoleErrorLogsRepository, observabilityService }) {
  if (!consoleMembershipsRepository || !consoleErrorLogsRepository) {
    throw new Error("console error service repositories are required.");
  }

  async function requirePermission(user, permission) {
    const userId = parsePositiveInteger(user?.id);
    if (!userId) {
      throw new AppError(401, "Authentication required.");
    }

    const membership = await consoleMembershipsRepository.findByUserId(userId);
    if (!membership || membership.status !== "active") {
      throw new AppError(403, "Forbidden.");
    }

    const permissions = resolveRolePermissions(membership.roleId);
    if (!hasPermission(permissions, permission)) {
      throw new AppError(403, "Forbidden.");
    }

    return {
      userId,
      membership,
      permissions
    };
  }

  async function listBrowserErrors(user, pagination) {
    await requirePermission(user, BROWSER_ERRORS_READ_PERMISSION);
    const { page, pageSize } = normalizePagination(pagination, {
      defaultPage: 1,
      defaultPageSize: 20,
      maxPageSize: 100
    });

    const total = await consoleErrorLogsRepository.countBrowserErrors();
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const entries = await consoleErrorLogsRepository.listBrowserErrors(safePage, pageSize);

    return {
      entries,
      page: safePage,
      pageSize,
      total,
      totalPages
    };
  }

  async function getBrowserError(user, errorIdValue) {
    await requirePermission(user, BROWSER_ERRORS_READ_PERMISSION);
    const errorId = normalizeErrorEntryId(errorIdValue);
    const entry = await consoleErrorLogsRepository.getBrowserErrorById(errorId);
    if (!entry) {
      throw new AppError(404, "Browser error entry not found.");
    }

    return { entry };
  }

  async function listServerErrors(user, pagination) {
    await requirePermission(user, SERVER_ERRORS_READ_PERMISSION);
    const { page, pageSize } = normalizePagination(pagination, {
      defaultPage: 1,
      defaultPageSize: 20,
      maxPageSize: 100
    });

    const total = await consoleErrorLogsRepository.countServerErrors();
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const entries = await consoleErrorLogsRepository.listServerErrors(safePage, pageSize);

    return {
      entries,
      page: safePage,
      pageSize,
      total,
      totalPages
    };
  }

  async function getServerError(user, errorIdValue) {
    await requirePermission(user, SERVER_ERRORS_READ_PERMISSION);
    const errorId = normalizeErrorEntryId(errorIdValue);
    const entry = await consoleErrorLogsRepository.getServerErrorById(errorId);
    if (!entry) {
      throw new AppError(404, "Server error entry not found.");
    }

    return { entry };
  }

  async function recordBrowserError({ payload, user }) {
    const normalizedPayload = normalizeBrowserPayload(payload, user);
    try {
      const result = await consoleErrorLogsRepository.insertBrowserError(normalizedPayload);
      recordIngestionMetric(observabilityService, {
        source: "browser",
        outcome: "success"
      });
      return result;
    } catch (error) {
      recordIngestionMetric(observabilityService, {
        source: "browser",
        outcome: "failure"
      });
      throw error;
    }
  }

  async function recordServerError(payload) {
    const normalizedPayload = normalizeServerPayload(payload);
    try {
      const result = await consoleErrorLogsRepository.insertServerError(normalizedPayload);
      recordIngestionMetric(observabilityService, {
        source: "server",
        outcome: "success"
      });
      return result;
    } catch (error) {
      recordIngestionMetric(observabilityService, {
        source: "server",
        outcome: "failure"
      });
      throw error;
    }
  }

  async function simulateServerError({ user, payload }) {
    await requirePermission(user, SERVER_ERRORS_READ_PERMISSION);
    const kind = normalizeSimulationKind(payload?.kind);
    const simulationId = createSimulationId();
    const marker = `[simulated-server-error:${simulationId}]`;

    if (kind === "app_error") {
      throw new AppError(500, `${marker} Simulated AppError failure.`, {
        details: {
          simulationId,
          kind,
          trigger: "console_server_errors_screen"
        }
      });
    }

    if (kind === "type_error") {
      const nil = null;
      nil.invoke();
    }

    if (kind === "range_error") {
      throw new RangeError(`${marker} Simulated RangeError failure.`);
    }

    await Promise.reject(new Error(`${marker} Simulated async rejection failure.`));
  }

  return {
    listBrowserErrors,
    getBrowserError,
    listServerErrors,
    getServerError,
    recordBrowserError,
    recordServerError,
    simulateServerError
  };
}

export {
  BROWSER_ERRORS_READ_PERMISSION,
  SERVER_ERRORS_READ_PERMISSION,
  SERVER_SIMULATION_KINDS,
  normalizePagination,
  normalizeErrorEntryId,
  normalizeBrowserPayload,
  normalizeServerPayload,
  normalizeSimulationKind,
  createService
};
