import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";

function bootAccountSecurityRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootAccountSecurityRoutes requires application make().");
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
      body: userSettingsResource.operations.passwordChange.body,
      response: withStandardErrorResponses(
        {
          200: userSettingsResource.operations.passwordChange.output
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
      body: userSettingsResource.operations.passwordMethodToggle.body,
      response: withStandardErrorResponses(
        {
          200: userSettingsResource.operations.passwordMethodToggle.output
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
      params: userSettingsResource.operations.oauthLinkStart.params,
      query: userSettingsResource.operations.oauthLinkStart.query,
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
      const result = await request.executeAction({
        actionId: "settings.security.oauth.link.start",
        input: {
          ...request.input.params,
          ...request.input.query
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
      params: userSettingsResource.operations.oauthUnlink.params,
      response: withStandardErrorResponses(
        {
          200: userSettingsResource.operations.oauthUnlink.output
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
        actionId: "settings.security.oauth.unlink",
        input: request.input.params
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
        200: userSettingsResource.operations.logoutOtherSessions.output
      }),
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      }
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "settings.security.sessions.logout_others",
        input: {}
      });
      reply.code(200).send(response);
    }
  );
}

export { bootAccountSecurityRoutes };
