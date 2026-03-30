import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "surface-mutation-app",
        version: "0.1.0",
        private: true,
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(appRoot, "config/public.js"),
    [
      "export const config = {};",
      'config.surfaceModeAll = "all";',
      'config.surfaceDefaultId = "home";',
      "config.surfaceDefinitions = {};",
      'config.surfaceDefinitions.home = { id: "home", pagesRoot: "", enabled: true, requiresAuth: false, requiresWorkspace: false };',
      'config.surfaceDefinitions.console = { id: "console", pagesRoot: "console", enabled: true, requiresAuth: true, requiresWorkspace: false };',
      'config.surfaceDefinitions.app = { id: "app", pagesRoot: "w/[workspaceSlug]", enabled: true, requiresAuth: true, requiresWorkspace: true };',
      'config.surfaceDefinitions.admin = { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true, requiresAuth: true, requiresWorkspace: true };',
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(path.join(appRoot, "config/server.js"), "export const config = {};\n", "utf8");
}

async function createSurfaceMutationPackage({
  appRoot,
  packageName,
  descriptorBody,
  templates = {}
}) {
  const packageRoot = path.join(appRoot, "packages", packageName);
  await mkdir(path.join(packageRoot, "templates"), { recursive: true });
  await mkdir(path.join(packageRoot, "src/client/providers"), { recursive: true });

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: `@demo/${packageName}`,
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "src/client/providers/DemoProvider.js"),
    "export class DemoProvider { static id = \"demo.provider\"; register() {} }\n",
    "utf8"
  );

  await writeFile(path.join(packageRoot, "package.descriptor.mjs"), descriptorBody, "utf8");
  for (const [templatePath, templateContent] of Object.entries(templates)) {
    const absoluteTemplatePath = path.join(packageRoot, templatePath);
    await mkdir(path.dirname(absoluteTemplatePath), { recursive: true });
    await writeFile(absoluteTemplatePath, templateContent, "utf8");
  }
}

test("files mutation resolves toSurface targets from config surfaceDefinitions.pagesRoot", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "surface-mutation-app");
    await createMinimalApp(appRoot);

    await createSurfaceMutationPackage({
      appRoot,
      packageName: "surface-targeted",
      descriptorBody: `export default Object.freeze({
  packageVersion: 1,
  packageId: "@demo/surface-targeted",
  version: "0.1.0",
  kind: "runtime",
  description: "surface targeted files mutation",
  dependsOn: [],
  capabilities: { provides: [], requires: [] },
  runtime: {
    server: { providers: [] },
    client: { providers: [{ entrypoint: "src/client/providers/DemoProvider.js", export: "DemoProvider" }] }
  },
  mutations: {
    dependencies: { runtime: {}, dev: {} },
    packageJson: { scripts: {} },
    procfile: {},
    files: [
      { from: "templates/admin-page.vue", toSurface: "admin", toSurfacePath: "settings/index.vue" },
      { from: "templates/admin-wrapper.vue", toSurface: "admin", toSurfaceRoot: true }
    ],
    text: []
  }
});
`,
      templates: {
        "templates/admin-page.vue": "<template>admin settings page</template>\n",
        "templates/admin-wrapper.vue": "<template>admin wrapper</template>\n"
      }
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/surface-targeted"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const adminPage = await readFile(
      path.join(appRoot, "src/pages/w/[workspaceSlug]/admin/settings/index.vue"),
      "utf8"
    );
    const adminWrapper = await readFile(path.join(appRoot, "src/pages/w/[workspaceSlug]/admin.vue"), "utf8");

    assert.match(adminPage, /admin settings page/);
    assert.match(adminWrapper, /admin wrapper/);
  });
});

test("files mutation supports comma-separated toSurface values", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "surface-mutation-multi-surface");
    await createMinimalApp(appRoot);

    await createSurfaceMutationPackage({
      appRoot,
      packageName: "surface-multi-targeted",
      descriptorBody: `export default Object.freeze({
  packageVersion: 1,
  packageId: "@demo/surface-multi-targeted",
  version: "0.1.0",
  kind: "runtime",
  description: "surface targeted files mutation",
  dependsOn: [],
  capabilities: { provides: [], requires: [] },
  runtime: {
    server: { providers: [] },
    client: { providers: [{ entrypoint: "src/client/providers/DemoProvider.js", export: "DemoProvider" }] }
  },
  mutations: {
    dependencies: { runtime: {}, dev: {} },
    packageJson: { scripts: {} },
    procfile: {},
    files: [{ from: "templates/page.vue", toSurface: "app,admin", toSurfacePath: "workspace/assistant/index.vue" }],
    text: []
  }
});
`,
      templates: {
        "templates/page.vue": "<template>assistant page</template>\n"
      }
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/surface-multi-targeted"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const appPage = await readFile(
      path.join(appRoot, "src/pages/w/[workspaceSlug]/workspace/assistant/index.vue"),
      "utf8"
    );
    const adminPage = await readFile(
      path.join(appRoot, "src/pages/w/[workspaceSlug]/admin/workspace/assistant/index.vue"),
      "utf8"
    );

    assert.match(appPage, /assistant page/);
    assert.match(adminPage, /assistant page/);
  });
});

