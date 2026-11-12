import {
  ACTION_CONFIRM_SECOND_FACTOR_SETUP,
  ACTION_READ_SECOND_FACTOR,
  ACTION_REMOVE_SECOND_FACTOR,
  ACTION_REPLACE_SECOND_FACTOR_RECOVERY_CODES,
  ACTION_START_SECOND_FACTOR_SETUP,
  ACTION_VERIFY_SECOND_FACTOR
} from "@jskit-ai/auth-core/server/actions/secondFactorActions";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import {
  authSecondFactorReadCommand,
  authSecondFactorRecoveryCodesReplaceCommand,
  authSecondFactorRemoveCommand,
  authSecondFactorSetupConfirmCommand,
  authSecondFactorSetupStartCommand,
  authSecondFactorVerifyCommand
} from "@jskit-ai/auth-core/shared/commands";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";

/**
 * The signed-in person's second factor: reading it, setting up an
 * authenticator, proving a code for this session, and replacing the recovery
 * codes or removing the authenticator with a proof. Each route runs its
 * auth.secondFactor action, limited per client address by its entry in
 * `rateLimits` (none when that entry is null); the provider also makes an
 * account wait after wrong codes.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeRouter} router
 * @param {{ rateLimits: import("../types.js").AuthRateLimits }} dependencies
 */
function registerSecondFactorRoutes(router, { rateLimits }) {
  router.register(
    "GET",
    AUTH_PATHS.SECOND_FACTOR,
    {
      auth: "required",
      meta: { tags: ["auth"], summary: "Read the account's second factor and when this session proved it" },
      responses: withStandardErrorResponses({ 200: authSecondFactorReadCommand.operation.response })
    },
    async function (request, reply) {
      reply.code(200).send(await request.executeAction({ actionId: ACTION_READ_SECOND_FACTOR }));
    }
  );

  router.register(
    "POST",
    AUTH_PATHS.SECOND_FACTOR_SETUP,
    {
      auth: "required",
      meta: { tags: ["auth"], summary: "Start setting up an authenticator app: its secret, shown once" },
      responses: withStandardErrorResponses({ 200: authSecondFactorSetupStartCommand.operation.response }),
      rateLimit: rateLimits.secondFactorSetup
    },
    async function (request, reply) {
      reply.code(200).send(await request.executeAction({ actionId: ACTION_START_SECOND_FACTOR_SETUP }));
    }
  );

  router.register(
    "POST",
    AUTH_PATHS.SECOND_FACTOR_SETUP_CONFIRM,
    {
      auth: "required",
      meta: { tags: ["auth"], summary: "Confirm the authenticator with its first code: the recovery codes, shown once" },
      body: authSecondFactorSetupConfirmCommand.operation.body,
      responses: withStandardErrorResponses(
        { 200: authSecondFactorSetupConfirmCommand.operation.response },
        { includeValidation400: true }
      ),
      rateLimit: rateLimits.secondFactorSetupConfirm
    },
    async function (request, reply) {
      reply.code(200).send(await request.executeAction({ actionId: ACTION_CONFIRM_SECOND_FACTOR_SETUP, input: request.input.body }));
    }
  );

  router.register(
    "POST",
    AUTH_PATHS.SECOND_FACTOR_VERIFY,
    {
      auth: "required",
      meta: { tags: ["auth"], summary: "Prove the second factor for this session with a code or a recovery code" },
      body: authSecondFactorVerifyCommand.operation.body,
      responses: withStandardErrorResponses(
        { 200: authSecondFactorVerifyCommand.operation.response },
        { includeValidation400: true }
      ),
      rateLimit: rateLimits.secondFactorVerify
    },
    async function (request, reply) {
      reply.code(200).send(await request.executeAction({ actionId: ACTION_VERIFY_SECOND_FACTOR, input: request.input.body }));
    }
  );

  router.register(
    "POST",
    AUTH_PATHS.SECOND_FACTOR_RECOVERY_CODES,
    {
      auth: "required",
      meta: { tags: ["auth"], summary: "Replace the recovery codes, with a proof: the new codes, shown once" },
      body: authSecondFactorRecoveryCodesReplaceCommand.operation.body,
      responses: withStandardErrorResponses(
        { 200: authSecondFactorRecoveryCodesReplaceCommand.operation.response },
        { includeValidation400: true }
      ),
      rateLimit: rateLimits.secondFactorRecoveryCodes
    },
    async function (request, reply) {
      reply.code(200).send(await request.executeAction({
        actionId: ACTION_REPLACE_SECOND_FACTOR_RECOVERY_CODES,
        input: request.input.body
      }));
    }
  );

  router.register(
    "DELETE",
    AUTH_PATHS.SECOND_FACTOR,
    {
      auth: "required",
      meta: { tags: ["auth"], summary: "Remove the authenticator, with a proof" },
      body: authSecondFactorRemoveCommand.operation.body,
      responses: withStandardErrorResponses(
        { 200: authSecondFactorRemoveCommand.operation.response },
        { includeValidation400: true }
      ),
      rateLimit: rateLimits.secondFactorRemove
    },
    async function (request, reply) {
      reply.code(200).send(await request.executeAction({ actionId: ACTION_REMOVE_SECOND_FACTOR, input: request.input.body }));
    }
  );
}

export { registerSecondFactorRoutes };
