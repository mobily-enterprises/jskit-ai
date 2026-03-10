import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { settingsRoutesContract as settingsSchema } from "../common/contracts/settingsRoutesContract.js";
import { inputParts } from "../common/contracts/inputParts.js";
import { routeQueries } from "../common/contracts/routeQueries.js";

function registerAccountSecurityRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerAccountSecurityRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const authService = app.make("authService");

  router.register(
    "POST",
    "/api/settings/security/change-password",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Set or change authenticated user's password"
      },
      body: {
        schema: settingsSchema.body.changePassword,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: settingsSchema.commands["settings.security.password.change"].operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      }
    },
    async function (request, reply) {
      const result = await request.executeAction({
        actionId: "settings.security.password.change",
        input: request.input.body
      });

      if (result?.session && typeof authService.writeSessionCookies === "function") {
        authService.writeSessionCookies(reply, result.session);
      }

      reply.code(200).send({
        ok: true,
        message: result?.message || "Password updated."
      });
    }
  );

  router.register(
    "PATCH",
    "/api/settings/security/methods/password",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Enable or disable password sign-in method"
      },
      body: {
        schema: settingsSchema.body.passwordMethodToggle,
        normalize: normalizeObjectInput
      },
      response: withStandardErrorResponses(
        {
          200: settingsSchema.commands["settings.security.password_method.toggle"].operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      }
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "settings.security.password_method.toggle",
        input: request.input.body
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    "/api/settings/security/oauth/:provider/start",
    {
      auth: "required",
      csrfProtection: false,
      meta: {
        tags: ["settings"],
        summary: "Start linking an OAuth provider for authenticated user"
      },
      params: inputParts.routeParams,
      query: routeQueries.oauthReturnTo,
      response: withStandardErrorResponses(
        {
          302: { schema: Type.Unknown() }
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      }
    },
    async function (request, reply) {
      const params = normalizeObjectInput(request?.input?.params);
      const query = normalizeObjectInput(request?.input?.query);
      const provider = params.provider;
      const returnTo = normalizeText(query.returnTo);
      const result = await request.executeAction({
        actionId: "settings.security.oauth.link.start",
        input: {
          provider,
          returnTo: returnTo || undefined
        }
      });

      reply.redirect(result.url);
    }
  );

  router.register(
    "DELETE",
    "/api/settings/security/oauth/:provider",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Unlink an OAuth provider from authenticated account"
      },
      params: inputParts.routeParams,
      response: withStandardErrorResponses(
        {
          200: settingsSchema.commands["settings.security.oauth.unlink"].operation.response
        },
        { includeValidation400: true }
      ),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      }
    },
    async function (request, reply) {
      const params = normalizeObjectInput(request?.input?.params);
      const provider = params.provider;
      const response = await request.executeAction({
        actionId: "settings.security.oauth.unlink",
        input: {
          provider
        }
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    "/api/settings/security/logout-others",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Sign out from other active sessions"
      },
      response: withStandardErrorResponses({
        200: settingsSchema.commands["settings.security.sessions.logout_others"].operation.response
      }),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      }
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "settings.security.sessions.logout_others"
      });
      reply.code(200).send(response);
    }
  );
}

export { registerAccountSecurityRoutes };
