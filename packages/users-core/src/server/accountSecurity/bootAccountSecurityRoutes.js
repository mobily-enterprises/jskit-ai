import { createSchema } from "json-rest-schema";
import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { resolveAccountSettingsResourceId } from "../common/support/accountSettingsJsonApiTransport.js";

const passwordChangeMetaOutputValidator = deepFreeze({
  schema: createSchema({
    message: {
      type: "string",
      required: true,
      minLength: 1
    }
  }),
  mode: "replace"
});

function bootAccountSecurityRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootAccountSecurityRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");

  router.register(
    "POST",
    "/api/settings/security/change-password",
    {
      auth: "required",
      meta: {
        tags: ["settings"],
        summary: "Set or change authenticated user's password"
      },
      ...createJsonApiResourceRouteContract({
        requestType: "user-password-changes",
        body: userSettingsResource.operations.passwordChange.body,
        output: passwordChangeMetaOutputValidator,
        outputKind: "meta",
        includeValidation400: true
      }),
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

      const authService = app.make("authService");
      if (result?.session && typeof authService.writeSessionCookies === "function") {
        authService.writeSessionCookies(reply, result.session);
      }

      reply.code(200).send(result?.response || result);
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
      ...createJsonApiResourceRouteContract({
        requestType: "user-password-method-settings",
        responseType: "user-security-settings",
        body: userSettingsResource.operations.passwordMethodToggle.body,
        output: userSettingsResource.operations.passwordMethodToggle.output,
        outputKind: "record",
        getRecordId: resolveAccountSettingsResourceId,
        includeValidation400: true
      }),
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
      responses: withStandardErrorResponses(
        {
          302: userSettingsResource.operations.oauthLinkStart.output
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
      ...createJsonApiResourceRouteContract({
        responseType: "user-security-settings",
        output: userSettingsResource.operations.oauthUnlink.output,
        outputKind: "record",
        getRecordId: resolveAccountSettingsResourceId,
        includeValidation400: true
      }),
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
      ...createJsonApiResourceRouteContract({
        responseType: "user-security-session-operations",
        outputKind: "no-content",
        successStatus: 204
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
      reply.code(204).send(response);
    }
  );
}

export { bootAccountSecurityRoutes };
