export { createLocalAuthService } from "./service.js";
export { resolveLocalAuthConfig } from "./config.js";
export { createLoggedConfirmationSender } from "./emailConfirmation.js";
export { createLoggedRecoverySender } from "./passwordFlows.js";
export { createLocalFileBackend } from "./fileBackend.js";
export {
  LOCAL_AUTH_USER_REGISTERED_EVENT,
  createLocalAuthRegisterHookDecorator
} from "./registerHookDecorator.js";
export { hashPassword, normalizePasswordStrategy, scryptPasswordStrategy, verifyPassword } from "./passwords.js";
