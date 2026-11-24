import { MCP_TOOL_CATALOG_OPTIONS, createMcpToolServer, createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { isRecord, normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createSchema } from "json-rest-schema";
import { createSurfaceAwareToolCatalog } from "./support/createSurfaceAwareToolCatalog.js";

// The application's MCP endpoint (config.assistantMcp): the actions of one surface as the tools of a remote MCP
// server, for the person signed in to the request. One POST carries one JSON-RPC message and its answer; the endpoint
// keeps no session and opens no stream. Its own action (ASSISTANT_MCP_ACTION_ID) runs every message in the person's
// action context, so each tool sees the permissions, surface and workspace an HTTP route of that surface sees. Its
// callers are other applications' servers: each request signs in by a service key and names the user it acts as
// (credentials: "bearer"; local auth's service keys), never by a browser's cookies.

const ASSISTANT_MCP_ACTION_ID = "assistant.mcp.request";
const MCP_RELATIVE_PATH = "/mcp";

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
 * @param {{ params: object, buildInputFromRouteParams: Function } | null} [options.workspaceScopeSupport] For a workspace surface.
 */
function createAssistantMcp({ actions, config, workspaceScopeSupport = null }) {
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
  const appName = normalizeText(config.app?.name) || "JSKIT application";
  return Object.freeze({
    surfaceId,
    requiresWorkspace,
    workspaceScopeSupport,
    // Calls per caller address (one service key's server calls for all its users from one); none when unset.
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
 * The endpoint's routes: POST answers one message, signed in by a service key alone and acting as the user it names,
 * whose id it answers in Acting-As-User; GET and DELETE are refused as the transport allows.
 */
function registerAssistantMcpRoutes(router, { mcp = null } = {}) {
  if (!mcp) return;
  const visibility = mcp.requiresWorkspace ? "workspace" : "public";
  const params = mcp.requiresWorkspace ? mcp.workspaceScopeSupport.params : undefined;
  const meta = { tags: ["assistant"], summary: "Answer one MCP JSON-RPC message with the signed-in person's tools." };
  const scoped = params ? { params } : {};
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
      // The caller learns who it acted as: the user an email named, for the id it names from then on.
      reply.header("acting-as-user", String(request.user?.providerUserId || ""));
      if (answer === null) {
        reply.code(202).send();
        return;
      }
      reply.code(200).header("content-type", "application/json; charset=utf-8").send(JSON.stringify(answer));
    });
  for (const method of ["GET", "DELETE"]) {
    router.register(method, mcp.path, { auth: "public", visibility, ...scoped, meta }, refuseStream);
  }
}

export { ASSISTANT_MCP_ACTION_ID, createAssistantMcp, createAssistantMcpActions, registerAssistantMcpRoutes };
