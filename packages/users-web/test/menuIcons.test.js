import assert from "node:assert/strict";
import test from "node:test";
import {
  mdiAccountCogOutline,
  mdiConsoleNetworkOutline,
  mdiCogOutline,
  mdiFolderOutline,
  mdiLogin,
  mdiShieldCrownOutline,
  mdiViewDashboardOutline,
  mdiViewListOutline
} from "@mdi/js";
import {
  resolveMenuLinkIcon,
  resolveSurfaceSwitchIcon
} from "../src/client/lib/menuIcons.js";

test("resolveSurfaceSwitchIcon prefers explicit icon and maps known surfaces", () => {
  assert.equal(resolveSurfaceSwitchIcon("admin"), mdiShieldCrownOutline);
  assert.equal(resolveSurfaceSwitchIcon("console"), mdiConsoleNetworkOutline);
  assert.equal(resolveSurfaceSwitchIcon("admin", "custom-icon"), "custom-icon");
  assert.equal(resolveSurfaceSwitchIcon("admin", "mdi-cog-outline"), mdiCogOutline);
});

test("resolveMenuLinkIcon resolves settings/login fallbacks and generic default", () => {
  assert.equal(resolveMenuLinkIcon({ icon: "mdi-cog-outline" }), mdiCogOutline);
  assert.equal(resolveMenuLinkIcon({ to: "/account" }), mdiAccountCogOutline);
  assert.equal(resolveMenuLinkIcon({ label: "Sign in" }), mdiLogin);
  assert.equal(resolveMenuLinkIcon({ label: "Go to admin" }), mdiShieldCrownOutline);
  assert.equal(resolveMenuLinkIcon({ label: "Workspace", to: "/w/acme" }), mdiViewDashboardOutline);
  assert.equal(resolveMenuLinkIcon({ to: "/projects" }), mdiFolderOutline);
  assert.equal(resolveMenuLinkIcon({ label: "Settings", to: "/workspace/settings" }), mdiCogOutline);
  assert.equal(resolveMenuLinkIcon({ label: "Anything else", to: "/foo" }), mdiFolderOutline);
  assert.equal(resolveMenuLinkIcon({ label: "Anything else" }), mdiViewListOutline);
});
