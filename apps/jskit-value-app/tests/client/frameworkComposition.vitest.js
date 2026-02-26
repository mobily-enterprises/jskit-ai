import { describe, expect, it, vi } from "vitest";

import { composeClientApi } from "../../src/framework/composeApi.js";
import { composeSurfaceRouterOptions } from "../../src/framework/composeRouter.js";
import { composeNavigationFragments } from "../../src/framework/composeNavigation.js";
import { composeRealtimeTopicContributions } from "../../src/framework/composeRealtimeClient.js";
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

  it("composeNavigationFragments exposes module-tagged navigation entries", () => {
    const appFragments = composeNavigationFragments("app");
    const adminFragments = composeNavigationFragments("admin");

    expect(appFragments.some((entry) => entry.id === "deg2rad" && entry.moduleId === "deg2rad")).toBe(true);
    expect(appFragments.some((entry) => entry.id === "social" && entry.moduleId === "social")).toBe(true);
    expect(appFragments.some((entry) => entry.id === "assistant" && entry.moduleId === "ai")).toBe(true);

    expect(adminFragments.some((entry) => entry.id === "projects" && entry.moduleId === "projects")).toBe(true);
    expect(adminFragments.some((entry) => entry.id === "workspace-chat" && entry.moduleId === "chat")).toBe(true);
    expect(adminFragments.some((entry) => entry.id === "social-moderation" && entry.moduleId === "social")).toBe(true);
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
});
