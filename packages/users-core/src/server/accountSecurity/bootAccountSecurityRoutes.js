import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";

function bootAccountSecurityRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootAccountSecurityRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");
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
      responses: withStandardErrorResponses(
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
        input: {
          payload: request.input.body
        }
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
      responses: withStandardErrorResponses(
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
        input: {
          payload: request.input.body
        }
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
      responses: withStandardErrorResponses(
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
          provider: request.input.params.provider,
          returnTo: request.input.query.returnTo
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
      responses: withStandardErrorResponses(
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
        input: {
          provider: request.input.params.provider
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
      responses: withStandardErrorResponses({
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
