import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  mdiCogOutline,
  mdiConsoleNetworkOutline,
  mdiViewListOutline
} from "@mdi/js";
import {
  resolveMenuLinkIcon,
  resolveSurfaceSwitchIcon
} from "../src/client/lib/menuIcons.js";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIRECTORY, "..");

test("shell-web resolves supported explicit mdi metadata icons from a finite map", () => {
  assert.equal(resolveMenuLinkIcon({ icon: "mdi-view-list-outline" }), mdiViewListOutline);
  assert.equal(resolveMenuLinkIcon({ icon: "mdi-cog-outline" }), mdiCogOutline);
  assert.equal(
    resolveSurfaceSwitchIcon("home", "mdi-console-network-outline"),
    mdiConsoleNetworkOutline
  );
});

test("shell-web leaves unknown explicit mdi metadata icons unchanged", () => {
  assert.equal(resolveMenuLinkIcon({ icon: "mdi-not-a-real-supported-icon" }), "mdi-not-a-real-supported-icon");
});

test("shell-web menu icon resolution does not import the full mdi namespace", async () => {
  const source = await readFile(path.join(PACKAGE_DIR, "src", "client", "lib", "menuIcons.js"), "utf8");

  assert.doesNotMatch(source, /import\s+\*\s+as\s+mdiIcons\s+from\s+["']@mdi\/js["']/);
  assert.doesNotMatch(source, /mdiIcons\[/);
});
