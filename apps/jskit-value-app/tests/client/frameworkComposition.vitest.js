import { describe, expect, it, vi } from "vitest";

import { composeClientApi } from "../../src/framework/composeApi.js";
import { composeSurfaceRouteFragments, composeSurfaceRouterOptions } from "../../src/framework/composeRouter.js";
import { composeGuardPolicies } from "../../src/framework/composeGuards.js";
import { composeNavigationFragments } from "../../src/framework/composeNavigation.js";
import { composeSurfaceRouteMounts, resolveRouteMountPathByKey } from "../../src/framework/composeRouteMounts.js";
import {
  composeRealtimeInvalidationDefinitions,
  composeRealtimeTopicContributions
} from "../../src/framework/composeRealtimeClient.js";
import { CLIENT_MODULE_IDS } from "../../src/framework/moduleRegistry.js";
import { REALTIME_TOPICS } from "../../shared/eventTypes.js";

describe("framework client composition", () => {
  it("client module registry declares expected first-party module ids", () => {
    expect(CLIENT_MODULE_IDS).toEqual([
      "auth",
      "ai",
      "workspace",
      "console",
      "projects",
      "settings",
      "alerts",
      "deg2rad",
      "history",
      "billing",
      "chat",
      "social"
    ]);
  });

  it("composeClientApi builds the expected API keys with clearCsrfTokenCache passthrough", () => {
    const request = vi.fn();
    const requestStream = vi.fn();
    const clearCsrfTokenCache = vi.fn();

    const api = composeClientApi({
      request,
      requestStream,
      clearCsrfTokenCache
    });

    const expectedKeys = [
      "auth",
      "ai",
      "workspace",
      "console",
      "projects",
      "settings",
      "alerts",
      "deg2rad",
      "history",
      "billing",
      "chat",
      "social",
      "clearCsrfTokenCache"
    ];

    expect(Object.keys(api)).toEqual(expectedKeys);
    expect(api.clearCsrfTokenCache).toBe(clearCsrfTokenCache);
    expect(typeof api.auth.session).toBe("function");
    expect(typeof api.ai.streamChat).toBe("function");
  });

  it("composeSurfaceRouterOptions preserves app/admin parity", () => {
    expect(composeSurfaceRouterOptions("app")).toEqual({
      includeWorkspaceSettings: false,
      includeAssistantRoute: true,
      includeChatRoute: true,
      includeSocialRoute: true,
      includeSocialModerationRoute: false,
      includeChoiceTwoRoute: false
    });

    expect(composeSurfaceRouterOptions("admin")).toEqual({
      includeWorkspaceSettings: true,
      includeAssistantRoute: true,
      includeChatRoute: true,
      includeSocialRoute: true,
      includeSocialModerationRoute: true
    });
  });

  it("composeSurfaceRouteFragments returns ordered route fragment definitions", () => {
    const appFragments = composeSurfaceRouteFragments("app");
    expect(appFragments.map((fragment) => fragment.id)).toEqual(["assistant", "chat", "social"]);
    expect(appFragments.find((fragment) => fragment.id === "assistant")?.options).toMatchObject({
      mountKey: "ai.workspace",
      mountPath: "/assistant"
    });
    expect(appFragments.find((fragment) => fragment.id === "chat")?.options).toMatchObject({
      mountKey: "chat.workspace",
      mountPath: "/chat"
    });

    expect(composeSurfaceRouteFragments("admin").map((fragment) => fragment.id)).toEqual([
      "assistant",
      "chat",
      "social",
      "workspace",
      "projects"
    ]);

    expect(composeSurfaceRouteFragments("console").map((fragment) => fragment.id)).toEqual(["core"]);
  });

  it("composeSurfaceRouteMounts resolves keys and override paths", () => {
    const adminMounts = composeSurfaceRouteMounts("admin");
    expect(adminMounts.mountsByKey["projects.workspace"]).toMatchObject({
      path: "/projects",
      moduleId: "projects"
    });
    expect(adminMounts.mountsByKey["chat.workspace"]).toMatchObject({
      path: "/chat"
    });

    const overriddenMounts = composeSurfaceRouteMounts("admin", {
      mountOverrides: {
        "social.workspace": "/community",
        "projects.workspace": "/customers"
      }
    });
    expect(overriddenMounts.mountsByKey["social.workspace"]).toMatchObject({
      path: "/community",
      defaultPath: "/social"
    });
    expect(overriddenMounts.mountsByKey["projects.workspace"]).toMatchObject({
      path: "/customers",
      defaultPath: "/projects"
    });
  });

  it("composeSurfaceRouteMounts rejects collisions and reserved paths", () => {
    expect(() =>
      composeSurfaceRouteMounts("admin", {
        mountOverrides: {
          "social.workspace": "/dup",
          "projects.workspace": "/dup"
        }
      })
    ).toThrow(/collision/i);

    expect(() =>
      composeSurfaceRouteMounts("admin", {
        mountOverrides: {
          "projects.workspace": "/settings"
        }
      })
    ).toThrow(/reserved/i);
  });

  it("resolveRouteMountPathByKey returns defaults and explicit fallback when missing", () => {
    expect(resolveRouteMountPathByKey("admin", "projects.workspace")).toBe("/projects");
    expect(
      resolveRouteMountPathByKey("admin", "unknown.mount", {
        required: false,
        fallbackPath: "/fallback"
      })
    ).toBe("/fallback");
  });

  it("composeGuardPolicies returns module-provided guard policy metadata", () => {
    const guardPolicies = composeGuardPolicies();

    expect(guardPolicies.assistant).toMatchObject({
      featureFlag: "assistantEnabled",
      requiredFeaturePermissionKey: "assistantRequiredPermission",
      moduleId: "ai"
    });
    expect(guardPolicies.social).toMatchObject({
      featureFlag: "socialEnabled",
      moduleId: "social"
    });
  });

  it("composeNavigationFragments exposes module-tagged navigation entries", () => {
    const appFragments = composeNavigationFragments("app");
    const adminFragments = composeNavigationFragments("admin");

    expect(appFragments.some((entry) => entry.id === "deg2rad" && entry.moduleId === "deg2rad")).toBe(true);
    expect(appFragments.some((entry) => entry.id === "social" && entry.moduleId === "social")).toBe(true);
    expect(appFragments.some((entry) => entry.id === "assistant" && entry.moduleId === "ai")).toBe(true);

    expect(adminFragments.some((entry) => entry.id === "projects" && entry.moduleId === "projects")).toBe(true);
    expect(adminFragments.some((entry) => entry.id === "chat" && entry.moduleId === "chat")).toBe(true);
    expect(adminFragments.some((entry) => entry.id === "social-moderation" && entry.moduleId === "social")).toBe(true);
    expect(adminFragments.find((entry) => entry.id === "projects")?.path).toBe("/projects");
    expect(adminFragments.find((entry) => entry.id === "social-moderation")?.path).toBe("/social/moderation");
  });

  it("composeRealtimeTopicContributions aggregates realtime topics by module", () => {
    const realtime = composeRealtimeTopicContributions();

    expect(realtime.topics).toContain(REALTIME_TOPICS.CHAT);
    expect(realtime.topics).toContain(REALTIME_TOPICS.SOCIAL_FEED);
    expect(realtime.topicsByModule.chat).toEqual([REALTIME_TOPICS.CHAT, REALTIME_TOPICS.TYPING]);
    expect(realtime.topicsByModule.social).toEqual([
      REALTIME_TOPICS.SOCIAL_FEED,
      REALTIME_TOPICS.SOCIAL_NOTIFICATIONS
    ]);
  });

  it("composeRealtimeInvalidationDefinitions maps realtime topics to invalidator strategies", () => {
    const definitions = composeRealtimeInvalidationDefinitions();

    expect(definitions[REALTIME_TOPICS.PROJECTS]).toMatchObject({
      invalidatorId: "projects",
      moduleId: "projects"
    });
    expect(definitions[REALTIME_TOPICS.WORKSPACE_META]).toMatchObject({
      invalidatorId: "noop",
      refreshBootstrap: true,
      moduleId: "workspace"
    });
    expect(definitions[REALTIME_TOPICS.CONSOLE_MEMBERS]).toMatchObject({
      invalidatorId: "consoleMembers",
      refreshConsoleBootstrap: true,
      moduleId: "console"
    });
  });
});
