import {
  AUTH_OIDC_BACKCHANNEL_LOGOUT_PATH,
  AUTH_OIDC_LOGOUT_PATH
} from "../../shared/index.js";
import { BackchannelLogoutError } from "./backchannelLogout.js";

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const MAX_FORM_BYTES = 16 * 1024;
// These routes authenticate themselves (a signed logout token, the session
// cookie), so the app's CSRF and session policy hooks leave them alone.
const SELF_AUTHENTICATED_ROUTE = Object.freeze({ authPolicy: "public", csrfProtection: false });

function parseForm(_request, body, done) {
  try {
    done(null, Object.fromEntries(new URLSearchParams(String(body || ""))));
  } catch (error) {
    error.statusCode = 400;
    done(error);
  }
}

// A link on another site must not sign this browser out.
function isCrossSiteNavigation(request) {
  const site = String(request.headers?.["sec-fetch-site"] || "").trim().toLowerCase();
  return site !== "" && site !== "same-origin" && site !== "none";
}

/**
 * Registers the two OIDC routes in their own Fastify scope, so the form-body
 * parser the back-channel route needs applies to it alone.
 */
async function registerOidcRoutes(fastify, { authService, backchannelLogout }) {
  await fastify.register(async (scope) => {
    scope.addContentTypeParser(FORM_CONTENT_TYPE, { parseAs: "string", bodyLimit: MAX_FORM_BYTES }, parseForm);

    scope.post(AUTH_OIDC_BACKCHANNEL_LOGOUT_PATH, { config: SELF_AUTHENTICATED_ROUTE }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        await backchannelLogout.handle(request.body?.logout_token);
      } catch (error) {
        if (!(error instanceof BackchannelLogoutError)) throw error;
        request.log?.warn?.({ reason: error.message }, "OIDC back-channel logout was refused.");
        return reply.code(400).send({ error: "invalid_request", error_description: error.message });
      }
      return reply.code(200).send();
    });

    scope.get(AUTH_OIDC_LOGOUT_PATH, { config: SELF_AUTHENTICATED_ROUTE }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (isCrossSiteNavigation(request)) return reply.redirect("/");
      const destination = await authService.logoutEverywhere(request, {
        everywhere: String(request.query?.everywhere || "") === "1"
      });
      authService.clearSessionCookies(reply);
      return reply.redirect(destination);
    });
  });
}

export { registerOidcRoutes };
