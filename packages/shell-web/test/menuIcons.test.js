import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  resolveMenuLinkIcon,
  resolveSurfaceSwitchIcon
} from "../src/client/lib/menuIcons.js";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

test("an explicit menu icon is used as given, an app alias or path alike", () => {
  assert.equal(resolveMenuLinkIcon({ icon: "$receiptLong" }), "$receiptLong");
  assert.equal(resolveMenuLinkIcon({ icon: "svg:M1 1h22v22H1z" }), "svg:M1 1h22v22H1z");
  assert.equal(resolveSurfaceSwitchIcon("home", "$terminal"), "$terminal");
});

test("menu links without an icon get a Material Symbols alias from their label or target", () => {
  assert.equal(resolveMenuLinkIcon({ label: "Home", to: "/home" }), "$home");
  assert.equal(resolveMenuLinkIcon({ label: "Settings", to: "/home/settings" }), "$settings");
  assert.equal(resolveMenuLinkIcon({ label: "Sign in", to: "/auth/login" }), "$login");
  assert.equal(resolveMenuLinkIcon({ label: "Members", to: "/w/acme/members" }), "$group");
  assert.equal(resolveMenuLinkIcon({ label: "Go to admin" }), "$adminPanelSettings");
  assert.equal(resolveSurfaceSwitchIcon("console"), "$terminal");
  assert.equal(resolveSurfaceSwitchIcon("reports"), "$arrowCircleRight");
});

test("shell-web menu icons are aliases, not Material Design Icons", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "src", "client", "lib", "menuIcons.js"), "utf8");

  assert.doesNotMatch(source, /@mdi\/js|mdi-/u);
});
