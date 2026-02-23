export { createEntitlementsService } from "./service.js";

export {
  ENTITLEMENT_TYPES,
  DEFAULT_SUBJECT_TYPE,
  normalizeAmount,
  normalizeBalanceRow,
  normalizeCodes,
  normalizeSubjectType,
  toDateOrNull,
  toNonEmptyString,
  toPositiveInteger
} from "./entities.js";

export { createEntitlementsPolicy, LIFETIME_WINDOW_START, LIFETIME_WINDOW_END } from "./policies.js";

export {
  ENTITLEMENTS_ERROR_CODES,
  EntitlementsError,
  EntitlementsValidationError,
  EntitlementNotConfiguredError,
  isEntitlementsError
} from "./errors.js";

export {
  REQUIRED_REPOSITORY_METHODS,
  OPTIONAL_REPOSITORY_METHODS,
  RECOMPUTE_SUPPORT_METHODS,
  validateEntitlementsRepository,
  assertEntitlementsRepository
} from "./contracts/repository.js";

export { SYSTEM_CLOCK, validateClock, assertClock, resolveClock } from "./contracts/clock.js";

export { LOGGER_METHODS, NOOP_LOGGER, validateLogger, assertLogger, resolveLogger } from "./contracts/logger.js";
