export { createLocalAuthService } from "./service.js";
export { createLocalFileBackend } from "./fileBackend.js";
export {
  LOCAL_AUTH_USER_REGISTERED_EVENT,
  createLocalAuthRegisterHookDecorator
} from "./registerHookDecorator.js";
export { hashPassword, normalizePasswordStrategy, verifyPassword } from "./passwords.js";
