import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runGeneratorSubcommand } from "../src/server/subcommands/element.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "ui-generator-element-"));
  try {
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

function renderTopologyEntry({
  id = "",
  owner = "",
  surfaces = ["*"],
  defaultPlacement = false,
  outlet = "",
  linkRenderer = ""
} = {}) {
  const ownerLine = owner ? `    owner: "${owner}",\n` : "";
  const defaultLine = defaultPlacement ? "    default: true,\n" : "";
  const rendererLines = linkRenderer
    ? `,
      renderers: {
        link: "${linkRenderer}"
      }`
    : "";
  return `  {
    id: "${id}",
${ownerLine}    surfaces: ${JSON.stringify(surfaces)},
${defaultLine}    variants: {
      compact: {
        outlet: "${outlet}"${rendererLines}
      },
      medium: {
        outlet: "${outlet}"${rendererLines}
      },
      expanded: {
        outlet: "${outlet}"${rendererLines}
      }
    }
  }`;
}

async function writeAppFixture(appRoot) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await mkdir(path.join(appRoot, "src", "components"), { recursive: true });
  await mkdir(path.join(appRoot, "src", "pages", "admin", "workspace", "settings"), { recursive: true });
  await mkdir(path.join(appRoot, "packages", "main", "src", "client", "providers"), { recursive: true });

  await writeFile(
    path.join(appRoot, "config", "public.js"),
    `export const config = {
  surfaceDefaultId: "admin",
  surfaceDefinitions: {
    admin: {
      id: "admin",
      pagesRoot: "admin/workspace",
      enabled: true
    }
  }
};
`,
    "utf8"
  );

  await writeFile(
    path.join(appRoot, "src", "components", "ShellLayout.vue"),
    `<template>
  <div>
    <ShellOutlet
      target="shell-layout:primary-menu"
      default
    />
    <ShellOutlet target="shell-layout:top-right" />
  </div>
</template>
`,
    "utf8"
  );
  await writeFile(
    path.join(appRoot, "src", "placementTopology.js"),
    `export default {
  placements: [
${[
  renderTopologyEntry({
    id: "shell.primary-nav",
    surfaces: ["*"],
    defaultPlacement: true,
    outlet: "shell-layout:primary-menu",
    linkRenderer: "local.main.ui.surface-aware-menu-link-item"
  }),
  renderTopologyEntry({
    id: "shell.status",
    surfaces: ["*"],
    outlet: "shell-layout:top-right"
  }),
  renderTopologyEntry({
    id: "settings.sections",
    owner: "admin-settings",
    surfaces: ["admin"],
    outlet: "admin-settings:forms"
  })
].join(",\n")}
  ]
};
`,
    "utf8"
  );
  await writeFile(
    path.join(appRoot, "src", "pages", "admin", "workspace", "settings", "index.vue"),
    `<template>
  <section>
    <ShellOutlet target="admin-settings:forms" />
  </section>
</template>
`,
    "utf8"
  );
  await writeFile(
    path.join(appRoot, "src", "placement.js"),
    `function addPlacement() {}

export { addPlacement };
export default function getPlacements() {
  return [];
}
`,
    "utf8"
  );
  await writeFile(
    path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
    `const mainClientComponents = [];

function registerMainClientComponent(token, resolveComponent) {
  mainClientComponents.push({ token, resolveComponent });
}

class MainClientProvider {}

export { MainClientProvider, registerMainClientComponent };
`,
    "utf8"
  );
}

test("ui-generator placed-element subcommand creates component and outlet placement", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "placed-element",
      options: {
        name: "Ops Panel",
        surface: "admin"
      }
    });

    assert.deepEqual(result.touchedFiles, [
      "packages/main/src/client/providers/MainClientProvider.js",
      "src/components/OpsPanelElement.vue",
      "src/placement.js"
    ]);

    const providerSource = await readFile(
      path.join(appRoot, "packages", "main", "src", "client", "providers", "MainClientProvider.js"),
      "utf8"
    );
    assert.match(providerSource, /import OpsPanelElement from "\/src\/components\/OpsPanelElement\.vue";/);
    assert.match(providerSource, /registerMainClientComponent\("local\.main\.ui\.element\.ops-panel", \(\) => OpsPanelElement\);/);

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /id: "ui-generator\.element\.ops-panel"/);
    assert.match(placementSource, /target: "shell\.status"/);
    assert.match(placementSource, /kind: "component"/);
    assert.match(placementSource, /componentToken: "local\.main\.ui\.element\.ops-panel"/);
  });
});

