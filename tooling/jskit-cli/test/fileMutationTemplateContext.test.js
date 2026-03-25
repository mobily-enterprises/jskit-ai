import assert from "node:assert/strict";
import { access, constants as fsConstants, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { name = "tmp-app" } = {}) {
  await mkdir(appRoot, { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "0.1.0",
        private: true,
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function createTemplateContextPackage(appRoot, { returnExpression = "{ __BODY__: \"body\" }" } = {}) {
  const packageRoot = path.join(appRoot, "packages", "template-context-feature");
  await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
  await mkdir(path.join(packageRoot, "templates"), { recursive: true });

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@demo/template-context-feature",
        version: "0.1.0",
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "src", "server", "Provider.js"),
    "class Provider { static id = \"demo.template-context\"; register() {} boot() {} }\nexport { Provider };\n",
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "src", "server", "templateContext.js"),
    `function buildTemplateContext() {
  return ${returnExpression};
}

export { buildTemplateContext };
`,
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "templates", "generated.txt"),
    "namespace=${option:namespace|kebab} body=__BODY__\n",
    "utf8"
  );

  await writeFile(
    path.join(packageRoot, "package.descriptor.mjs"),
    `export default Object.freeze({
  packageId: "@demo/template-context-feature",
  version: "0.1.0",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  options: {
    namespace: {
      required: true
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        from: "templates/generated.txt",
        to: "src/generated/output.txt",
        templateContext: {
          entrypoint: "src/server/templateContext.js",
          export: "buildTemplateContext"
        }
      }
    ]
  }
});
`,
    "utf8"
  );
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test("add package applies file templateContext replacements", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "template-context-app");
    await createMinimalApp(appRoot, { name: "template-context-app" });
    await createTemplateContextPackage(appRoot, {
      returnExpression: "{ __BODY__: \"from-template-context\" }"
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/template-context-feature", "--namespace", "contact records", "--no-install"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const rendered = await readFile(path.join(appRoot, "src", "generated", "output.txt"), "utf8");
    assert.equal(rendered, "namespace=contact-records body=from-template-context\n");
  });
});

test("add package resolves file templateContext once for a mutation", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "template-context-single-pass-app");
    await createMinimalApp(appRoot, { name: "template-context-single-pass-app" });

    const packageRoot = path.join(appRoot, "packages", "template-context-single-pass-feature");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/template-context-single-pass-feature",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "Provider.js"),
      "class Provider { static id = \"demo.template-context.single-pass\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "templateContext.js"),
      `import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function buildTemplateContext({ appRoot } = {}) {
  const counterFile = path.join(String(appRoot || ""), ".template-context-counter");
  const currentCount = existsSync(counterFile)
    ? Number(readFileSync(counterFile, "utf8") || "0")
    : 0;
  writeFileSync(counterFile, String(currentCount + 1), "utf8");
  return { __BODY__: "single-pass" };
}

export { buildTemplateContext };
`,
      "utf8"
    );

    await writeFile(path.join(packageRoot, "templates", "generated.txt"), "body=__BODY__\n", "utf8");

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/template-context-single-pass-feature",
  version: "0.1.0",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        from: "templates/generated.txt",
        to: "src/generated/output.txt",
        templateContext: {
          entrypoint: "src/server/templateContext.js",
          export: "buildTemplateContext"
        }
      }
    ]
  }
});
`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/template-context-single-pass-feature", "--no-install"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const rendered = await readFile(path.join(appRoot, "src", "generated", "output.txt"), "utf8");
    assert.equal(rendered, "body=single-pass\n");

    const counterValue = await readFile(path.join(appRoot, ".template-context-counter"), "utf8");
    assert.equal(counterValue, "1");
  });
});

test("add package fails when file templateContext export returns non-object", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "template-context-invalid-app");
    await createMinimalApp(appRoot, { name: "template-context-invalid-app" });
    await createTemplateContextPackage(appRoot, {
      returnExpression: "\"invalid\""
    });

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/template-context-feature", "--namespace", "contacts", "--no-install"]
    });
    assert.equal(addResult.status, 1);
    assert.match(
      String(addResult.stderr || ""),
      /templateContext export "buildTemplateContext" must return an object map/
    );
  });
});

test("add package fails when file templateContext omits entrypoint", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "template-context-missing-entrypoint-app");
    await createMinimalApp(appRoot, { name: "template-context-missing-entrypoint-app" });

    const packageRoot = path.join(appRoot, "packages", "template-context-missing-entrypoint-feature");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/template-context-missing-entrypoint-feature",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "Provider.js"),
      "class Provider { static id = \"demo.template-context.missing.entrypoint\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );

    await writeFile(path.join(packageRoot, "templates", "generated.txt"), "body=__BODY__\n", "utf8");

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/template-context-missing-entrypoint-feature",
  version: "0.1.0",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        from: "templates/generated.txt",
        to: "src/generated/output.txt",
        templateContext: {
          export: "buildTemplateContext"
        }
      }
    ]
  }
});
`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/template-context-missing-entrypoint-feature", "--no-install"]
    });
    assert.equal(addResult.status, 1);
    assert.match(
      String(addResult.stderr || ""),
      /templateContext\.entrypoint is required when templateContext is set/
    );
  });
});

test("add package preflights templateContext before writing file mutations", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "template-context-preflight-app");
    await createMinimalApp(appRoot, { name: "template-context-preflight-app" });

    const packageRoot = path.join(appRoot, "packages", "template-context-preflight-feature");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
    await mkdir(path.join(packageRoot, "templates"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/template-context-preflight-feature",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "Provider.js"),
      "class Provider { static id = \"demo.template-context.preflight\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "src", "server", "templateContext.js"),
      `function buildTemplateContext() {
  throw new Error("resource invalid");
}

export { buildTemplateContext };
`,
      "utf8"
    );

    await writeFile(path.join(packageRoot, "templates", "plain.txt"), "plain-copy\n", "utf8");
    await writeFile(path.join(packageRoot, "templates", "templated.txt"), "body=__BODY__\n", "utf8");

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/template-context-preflight-feature",
  version: "0.1.0",
  runtime: {
    server: {
      providers: [{ entrypoint: "src/server/Provider.js", export: "Provider" }]
    },
    client: {
      providers: []
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [
      {
        from: "templates/plain.txt",
        to: "src/generated/plain.txt"
      },
      {
        from: "templates/templated.txt",
        to: "src/generated/templated.txt",
        templateContext: {
          entrypoint: "src/server/templateContext.js",
          export: "buildTemplateContext"
        }
      }
    ]
  }
});
`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/template-context-preflight-feature", "--no-install"]
    });
    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /resource invalid/);

    assert.equal(await fileExists(path.join(appRoot, "src", "generated", "plain.txt")), false);
    assert.equal(await fileExists(path.join(appRoot, "src", "generated", "templated.txt")), false);
  });
});
