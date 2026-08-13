import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createNavigationApp(appRoot, name = "navigation-doctor-app") {
  await mkdir(path.join(appRoot, "src", "pages", "home"), { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify({ name, version: "0.1.0", private: true, type: "module" }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(appRoot, "src", "main.js"),
    "const shellRouterOptions = { navigation: true };\nvoid shellRouterOptions;\n",
    "utf8"
  );
  await writeFile(
    path.join(appRoot, "src", "placementTopology.js"),
    `export default {
  placements: [
    {
      id: "shell.primary-nav",
      variants: {
        compact: { outlet: "shell-layout:primary-bottom-nav" },
        medium: { outlet: "shell-layout:primary-rail" },
        expanded: { outlet: "shell-layout:primary-drawer" }
      }
    },
    {
      id: "shell.secondary-nav",
      variants: {
        compact: { outlet: "shell-layout:navigation-overflow-menu" },
        medium: { outlet: "shell-layout:navigation-overflow-menu" },
        expanded: { outlet: "shell-layout:secondary-menu" }
      }
    }
  ]
};
`,
    "utf8"
  );
}

function renderRoutePage(navigation) {
  return `<route lang="json">
${JSON.stringify({ meta: { jskit: { surface: "home", navigation } } }, null, 2)}
</route>

<template>
  <main><h1 data-jskit-page-heading tabindex="-1">Page</h1></main>
</template>
`;
}

test("doctor accepts explicit destination, machinery, and boundary route metadata", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "navigation-doctor-valid");
    await createNavigationApp(appRoot, "navigation-doctor-valid");
    await mkdir(path.join(appRoot, "src", "pages", "home", "records"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "index.vue"),
      renderRoutePage({ behavior: "destination", destinationKey: "home.dashboard" }),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "records", "edit.vue"),
      renderRoutePage({ behavior: "preserve", machineryKey: "home.record.edit" }),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "callback.vue"),
      renderRoutePage({ behavior: "boundary", persistence: { mode: "none" } }),
      "utf8"
    );

    const result = runCli({ cwd: appRoot, args: ["doctor", "--json"] });
    assert.equal(result.status, 0, String(result.stderr || ""));
    const payload = JSON.parse(String(result.stdout || "{}"));
    assert.deepEqual(payload.issues, []);
  });
});

test("doctor does not require destination metadata on redirect-only route owners", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "navigation-doctor-redirect");
    await createNavigationApp(appRoot, "navigation-doctor-redirect");
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "index.vue"),
      `<script setup>
definePage({ redirect: { name: "home-dashboard" } });
</script>
`,
      "utf8"
    );

    const result = runCli({ cwd: appRoot, args: ["doctor", "--json"] });
    assert.equal(result.status, 0, String(result.stderr || ""));
    const payload = JSON.parse(String(result.stdout || "{}"));
    assert.deepEqual(payload.issues, []);
  });
});

test("doctor rejects parallel Back systems and missing route metadata", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "navigation-doctor-invalid");
    await createNavigationApp(appRoot, "navigation-doctor-invalid");
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "index.vue"),
      `<template><v-btn @click="router.back()">Back</v-btn></template>
<script setup>
const returnSource = route.query.returnTo;
const canPop = history.length > 1;
history.replaceState({}, "", route.fullPath);
void returnSource;
void canPop;
</script>
`,
      "utf8"
    );

    const result = runCli({ cwd: appRoot, args: ["doctor", "--json"] });
    assert.equal(result.status, 1, String(result.stderr || ""));
    const payload = JSON.parse(String(result.stdout || "{}"));
    const issueText = payload.issues.join("\n");
    assert.match(issueText, /\[navigation:parallel-return-stack\]/);
    assert.match(issueText, /\[navigation:history-state-owner\]/);
    assert.match(issueText, /\[navigation:history-length\]/);
    assert.match(issueText, /\[navigation:page-owned-back\]/);
    assert.match(issueText, /\[navigation:route-metadata-missing\]/);
  });
});

test("doctor rejects duplicate destination keys", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "navigation-doctor-duplicate");
    await createNavigationApp(appRoot, "navigation-doctor-duplicate");
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "index.vue"),
      renderRoutePage({ behavior: "destination", destinationKey: "home.records" }),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "records.vue"),
      renderRoutePage({ behavior: "destination", destinationKey: "home.records" }),
      "utf8"
    );

    const result = runCli({ cwd: appRoot, args: ["doctor", "--json"] });
    assert.equal(result.status, 1, String(result.stderr || ""));
    const payload = JSON.parse(String(result.stdout || "{}"));
    assert.match(payload.issues.join("\n"), /\[navigation:destination-key-duplicate\]/);
  });
});

test("doctor rejects identity keys that conflict with route behavior", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "navigation-doctor-conflicting-keys");
    await createNavigationApp(appRoot, "navigation-doctor-conflicting-keys");
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "index.vue"),
      renderRoutePage({
        behavior: "preserve",
        machineryKey: "home.record.edit",
        destinationKey: "home.record"
      }),
      "utf8"
    );

    const result = runCli({ cwd: appRoot, args: ["doctor", "--json"] });
    assert.equal(result.status, 1, String(result.stderr || ""));
    const issueText = JSON.parse(String(result.stdout || "{}")).issues.join("\n");
    assert.match(issueText, /\[navigation:preserve-destination-key\]/);
  });
});

test("doctor rejects adaptive navigation topology that can strand hidden destinations", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "navigation-doctor-topology");
    await createNavigationApp(appRoot, "navigation-doctor-topology");
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "index.vue"),
      renderRoutePage({ behavior: "destination", destinationKey: "home.dashboard" }),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "placementTopology.js"),
      `export default {
  placements: [{
    id: "shell.primary-nav",
    variants: {
      compact: { outlet: "shell-layout:primary-drawer" },
      medium: { outlet: "shell-layout:primary-drawer" },
      expanded: { outlet: "shell-layout:primary-drawer" }
    }
  }]
};
`,
      "utf8"
    );

    const result = runCli({ cwd: appRoot, args: ["doctor", "--json"] });
    assert.equal(result.status, 1, String(result.stderr || ""));
    const issueText = JSON.parse(String(result.stdout || "{}")).issues.join("\n");
    assert.match(issueText, /\[navigation:adaptive-topology-invalid\]/);
    assert.match(issueText, /\[navigation:adaptive-topology-missing\]/);
  });
});

test("doctor rejects a generated CRUD form classified as a destination", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "navigation-doctor-form");
    await createNavigationApp(appRoot, "navigation-doctor-form");
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "index.vue"),
      `${renderRoutePage({ behavior: "destination", destinationKey: "home.record.edit" })}
<script setup>
const screen = useCrudAddEditScreen({ mode: "edit" });
void screen;
</script>
`,
      "utf8"
    );

    const result = runCli({ cwd: appRoot, args: ["doctor", "--json"] });
    assert.equal(result.status, 1, String(result.stderr || ""));
    const issueText = JSON.parse(String(result.stdout || "{}")).issues.join("\n");
    assert.match(issueText, /\[navigation:generated-form-destination\]/);
  });
});
