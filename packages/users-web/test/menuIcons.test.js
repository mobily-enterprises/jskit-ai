import assert from "node:assert/strict";
import test from "node:test";
import {
  mdiCogOutline,
  mdiConsole,
  mdiLogin,
  mdiShieldCrownOutline,
  mdiViewListOutline
} from "@mdi/js";
import {
  resolveMenuLinkIcon,
  resolveSurfaceSwitchIcon
} from "../src/client/lib/menuIcons.js";

test("resolveSurfaceSwitchIcon prefers explicit icon and maps known surfaces", () => {
  assert.equal(resolveSurfaceSwitchIcon("admin"), mdiShieldCrownOutline);
  assert.equal(resolveSurfaceSwitchIcon("console"), mdiConsole);
  assert.equal(resolveSurfaceSwitchIcon("admin", "custom-icon"), "custom-icon");
});

test("resolveMenuLinkIcon resolves settings/login fallbacks and generic default", () => {
  assert.equal(resolveMenuLinkIcon({ to: "/account/settings" }), mdiCogOutline);
  assert.equal(resolveMenuLinkIcon({ label: "Sign in" }), mdiLogin);
  assert.equal(resolveMenuLinkIcon({ label: "Anything else", to: "/foo" }), mdiViewListOutline);
});
