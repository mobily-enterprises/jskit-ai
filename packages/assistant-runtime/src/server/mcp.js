import { MCP_TOOL_CATALOG_OPTIONS, createMcpToolServer, createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { safePathnameFromRequest } from "@jskit-ai/kernel/server/runtime/requestUrl";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { isRecord, normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createSchema } from "json-rest-schema";
import { createSurfaceAwareToolCatalog } from "./support/createSurfaceAwareToolCatalog.js";

// The application's MCP endpoint (config.assistantMcp): the actions of one surface as the tools of a remote MCP
// server, for the person signed in to the request. One POST carries one JSON-RPC message and its answer; the endpoint
// keeps no session and opens no stream. Its own action (ASSISTANT_MCP_ACTION_ID) runs every message in the person's
// action context, so each tool sees the permissions, surface and workspace an HTTP route of that surface sees. A
// client signs in with the bearer token of a person who connected it (the auth provider's authorization server, such
// as local auth's config.auth.clients), never with a browser's cookies, and finds where to get one from the protected
// resource metadata (RFC 9728) this endpoint publishes.

const ASSISTANT_MCP_ACTION_ID = "assistant.mcp.request";
const MCP_RELATIVE_PATH = "/mcp";
const RESOURCE_METADATA_PREFIX = "/.well-known/oauth-protected-resource";

const workspaceInputValidator = Object.freeze({
  schema: createSchema({ workspaceSlug: { type: "string", required: true, lowercase: true, minLength: 1, maxLength: 160 } }),
  mode: "patch"
});
const noInputValidator = Object.freeze({ schema: createSchema({}), mode: "patch" });

/**
 * The endpoint an application configures, or null when it configures none.
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").ActionCatalogue} options.actions
 * @param {Record<string, any>} options.config The server configuration: `assistantMcp: { surfaceId, rateLimit? }`, its
 *   surfaces and its name (`app.name`).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.env APP_PUBLIC_URL, the address clients reach the
 *   endpoint and its authorization server at.
 * @param {{ params: object, buildInputFromRouteParams: Function } | null} [options.workspaceScopeSupport] For a workspace surface.
 */
function createAssistantMcp({ actions, config, env, workspaceScopeSupport = null }) {
  const settings = normalizeObject(config.assistantMcp);
  if (!Object.keys(settings).length) return null;
  const surfaceId = normalizeSurfaceId(settings.surfaceId);
  const surface = normalizeObject(normalizeObject(config.surfaceDefinitions)[surfaceId]);
  if (!surfaceId || !Object.keys(surface).length || surface.enabled === false) {
    throw new TypeError(`assistantMcp.surfaceId "${normalizeText(settings.surfaceId)}" is not one of the application's surfaces.`);
  }
  const requiresWorkspace = surface.requiresWorkspace === true;
  if (requiresWorkspace && !workspaceScopeSupport) {
    throw new TypeError(`assistantMcp's surface "${surfaceId}" is a workspace surface: it needs the workspaces feature's route scope.`);
  }
  const catalog = createSurfaceAwareToolCatalog(actions, {
    appConfig: config,
    createCatalog: (source, options) => createServiceToolCatalog(source, { ...MCP_TOOL_CATALOG_OPTIONS, ...options })
  });
  const publicUrl = normalizeText(env.APP_PUBLIC_URL);
  if (!URL.canParse(publicUrl)) {
    throw new TypeError("assistantMcp needs APP_PUBLIC_URL: its clients find the endpoint and where to sign in from it.");
  }
  const appName = normalizeText(config.app?.name) || "JSKIT application";
  return Object.freeze({
    surfaceId,
    requiresWorkspace,
    workspaceScopeSupport,
    appName,
    publicOrigin: new URL(publicUrl).origin,
    // Calls per client address (a connected client's server is one address for all its people); none when unset.
    rateLimit: settings.rateLimit ?? null,
    path: resolveScopedApiBasePath({ routeBase: requiresWorkspace ? "/w/:workspaceSlug" : "/", relativePath: MCP_RELATIVE_PATH, strictParams: false }),
    server: createMcpToolServer({ catalog, serverInfo: { name: appName, version: "1" } })
  });
}

/** The endpoint's one action, which answers a message as the person in its context; none without an endpoint. */
function createAssistantMcpActions({ mcp = null } = {}) {
  if (!mcp) return [];
  return Object.freeze([Object.freeze({
    id: ASSISTANT_MCP_ACTION_ID,
    version: 1,
    kind: "command",
    channels: ["api"],
    surfaces: [mcp.surfaceId],
    permission: { require: "authenticated" },
    input: mcp.requiresWorkspace ? workspaceInputValidator : noInputValidator,
    execute: (_input, context, deps) => mcp.server.handle(deps.message, { ...context, surface: mcp.surfaceId })
  })]);
}

function refuseStream(_request, reply) {
  reply.code(405).header("allow", "POST").send({ error: "This MCP endpoint answers POST only; it opens no stream.", code: "assistant_mcp_post_only" });
}

/**
 * The endpoint's routes: POST answers one message, signed in by a bearer token alone; GET and DELETE are refused as
 * the transport allows; and the protected resource metadata says which authorization server gives its tokens.
 */
function registerAssistantMcpRoutes(router, { mcp = null } = {}) {
  if (!mcp) return;
  const visibility = mcp.requiresWorkspace ? "workspace" : "public";
  const params = mcp.requiresWorkspace ? mcp.workspaceScopeSupport.params : undefined;
  const scoped = params ? { params } : {};
  const meta = { tags: ["assistant"], summary: "Answer one MCP JSON-RPC message with the signed-in person's tools." };
  router.register("POST", mcp.path, {
    auth: "required",
    visibility,
    ...scoped,
    meta,
    config: { credentials: "bearer" },
    ...(mcp.rateLimit ? { rateLimit: mcp.rateLimit } : {})
  },
    async function assistantMcpRoute(request, reply) {
      const message = request.body;
      if (message === undefined || message === null) {
        throw new AppError(400, "An MCP message is a JSON-RPC object in the request body.", { code: "assistant_mcp_body_required" });
      }
      const answer = await request.executeAction({
        actionId: ASSISTANT_MCP_ACTION_ID,
        surface: mcp.surfaceId,
        input: mcp.requiresWorkspace ? mcp.workspaceScopeSupport.buildInputFromRouteParams(request?.input?.params) : {},
        deps: { message: isRecord(message) || Array.isArray(message) ? message : null }
      });
      if (answer === null) {
        reply.code(202).send();
        return;
      }
      reply.code(200).header("content-type", "application/json; charset=utf-8").send(JSON.stringify(answer));
    });
  for (const method of ["GET", "DELETE"]) {
    router.register(method, mcp.path, { auth: "public", visibility, ...scoped, meta }, refuseStream);
  }
  router.register("GET", `${RESOURCE_METADATA_PREFIX}${mcp.path}`, {
    auth: "public",
    ...scoped,
    meta: { tags: ["assistant"], summary: "Describe the MCP endpoint as an OAuth protected resource (RFC 9728)." }
  }, async function assistantMcpResourceMetadata(request, reply) {
    const resource = `${mcp.publicOrigin}${safePathnameFromRequest(request).slice(RESOURCE_METADATA_PREFIX.length)}`;
    reply.header("cache-control", "max-age=300").send({
      resource,
      authorization_servers: [mcp.publicOrigin],
      bearer_methods_supported: ["header"],
      resource_name: mcp.appName
    });
  });
}

export { ASSISTANT_MCP_ACTION_ID, createAssistantMcp, createAssistantMcpActions, registerAssistantMcpRoutes };
