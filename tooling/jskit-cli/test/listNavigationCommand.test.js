import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

test("list-navigation reports structured explicit route classifications", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "list-navigation-app");
    await mkdir(path.join(appRoot, "src", "pages", "home", "records"), { recursive: true });
    await writeFile(
      path.join(appRoot, "package.json"),
      `${JSON.stringify({ name: "list-navigation-app", version: "0.1.0", private: true }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "index.vue"),
      `<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "home",
      "navigationRole": "primary",
      "navigation": {
        "behavior": "destination",
        "destinationKey": "home.dashboard",
        "persistence": { "mode": "snapshot" }
      }
    }
  }
}
</route>
<template><main /></template>
`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "records", "edit.vue"),
      `<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "home",
      "navigation": {
        "behavior": "preserve",
        "machineryKey": "home.record.edit"
      }
    }
  }
}
</route>
<template><main /></template>
`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "records", "index.vue"),
      `<script setup>
definePage({ redirect: { name: "home-records-list" } });
</script>
`,
      "utf8"
    );

    const result = runCli({ cwd: appRoot, args: ["list-navigation", "--json"] });
    assert.equal(result.status, 0, String(result.stderr || ""));
    const payload = JSON.parse(String(result.stdout || "{}"));
    assert.deepEqual(payload.summary, {
      total: 3,
      destination: 1,
      preserve: 1,
      boundary: 0,
      redirect: 1,
      missing: 0
    });
    assert.deepEqual(
      payload.routes.map((route) => [route.routePath, route.behavior, route.destinationKey || route.machineryKey]),
      [
        ["/home", "destination", "home.dashboard"],
        ["/home/records/edit", "preserve", "home.record.edit"],
        ["/home/records", "", ""]
      ]
    );
    assert.equal(payload.routes[2].redirectOnly, true);
    assert.equal(payload.routes[0].navigationRole, "primary");
  });
});
