import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { workspaceRoutesContract as workspaceSchema } from "../common/contracts/workspaceRoutesContract.js";
import { routeQueries } from "../common/contracts/routeQueries.js";

function getOAuthProviderCatalogPayload(authService) {
  if (!authService || typeof authService.getOAuthProviderCatalog !== "function") {
    return {
      oauthProviders: [],
      oauthDefaultProvider: null
    };
  }

  const catalog = authService.getOAuthProviderCatalog();
  const providers = Array.isArray(catalog?.providers)
    ? catalog.providers
        .map((provider) => ({
          id: normalizeText(provider?.id).toLowerCase(),
          label: normalizeText(provider?.label)
        }))
        .filter((provider) => provider.id && provider.label)
    : [];
  const defaultProvider = normalizeText(catalog?.defaultProvider).toLowerCase();

  return {
    oauthProviders: providers,
    oauthDefaultProvider: providers.some((provider) => provider.id === defaultProvider) ? defaultProvider : null
  };
}

function bootWorkspaceBootstrapRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("bootWorkspaceBootstrapRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const authService = app.make("authService");
  const consoleService = app.has("consoleService") ? app.make("consoleService") : null;

  router.register(
    "GET",
    "/api/bootstrap",
    {
      auth: "public",
      meta: {
        tags: ["workspace"],
        summary: "Get startup bootstrap payload with session, app, workspace, and settings context"
      },
      query: routeQueries.workspaceBootstrap,
      response: withStandardErrorResponses({
        200: { schema: workspaceSchema.response.bootstrap }
      })
    },
    async function (request, reply) {
      const oauthCatalogPayload = getOAuthProviderCatalogPayload(authService);
      const authResult = await request.executeAction({
        actionId: "auth.session.read"
      });

      if (authResult?.clearSession === true && typeof authService.clearSessionCookies === "function") {
        authService.clearSessionCookies(reply);
      }
      if (authResult?.session && typeof authService.writeSessionCookies === "function") {
        authService.writeSessionCookies(reply, authResult.session);
      }

      if (authResult?.transientFailure === true) {
        reply.code(503).send({
          error: "Authentication service temporarily unavailable. Please retry."
        });
        return;
      }

      if (
        authResult?.authenticated &&
        authResult?.profile?.id != null &&
        consoleService &&
        typeof consoleService.ensureInitialConsoleMember === "function"
      ) {
        await consoleService.ensureInitialConsoleMember(authResult.profile.id);
      }

      const bootstrapWorkspaceSlug = normalizeText(request?.input?.query?.workspaceSlug).toLowerCase();
      const payload = await request.executeAction({
        actionId: "workspace.bootstrap.read",
        input: {
          user: authResult?.authenticated ? authResult.profile : null,
          workspaceSlug: bootstrapWorkspaceSlug
        },
        context: {
          actor: authResult?.authenticated ? authResult.profile : null
        }
      });
      const session = payload?.session && typeof payload.session === "object" ? payload.session : { authenticated: false };

      reply.code(200).send({
        ...payload,
        session: {
          ...session,
          ...oauthCatalogPayload
        }
      });
    }
  );
}

export { bootWorkspaceBootstrapRoutes };
