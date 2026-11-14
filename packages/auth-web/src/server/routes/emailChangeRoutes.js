import {
  ACTION_CONFIRM_EMAIL_CHANGE,
  ACTION_REQUEST_EMAIL_CHANGE
} from "@jskit-ai/auth-core/server/actions/emailChangeActions";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { authEmailChangeConfirmCommand, authEmailChangeRequestCommand } from "@jskit-ai/auth-core/shared/commands";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";

/**
 * An account's email change: the signed-in person asks for a new address with their password, and the link sent to
 * it confirms the change, from a browser signed in or not. Each route runs its auth.emailChange action, limited per
 * client address by its entry in `rateLimits` (none when that entry is null).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeRouter} router
 * @param {{ rateLimits: import("../types.js").AuthRateLimits }} dependencies
 */
function registerEmailChangeRoutes(router, { rateLimits }) {
  router.register(
    "POST",
    AUTH_PATHS.EMAIL_CHANGE,
    {
      auth: "required",
      meta: { tags: ["auth"], summary: "Ask to change the signed-in account's email: a link goes to the new address" },
      body: authEmailChangeRequestCommand.operation.body,
      responses: withStandardErrorResponses(
        { 200: authEmailChangeRequestCommand.operation.response },
        { includeValidation400: true }
      ),
      rateLimit: rateLimits.emailChange
    },
    async function (request, reply) {
      reply.code(200).send(await request.executeAction({ actionId: ACTION_REQUEST_EMAIL_CHANGE, input: request.input.body }));
    }
  );

  router.register(
    "POST",
    AUTH_PATHS.EMAIL_CHANGE_CONFIRM,
    {
      auth: "public",
      meta: { tags: ["auth"], summary: "Confirm an email change with the link sent to the new address" },
      body: authEmailChangeConfirmCommand.operation.body,
      responses: withStandardErrorResponses(
        { 200: authEmailChangeConfirmCommand.operation.response },
        { includeValidation400: true }
      ),
      rateLimit: rateLimits.emailChangeConfirm
    },
    async function (request, reply) {
      reply.code(200).send(await request.executeAction({ actionId: ACTION_CONFIRM_EMAIL_CHANGE, input: request.input.body }));
    }
  );
}

export { registerEmailChangeRoutes };