test("files mutation fails when toSurface references unknown surface id", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "surface-mutation-unknown");
    await createMinimalApp(appRoot);

    await createSurfaceMutationPackage({
      appRoot,
      packageName: "surface-unknown",
      descriptorBody: `export default Object.freeze({
  packageVersion: 1,
  packageId: "@demo/surface-unknown",
  version: "0.1.0",
  kind: "runtime",
  description: "invalid surface target",
  dependsOn: [],
  capabilities: { provides: [], requires: [] },
  runtime: {
    server: { providers: [] },
    client: { providers: [{ entrypoint: "src/client/providers/DemoProvider.js", export: "DemoProvider" }] }
  },
  mutations: {
    dependencies: { runtime: {}, dev: {} },
    packageJson: { scripts: {} },
    procfile: {},
    files: [{ from: "templates/page.vue", toSurface: "missing", toSurfacePath: "index.vue" }],
    text: []
  }
});
`,
      templates: {
        "templates/page.vue": "<template>missing</template>\n"
      }
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/surface-unknown"]
    });
    assert.notEqual(addResult.status, 0);
    assert.match(String(addResult.stderr || ""), /unknown surface "missing"/);
  });
});

test("files mutation rejects path traversal in toSurfacePath", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "surface-mutation-traversal");
    await createMinimalApp(appRoot);

    await createSurfaceMutationPackage({
      appRoot,
      packageName: "surface-traversal",
      descriptorBody: `export default Object.freeze({
  packageVersion: 1,
  packageId: "@demo/surface-traversal",
  version: "0.1.0",
  kind: "runtime",
  description: "invalid toSurfacePath",
  dependsOn: [],
  capabilities: { provides: [], requires: [] },
  runtime: {
    server: { providers: [] },
    client: { providers: [{ entrypoint: "src/client/providers/DemoProvider.js", export: "DemoProvider" }] }
  },
  mutations: {
    dependencies: { runtime: {}, dev: {} },
    packageJson: { scripts: {} },
    procfile: {},
    files: [{ from: "templates/page.vue", toSurface: "admin", toSurfacePath: "../escape.vue" }],
    text: []
  }
});
`,
      templates: {
        "templates/page.vue": "<template>traversal</template>\n"
      }
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/surface-traversal"]
    });
    assert.notEqual(addResult.status, 0);
    assert.match(String(addResult.stderr || ""), /path traversal is not allowed/);
  });
});

test("files mutation fails when toSurface references disabled surface id", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "surface-mutation-disabled");
    await createMinimalApp(appRoot);

    const publicConfigPath = path.join(appRoot, "config/public.js");
    const publicConfigSource = await readFile(publicConfigPath, "utf8");
    await writeFile(
      publicConfigPath,
      publicConfigSource.replace(
        'config.surfaceDefinitions.admin = { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true, requiresAuth: true, requiresWorkspace: true };',
        'config.surfaceDefinitions.admin = { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: false, requiresAuth: true, requiresWorkspace: true };'
      ),
      "utf8"
    );

    await createSurfaceMutationPackage({
      appRoot,
      packageName: "surface-disabled",
      descriptorBody: `export default Object.freeze({
  packageVersion: 1,
  packageId: "@demo/surface-disabled",
  version: "0.1.0",
  kind: "runtime",
  description: "disabled surface target",
  dependsOn: [],
  capabilities: { provides: [], requires: [] },
  runtime: {
    server: { providers: [] },
    client: { providers: [{ entrypoint: "src/client/providers/DemoProvider.js", export: "DemoProvider" }] }
  },
  mutations: {
    dependencies: { runtime: {}, dev: {} },
    packageJson: { scripts: {} },
    procfile: {},
    files: [{ from: "templates/page.vue", toSurface: "admin", toSurfacePath: "index.vue" }],
    text: []
  }
});
`,
      templates: {
        "templates/page.vue": "<template>disabled</template>\n"
      }
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/surface-disabled"]
    });
    assert.notEqual(addResult.status, 0);
    assert.match(String(addResult.stderr || ""), /surface "admin" is disabled/);
  });
});

test("files mutation rejects descriptors that set both to and toSurface", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "surface-mutation-both-targets");
    await createMinimalApp(appRoot);

    await createSurfaceMutationPackage({
      appRoot,
      packageName: "surface-both-targets",
      descriptorBody: `export default Object.freeze({
  packageVersion: 1,
  packageId: "@demo/surface-both-targets",
  version: "0.1.0",
  kind: "runtime",
  description: "invalid dual destination",
  dependsOn: [],
  capabilities: { provides: [], requires: [] },
  runtime: {
    server: { providers: [] },
    client: { providers: [{ entrypoint: "src/client/providers/DemoProvider.js", export: "DemoProvider" }] }
  },
  mutations: {
    dependencies: { runtime: {}, dev: {} },
    packageJson: { scripts: {} },
    procfile: {},
    files: [{ from: "templates/page.vue", to: "src/pages/static.vue", toSurface: "admin", toSurfacePath: "index.vue" }],
    text: []
  }
});
`,
      templates: {
        "templates/page.vue": "<template>both</template>\n"
      }
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/surface-both-targets"]
    });
    assert.notEqual(addResult.status, 0);
    assert.match(String(addResult.stderr || ""), /"to" and "toSurface" cannot both be set/);
  });
});
