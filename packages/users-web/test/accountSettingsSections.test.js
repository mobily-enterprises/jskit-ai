import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_SETTINGS_SECTION_TARGET,
  normalizeAccountSettingsSectionEntry,
  resolveAccountSettingsSections
} from "../src/client/account-settings/sections.js";

test("account settings sections use the standard placement target", () => {
  assert.equal(ACCOUNT_SETTINGS_SECTION_TARGET, "account-settings:sections");
});

test("resolveAccountSettingsSections normalizes, deduplicates, and sorts placement-backed account section entries", () => {
  const SectionA = {};
  const SectionB = {};

  const resolved = resolveAccountSettingsSections([
    {
      id: "users.profile.duplicate",
      order: 999,
      component: SectionA,
      props: {
        value: "profile",
        title: "Profile duplicate"
      }
    },
    {
      id: "workspaces.invites",
      order: 400,
      component: SectionA,
      props: {
        value: "invites",
        title: "Invites"
      }
    },
    {
      id: "invalid.missing-component",
      order: 250,
      props: {
        value: "broken",
        title: "Broken missing component"
      }
    },
    {
      id: "users.profile",
      order: 100,
      component: SectionB,
      props: {
        value: "profile",
        title: "Profile",
        usesSharedRuntime: true
      }
    },
    {
      id: "security.section",
      order: 350,
      component: SectionB,
      props: {
        value: "security",
        title: "Security",
        usesSharedRuntime: true
      }
    },
    {
      id: "workspaces.invites.duplicate",
      order: 100,
      component: SectionB,
      props: {
        value: "invites",
        title: "Second duplicate"
      }
    }
  ]);

  assert.deepEqual(
    resolved.map((entry) => ({
      value: entry.value,
      title: entry.title,
      order: entry.order,
      usesSharedRuntime: entry.usesSharedRuntime
    })),
    [
      { value: "invites", title: "Second duplicate", order: 100, usesSharedRuntime: false },
      { value: "profile", title: "Profile", order: 100, usesSharedRuntime: true },
      { value: "security", title: "Security", order: 350, usesSharedRuntime: true },
    ]
  );
});

test("normalizeAccountSettingsSectionEntry rejects malformed placement entries", () => {
  assert.equal(normalizeAccountSettingsSectionEntry(null), null);
  assert.equal(normalizeAccountSettingsSectionEntry({}), null);
  assert.equal(
    normalizeAccountSettingsSectionEntry({
      component: {},
      props: {
        value: "",
        title: "Broken"
      }
    }),
    null
  );
});
