import os from "node:os";
import { invitationAsGiven } from "@jskit-ai/auth-core/server/authExtensions";
import { noAppProfiles } from "@jskit-ai/auth-core/server/noAppProfiles";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { resolveLocalAuthConfig } from "../src/server/lib/config.js";
import { createLoggedRecoverySender } from "../src/server/lib/passwordFlows.js";
import { scryptPasswordStrategy } from "../src/server/lib/passwords.js";

/**
 * What a test passes to createLocalAuthService besides its backend: a complete
 * configuration resolved from a test environment, and each collaborator's default.
 * @param {object} [options]
 * @param {Record<string, string>} [options.env] Environment values over the test ones.
 * @param {boolean} [options.emailRecovery] True when the test passes its own recoverySender.
 */
function localServiceOptions({ env = {}, emailRecovery = false } = {}) {
  return {
    config: resolveLocalAuthConfig({
      appRoot: os.tmpdir(),
      env: {
        NODE_ENV: "test",
        AUTH_LOCAL_SESSION_SECRET: "test-session-secret",
        APP_PUBLIC_URL: "http://localhost:5173",
        AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "response",
        ...env
      },
      fileBackend: false,
      emailRecovery
    }),
    invitationContextResolver: invitationAsGiven,
    logger: silentLogger,
    passwordStrategy: scryptPasswordStrategy,
    profileProjector: noAppProfiles,
    recoverySender: createLoggedRecoverySender(silentLogger)
  };
}

export { localServiceOptions };
