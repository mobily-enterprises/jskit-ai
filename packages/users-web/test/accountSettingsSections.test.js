import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_SETTINGS_SECTION_REGISTRY_TAG,
  resolveAccountSettingsSections
} from "../src/client/account-settings/sections.js";
import { bootUsersWebClientProvider } from "../src/client/providers/bootUsersWebClientProvider.js";

test("resolveAccountSettingsSections normalizes, deduplicates, and sorts tagged account section entries", () => {
  const SectionA = {};
  const SectionB = {};

  const resolved = resolveAccountSettingsSections([
    { value: "notifications", title: "Ignore duplicate", component: SectionA, order: 999 },
    { value: "invites", title: "Invites", component: SectionA, order: 400 },
    { value: "profile", title: "Broken missing component" },
    { value: "security", title: "Security", component: SectionB, order: 350 },
    { value: "invites", title: "Second duplicate", component: SectionB, order: 100 }
  ]);

  assert.deepEqual(
    resolved.map((entry) => ({ value: entry.value, title: entry.title, order: entry.order })),
    [
      { value: "security", title: "Security", order: 350 },
      { value: "invites", title: "Invites", order: 400 }
    ]
  );
});

test("bootUsersWebClientProvider provides normalized account section extensions", async () => {
  const SectionComponent = {};
  const provided = new Map();
  let resolvedTagName = "";

  await bootUsersWebClientProvider({
    make(token) {
      if (token === "jskit.client.vue.app") {
        return {
          provide(key, value) {
            provided.set(key, value);
          }
        };
      }
      throw new Error(`Unexpected token: ${token}`);
    },
    resolveTag(tagName) {
      resolvedTagName = tagName;
      return [
        {
          value: "invites",
          title: "Invites",
          component: SectionComponent,
          order: 400,
          usesSharedRuntime: false
        }
      ];
    }
  });

  assert.equal(resolvedTagName, ACCOUNT_SETTINGS_SECTION_REGISTRY_TAG);
  const [providedSections] = [...provided.values()];
  assert.equal(Array.isArray(providedSections), true);
  assert.deepEqual(
    providedSections.map((entry) => ({
      value: entry.value,
      title: entry.title,
      order: entry.order,
      usesSharedRuntime: entry.usesSharedRuntime
    })),
    [
      {
        value: "invites",
        title: "Invites",
        order: 400,
        usesSharedRuntime: false
      }
    ]
  );
});