test("ui-generator placed-element subcommand supports explicit placement override", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "placed-element",
      options: {
        name: "Ops Panel",
        surface: "admin",
        placement: "shell.primary-nav"
      }
    });

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /target: "shell\.primary-nav"/);
  });
});

test("ui-generator placed-element infers surface from an owner-scoped semantic placement", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "placed-element",
      options: {
        name: "Ops Panel",
        placement: "settings.sections",
        owner: "admin-settings"
      }
    });

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /target: "settings\.sections"/);
    assert.match(placementSource, /owner: "admin-settings"/);
    assert.match(placementSource, /surfaces: \["admin"\]/);
  });
});

test("ui-generator placed-element infers the only enabled surface for shared shell targets", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    await runGeneratorSubcommand({
      appRoot,
      subcommand: "placed-element",
      options: {
        name: "Ops Panel"
      }
    });

    const placementSource = await readFile(path.join(appRoot, "src", "placement.js"), "utf8");
    assert.match(placementSource, /target: "shell\.status"/);
    assert.match(placementSource, /surfaces: \["admin"\]/);
  });
});

test("ui-generator placed-element requires explicit surface when a shared shell target is ambiguous", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);
    await writeFile(
      path.join(appRoot, "config", "public.js"),
      `export const config = {
  surfaceDefaultId: "admin",
  surfaceDefinitions: {
    admin: {
      id: "admin",
      pagesRoot: "admin/workspace",
      enabled: true
    },
    console: {
      id: "console",
      pagesRoot: "console",
      enabled: true
    }
  }
};
`,
      "utf8"
    );

    await assert.rejects(
      () =>
        runGeneratorSubcommand({
          appRoot,
          subcommand: "placed-element",
          options: {
            name: "Ops Panel"
          }
        }),
      /could not infer a surface for placement target "shell.status". Pass --surface explicitly/
    );
  });
});

test("ui-generator placed-element rejects explicit surfaces that conflict with page-owned targets", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);

    await assert.rejects(
      () =>
        runGeneratorSubcommand({
          appRoot,
          subcommand: "placed-element",
          options: {
            name: "Ops Panel",
            placement: "settings.sections",
            owner: "admin-settings",
            surface: "console"
          }
        }),
      /target "settings.sections" is not available on surface "console"/
    );
  });
});

test("ui-generator placed-element subcommand refuses to overwrite an existing component without force", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);
    await writeFile(
      path.join(appRoot, "src", "components", "OpsPanelElement.vue"),
      "<template><div>custom</div></template>\n",
      "utf8"
    );

    await assert.rejects(
      () =>
        runGeneratorSubcommand({
          appRoot,
          subcommand: "placed-element",
          options: {
            name: "Ops Panel",
            surface: "admin"
          }
        }),
      /ui-generator placed-element will not overwrite existing component file src\/components\/OpsPanelElement\.vue\. Re-run with --force to overwrite it\./
    );
  });
});

test("ui-generator placed-element subcommand overwrites an existing component when force is enabled", async () => {
  await withTempApp(async (appRoot) => {
    await writeAppFixture(appRoot);
    await writeFile(
      path.join(appRoot, "src", "components", "OpsPanelElement.vue"),
      "<template><div>custom</div></template>\n",
      "utf8"
    );

    const result = await runGeneratorSubcommand({
      appRoot,
      subcommand: "placed-element",
      options: {
        name: "Ops Panel",
        surface: "admin",
        force: "true"
      }
    });

    assert.deepEqual(result.touchedFiles, [
      "packages/main/src/client/providers/MainClientProvider.js",
      "src/components/OpsPanelElement.vue",
      "src/placement.js"
    ]);

    const componentSource = await readFile(path.join(appRoot, "src", "components", "OpsPanelElement.vue"), "utf8");
    assert.match(componentSource, /<h2 class="text-h6 mb-2">Ops Panel<\/h2>/);
  });
});

test("ui-generator placed-element subcommand requires appRoot", async () => {
  await assert.rejects(
    () =>
      runGeneratorSubcommand({
        appRoot: "",
        subcommand: "placed-element",
        options: {
          name: "Ops Panel",
          surface: "admin"
        }
      }),
    /requires appRoot/
  );
});
