export { authPolicyPlugin } from "./plugin.js";
export { withAuthPolicy, mergeAuthPolicy } from "./routeMeta.js";
export {
  createAuthIdentityId,
  normalizeAuthActor,
  buildLegacyProfileFromActor,
  normalizeAuthResult
} from "../authActor.js";
export {
  AUTH_OPERATION_UNSUPPORTED_CODE,
  createUnsupportedAuthOperationError,
  throwUnsupportedAuthOperation,
  isUnsupportedAuthOperationError
} from "../unsupportedOperation.js";
