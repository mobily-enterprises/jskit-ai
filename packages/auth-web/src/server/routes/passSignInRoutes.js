import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const MAX_FORM_BYTES = 8 * 1024;

function parseForm(_request, body, done) {
  done(null, Object.fromEntries(new URLSearchParams(String(body || ""))));
}

/**
 * Registers `POST /api/login/pass`, where the issuer's page makes the browser POST a one-time signed pass as the form
 * field `pass` (a POST, so the pass never sits in an address, a history or a log). The pass authenticates the request,
 * so the route is public and takes no CSRF token: the page that posts it is on the issuer's site. A pass that signs
 * someone in sets the session cookies and goes to the app's home; a refused one goes to the sign-in page, which shows
 * the reason. It bypasses actions, as a provider's callback does, and has its own Fastify scope, so the form parser it
 * needs applies to it alone.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} fastify
 * @param {object} dependencies
 * @param {import("../services/AuthWebService.js").AuthWebService} dependencies.service
 * @param {{ max: number, timeWindow: string | number } | null} dependencies.rateLimit The `passSignIn` auth rate limit.
 */
async function registerPassSignInRoutes(fastify, { service, rateLimit }) {
  // runtime.http registers the limiter only while some route of its own has a limit; without it this one would be
  // silently unlimited.
  if (rateLimit && !fastify.hasDecorator("rateLimit")) {
    throw new Error("config.auth.rateLimits.passSignIn limits one-time pass sign-in, and no route rate limiter is registered because no other route has a limit. Give another auth route a limit, or set passSignIn to false.");
  }
  await fastify.register(async (scope) => {
    scope.addContentTypeParser(FORM_CONTENT_TYPE, { parseAs: "string", bodyLimit: MAX_FORM_BYTES }, parseForm);
    const config = { authPolicy: "public", csrfProtection: false, ...(rateLimit ? { rateLimit } : {}) };
    scope.post(AUTH_PATHS.LOGIN_PASS, { config }, async function signInWithPass(request, reply) {
      reply.header("Cache-Control", "no-store");
      const form = /** @type {{ pass?: unknown } | undefined} */ (request.body);
      let result;
      try {
        result = await service.signInWithPass({ pass: String(form?.pass ?? "") }, request);
      } catch (error) {
        if (!(error instanceof AppError) || error.statusCode >= 500) {
          throw error;
        }
        request.log.warn({ code: error.code }, "A one-time sign-in pass was refused.");
        const explained = new URLSearchParams({
          error: "sign_in_unavailable",
          error_description: error.message,
          error_code: String(error.code)
        });
        return reply.redirect(`/auth/login?${explained}`, 303);
      }
      service.writeSessionCookies(reply, result.session);
      return reply.redirect("/", 303);
    });
  });
}

export { registerPassSignInRoutes };
