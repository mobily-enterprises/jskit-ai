import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createCliRunner } from "../../testUtils/runCli.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createCustomRoleApp(appRoot) {
  await mkdir(path.join(appRoot, "config"), { recursive: true });
  await mkdir(path.join(appRoot, ".jskit"), { recursive: true });
  const packageJsonSource = `${JSON.stringify(
    {
      name: "custom-role-crud-app",
      version: "0.1.0",
      private: true,
      type: "module",
      workspaces: ["packages/*"]
    },
    null,
    2
  )}\n`;
  const rolesSource = `export const roleCatalog = {
  workspace: {
    defaultInviteRole: "worker"
  },
  roles: {
    owner: { assignable: false, permissions: ["*"] },
    member: { assignable: true, permissions: ["workspace.settings.view"] },
    administrator: { assignable: true, permissions: [] },
    safety_manager: { assignable: true, permissions: [] },
    worker: { assignable: true, permissions: [] }
  }
};
`;
  const publicConfigSource = `import { roleCatalog } from "./roles.js";

export const config = {
  surfaceDefinitions: {
    app: { id: "app", enabled: true, requiresAuth: true, requiresWorkspace: true }
  },
  roleCatalog
};
`;
  const lockSource = `${JSON.stringify(
    {
      lockVersion: 1,
      installedPackages: {
        "@jskit-ai/auth-provider-local-core": { version: "0.1.24" },
        "@jskit-ai/database-runtime-mysql": { version: "0.1.121" }
      }
    },
    null,
    2
  )}\n`;

  await writeFile(path.join(appRoot, "package.json"), packageJsonSource, "utf8");
  await writeFile(path.join(appRoot, "config", "roles.js"), rolesSource, "utf8");
  await writeFile(path.join(appRoot, "config", "public.js"), publicConfigSource, "utf8");
  await writeFile(path.join(appRoot, ".jskit", "lock.json"), lockSource, "utf8");

  return {
    packageJsonSource,
    rolesSource,
    publicConfigSource,
    lockSource
  };
}

test("crud generator requires an explicit grant policy before touching app files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "app");
    const original = await createCustomRoleApp(appRoot);

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "crud-server-generator",
        "scaffold",
        "--namespace",
        "notification_outbox_items",
        "--surface",
        "app",
        "--ownership-filter",
        "workspace",
        "--table-name",
        "notification_outbox_items",
        "--internal"
      ]
    });

    assert.equal(result.status, 1, String(result.stdout || ""));
    assert.match(
      String(result.stderr || ""),
      /requires an explicit permission grant policy.*--grant-role <role-id>.*--no-role-grant/s
    );
    assert.equal(await readFile(path.join(appRoot, "package.json"), "utf8"), original.packageJsonSource);
    assert.equal(await readFile(path.join(appRoot, "config", "roles.js"), "utf8"), original.rolesSource);
    assert.equal(await readFile(path.join(appRoot, "config", "public.js"), "utf8"), original.publicConfigSource);
    assert.equal(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"), original.lockSource);
    assert.equal(await fileExists(path.join(appRoot, "packages")), false);
    assert.equal(await fileExists(path.join(appRoot, "migrations")), false);
  });
});
