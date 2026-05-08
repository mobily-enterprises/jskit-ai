import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runGeneratorSubcommand } from "../src/server/subcommands/outlet.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "ui-generator-outlet-"));
  try {
    await mkdir(path.join(appRoot, "src"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "placementTopology.js"),
      `const placements = [];

function addPlacementTopology(value = {}) {
  placements.push(value);
}

export { addPlacementTopology };

export default function getPlacementTopology() {
  return { placements };
}
`,
      "utf8"
    );
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

test("ui-generator outlet injects a generic ShellOutlet into an existing page", async () => {
  await withTempApp(async (appRoot) => {
    const targetFile = "src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/index.vue";
    const targetPath = path.join(appRoot, targetFile);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(
      targetPath,
      `<script setup>
import { computed } from "vue";
</script>

<template>
  <section>
    <h1>Contact</h1>
  </section>
</template>
`,
      "utf8"
    );

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "outlet",
      args: [targetFile],
      options: {
        target: "contact-view:sub-pages",
        placement: "page.section-nav"
      }
    });

    assert.deepEqual(result.touchedFiles, [targetFile, "src/placementTopology.js"]);

    const output = await readFile(targetPath, "utf8");
    assert.match(output, /import ShellOutlet from "@jskit-ai\/shell-web\/client\/components\/ShellOutlet";/);
    assert.match(output, /<ShellOutlet target="contact-view:sub-pages" \/>/);
    assert.doesNotMatch(output, /RouterView/);
    assert.doesNotMatch(output, /jskit:ui-generator\.outlet:/);
    const topologySource = await readFile(path.join(appRoot, "src", "placementTopology.js"), "utf8");
    assert.match(topologySource, /id: "page\.section-nav"/);
    assert.match(topologySource, /owner: "contact-view"/);
    assert.match(topologySource, /compact: \{/);
    assert.match(topologySource, /medium: \{/);
    assert.match(topologySource, /expanded: \{/);

    const rerun = await runGeneratorSubcommand({
      appRoot,
      subcommand: "outlet",
      args: [targetFile],
      options: {
        target: "contact-view:sub-pages",
        placement: "page.section-nav"
      }
    });

    assert.deepEqual(rerun.touchedFiles, []);
  });
});

test("ui-generator outlet does not inject a second matching outlet", async () => {
  await withTempApp(async (appRoot) => {
    const targetFile = "src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/index.vue";
    const targetPath = path.join(appRoot, targetFile);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(
      targetPath,
      `<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
</script>

<template>
  <section>
    <ShellOutlet target="contact-view:sub-pages" />
  </section>
</template>
`,
      "utf8"
    );

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "outlet",
      args: [targetFile],
      options: {
        target: "contact-view:sub-pages",
        placement: "page.section-nav"
      }
    });

    const output = await readFile(targetPath, "utf8");
    assert.equal((output.match(/<ShellOutlet target="contact-view:sub-pages" \/>/g) || []).length, 1);
    assert.equal(
      (output.match(/import ShellOutlet from "@jskit-ai\/shell-web\/client\/components\/ShellOutlet";/g) || []).length,
      1
    );
  });
});

test("ui-generator outlet creates script setup when missing", async () => {
  await withTempApp(async (appRoot) => {
    const targetFile = "src/components/ContactDetailsPanel.vue";
    const targetPath = path.join(appRoot, targetFile);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(
      targetPath,
      `<template>
  <div>Details</div>
</template>
`,
      "utf8"
    );

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "outlet",
      args: [targetFile],
      options: {
        target: "contact-view:sub-pages",
        placement: "page.section-nav"
      }
    });

    const output = await readFile(targetPath, "utf8");
    assert.match(output, /<script setup>/);
    assert.match(output, /import ShellOutlet from "@jskit-ai\/shell-web\/client\/components\/ShellOutlet";/);
    assert.doesNotMatch(output, /RouterView/);
  });
});

test("ui-generator outlet inserts generated script after existing route block", async () => {
  await withTempApp(async (appRoot) => {
    const targetFile = "src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/index.vue";
    const targetPath = path.join(appRoot, targetFile);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(
      targetPath,
      `<route lang="json">
{
  "meta": { "jskit": { "surface": "admin" } }
}
</route>

<template>
  <section />
</template>
`,
      "utf8"
    );

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "outlet",
      args: [targetFile],
      options: {
        target: "contact-view:sub-pages",
        placement: "page.section-nav"
      }
    });

    const output = await readFile(targetPath, "utf8");
    const routeIndex = output.indexOf("<route");
    const scriptIndex = output.indexOf("<script setup>");
    const templateIndex = output.indexOf("<template>");
    assert.ok(routeIndex >= 0);
    assert.ok(scriptIndex > routeIndex);
    assert.ok(templateIndex > scriptIndex);
  });
});

