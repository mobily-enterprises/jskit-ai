import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
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

test("add/remove package applies managed vite proxy mutations", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "vite-proxy-mutations-app");
    await createMinimalApp(appRoot, { name: "vite-proxy-mutations-app" });

    const packageRoot = path.join(appRoot, "packages", "demo-realtime");
    await mkdir(path.join(packageRoot, "src", "server"), { recursive: true });

    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@demo/realtime",
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
      "class Provider { static id = \"demo.realtime\"; register() {} boot() {} }\nexport { Provider };\n",
      "utf8"
    );

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/realtime",
  version: "0.1.0",
  kind: "runtime",
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
    files: [],
    text: [],
    vite: {
      proxy: [
        {
          id: "socket-io",
          path: "/socket.io",
          changeOrigin: true,
          ws: true
        }
      ]
    }
  }
});\n`,
      "utf8"
    );

    const addResult = runCli({
      cwd: appRoot,
      args: ["add", "package", "@demo/realtime"]
    });
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const proxyConfigPath = path.join(appRoot, ".jskit", "vite.dev.proxy.json");
    const proxyConfig = JSON.parse(await readFile(proxyConfigPath, "utf8"));
    assert.deepEqual(proxyConfig, {
      version: 1,
      entries: [
        {
          packageId: "@demo/realtime",
          id: "socket-io",
          path: "/socket.io",
          changeOrigin: true,
          ws: true
        }
      ]
    });

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));
    const managedVite = lock?.installedPackages?.["@demo/realtime"]?.managed?.vite || {};
    assert.equal(Object.keys(managedVite).length, 1);
    assert.equal(managedVite["/socket.io::socket-io"]?.op, "upsert-vite-proxy");

    await writeFile(
      path.join(packageRoot, "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@demo/realtime",
  version: "0.1.0",
  kind: "runtime",
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
    files: [],
    text: [],
    vite: {
      proxy: [
        {
          id: "socket-io-v2",
          path: "/realtime",
          changeOrigin: true,
          ws: true
        }
      ]
    }
  }
});\n`,
      "utf8"
    );

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "package", "@demo/realtime"]
    });
    assert.equal(updateResult.status, 0, String(updateResult.stderr || ""));

    const updatedProxyConfig = JSON.parse(await readFile(proxyConfigPath, "utf8"));
    assert.deepEqual(updatedProxyConfig, {
      version: 1,
      entries: [
        {
          packageId: "@demo/realtime",
          id: "socket-io-v2",
          path: "/realtime",
          changeOrigin: true,
          ws: true
        }
      ]
    });

    const removeResult = runCli({
      cwd: appRoot,
      args: ["remove", "package", "@demo/realtime"]
    });
    assert.equal(removeResult.status, 0, String(removeResult.stderr || ""));

    await assert.rejects(access(proxyConfigPath), /ENOENT/);
  });
});
