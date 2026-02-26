import { createActionRegistry, createPermissionEvaluator } from "@jskit-ai/action-runtime-core";
import { createActionIdempotencyAdapter } from "./idempotencyAdapters.js";
import { createActionAuditAdapter } from "./auditAdapters.js";
import { createActionObservabilityAdapter } from "./observabilityAdapters.js";

function createRuntimeActionRegistry({ contributors, services, logger = console } = {}) {
  return createActionRegistry({
    contributors,
    permissionEvaluator: createPermissionEvaluator(),
    idempotencyAdapter: createActionIdempotencyAdapter(),
    auditAdapter: createActionAuditAdapter({
      auditService: services?.auditService,
      logger
    }),
    observabilityAdapter: createActionObservabilityAdapter({
      observabilityService: services?.observabilityService,
      logger
    }),
    logger
  });
}

export { createRuntimeActionRegistry };