test("ui-generator outlet keeps indentation when injected into nested template block", async () => {
  await withTempApp(async (appRoot) => {
    const targetFile = "src/pages/w/[workspaceSlug]/admin/contacts/[contactId]/index.vue";
    const targetPath = path.join(appRoot, targetFile);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(
      targetPath,
      `<template>
  <section>
    <template v-else-if="view.isLoading">
      <v-skeleton-loader type="heading, text@2, article" />
    </template>

    <template v-else>
      <v-progress-linear v-if="view.isRefetching" indeterminate class="mb-4" />
    </template>
  </section>
</template>
`,
      "utf8"
    );

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "outlet",
      args: [targetFile],
      options: {
        target: "contact-view:sub-pages",
        placement: "page.section-nav"
      }
    });

    const output = await readFile(targetPath, "utf8");
    assert.match(output, /\n\s{2}<\/section>\n\s{2}<ShellOutlet target="contact-view:sub-pages" \/>\n<\/template>/);
    assert.match(output, /<template v-else-if="view\.isLoading">\n\s*<v-skeleton-loader type="heading, text@2, article" \/>\n\s*<\/template>/);
    assert.doesNotMatch(output, /jskit:ui-generator\.outlet:/);
  });
});

test("ui-generator outlet rejects unsupported options", async () => {
  await withTempApp(async (appRoot) => {
    const targetFile = "src/components/ContactDetailsPanel.vue";
    const targetPath = path.join(appRoot, targetFile);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "<template><div /></template>\n", "utf8");

    await assert.rejects(
      runGeneratorSubcommand({
        appRoot,
        subcommand: "outlet",
      args: [targetFile],
      options: {
        target: "contact-view:sub-pages",
        placement: "page.section-nav",
        bogus: "routed"
      }
      }),
      /ui-generator outlet received unsupported option: --bogus\./
    );
  });
});

test("ui-generator outlet supports explicit target host:position", async () => {
  await withTempApp(async (appRoot) => {
    const targetFile = "src/components/ContactDetailsPanel.vue";
    const targetPath = path.join(appRoot, targetFile);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "<template><div /></template>\n", "utf8");

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "outlet",
      args: [targetFile],
      options: {
        target: "customer-view:summary-actions",
        placement: "page.actions"
      }
    });

    const output = await readFile(targetPath, "utf8");
    assert.match(output, /<ShellOutlet target="customer-view:summary-actions" \/>/);
  });
});

test("ui-generator outlet rejects non-vue target files without changing them", async () => {
  await withTempApp(async (appRoot) => {
    const targetFile = "src/pages/w/[workspaceSlug]/admin/practice/vets/_components/VetAddEditFormFields.js";
    const targetPath = path.join(appRoot, targetFile);
    const originalSource = "export const fields = [];\n";

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, originalSource, "utf8");

    await assert.rejects(
      runGeneratorSubcommand({
        appRoot,
        subcommand: "outlet",
      args: [targetFile],
      options: {
          target: "vet-view:sub-pages",
          placement: "page.section-nav"
        }
      }),
      /ui-generator outlet target file must be an existing Vue SFC \(\.vue\): src\/pages\/w\/\[workspaceSlug\]\/admin\/practice\/vets\/_components\/VetAddEditFormFields\.js\./
    );

    const output = await readFile(targetPath, "utf8");
    assert.equal(output, originalSource);
  });
});

test("ui-generator outlet validates target format", async () => {
  await withTempApp(async (appRoot) => {
    const targetFile = "src/components/ContactDetailsPanel.vue";
    const targetPath = path.join(appRoot, targetFile);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "<template><div /></template>\n", "utf8");

    await assert.rejects(
      runGeneratorSubcommand({
        appRoot,
        subcommand: "outlet",
      args: [targetFile],
      options: {
          target: "customer-view:",
          placement: "page.actions"
        }
      }),
      /ui-generator outlet option "target" must be a target in "host:position" format\./
    );
  });
});
