import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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

test("create package scaffolds a local module in package.json.jskit", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "create-local-package-app");
    await createMinimalApp(appRoot, { name: "demo-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["create", "package", "feature-auth"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Created local package @demo-app\/feature-auth\./);

    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(appPackageJson.dependencies["@demo-app/feature-auth"], "file:packages/feature-auth");

    const localPackageJson = JSON.parse(await readFile(path.join(appRoot, "packages", "feature-auth", "package.json"), "utf8"));
    assert.equal(localPackageJson.name, "@demo-app/feature-auth");
    assert.equal(localPackageJson.exports["./client"], "./src/client/index.js");
    assert.equal(localPackageJson.exports["./server"], "./src/server/index.js");
    assert.equal(localPackageJson.exports["./shared"], "./src/shared/index.js");

    assert.ok(localPackageJson.jskit.capabilities);
    assert.ok(localPackageJson.jskit.runtime);
    assert.ok(localPackageJson.jskit.mutations);
  });
});

test("create package --dry-run reports changes without writing files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "create-local-package-dry-run-app");
    await createMinimalApp(appRoot, { name: "demo-app" });

    const result = runCli({
      cwd: appRoot,
      args: ["create", "package", "sample", "--dry-run", "--package-id", "@acme/sample"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Dry run enabled: no files were written\./);

    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    assert.equal(appPackageJson.dependencies, undefined);
  });
});

test("create migration authors an app-local template and package.json.jskit mutation", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "create-migration-app");
    await createMinimalApp(appRoot, { name: "demo-app" });

    const packageResult = runCli({
      cwd: appRoot,
      args: ["create", "package", "report-values"]
    });
    assert.equal(packageResult.status, 0, String(packageResult.stderr || ""));

    const migrationResult = runCli({
      cwd: appRoot,
      args: [
        "create",
        "migration",
        "--package",
        "@demo-app/report-values",
        "--id",
        "extend-report-value-field-types"
      ]
    });
    assert.equal(migrationResult.status, 0, String(migrationResult.stderr || ""));
    assert.match(
      String(migrationResult.stdout || ""),
      /Created package-owned migration source extend-report-value-field-types/
    );
    assert.match(
      String(migrationResult.stdout || ""),
      /npx jskit migrations sync/
    );

    const packageRoot = path.join(appRoot, "packages", "report-values");
    const templatePath = path.join(
      packageRoot,
      "templates",
      "migrations",
      "extend-report-value-field-types.cjs"
    );
    const templateSource = await readFile(templatePath, "utf8");
    const localPackageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));

    assert.match(templateSource, /Package-owned additive migration/);
    assert.match(templateSource, /Implement migration extend-report-value-field-types before synchronizing it/);
    assert.ok(localPackageJson.jskit.mutations.files.some((mutation) =>
      mutation.op === "install-migration" &&
      mutation.from === "templates/migrations/extend-report-value-field-types.cjs" &&
      mutation.id === "extend-report-value-field-types"
    ));
    await assert.rejects(() => readdir(path.join(appRoot, "migrations")));

    await writeFile(
      templatePath,
      `exports.up = async function up(knex) {
  await knex.schema.raw("SELECT 1");
};

exports.down = async function down(knex) {
  await knex.schema.raw("SELECT 1");
};
`,
      "utf8"
    );
    const materializeResult = runCli({
      cwd: appRoot,
      args: ["migrations", "sync"]
    });
    assert.equal(materializeResult.status, 0, String(materializeResult.stderr || ""));

    const migrationFiles = await readdir(path.join(appRoot, "migrations"));
    assert.equal(migrationFiles.length, 1);
    assert.match(migrationFiles[0], /^\d{14}_extend-report-value-field-types\.cjs$/u);
  });
});

test("create migration rejects duplicate ids without changing either source file", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "create-migration-duplicate-app");
    await createMinimalApp(appRoot, { name: "demo-app" });
    assert.equal(runCli({
      cwd: appRoot,
      args: ["create", "package", "report-values"]
    }).status, 0);

    const args = [
      "create",
      "migration",
      "--package",
      "@demo-app/report-values",
      "--id",
      "report-values-v2"
    ];
    const firstResult = runCli({ cwd: appRoot, args });
    assert.equal(firstResult.status, 0, String(firstResult.stderr || ""));

    const packageRoot = path.join(appRoot, "packages", "report-values");
    const manifestPath = path.join(packageRoot, "package.json");
    const templatePath = path.join(packageRoot, "templates", "migrations", "report-values-v2.cjs");
    const manifestBefore = await readFile(manifestPath, "utf8");
    const templateBefore = await readFile(templatePath, "utf8");

    const duplicateResult = runCli({ cwd: appRoot, args });
    assert.equal(duplicateResult.status, 1);
    assert.match(String(duplicateResult.stderr || ""), /already declares a file mutation with id report-values-v2/);
    assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
    assert.equal(await readFile(templatePath, "utf8"), templateBefore);
  });
});

test("create migration dry-run and help expose the supported authoring path", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "create-migration-dry-run-app");
    await createMinimalApp(appRoot, { name: "demo-app" });
    assert.equal(runCli({
      cwd: appRoot,
      args: ["create", "package", "report-values"]
    }).status, 0);

    const manifestPath = path.join(appRoot, "packages", "report-values", "package.json");
    const manifestBefore = await readFile(manifestPath, "utf8");
    const dryRunResult = runCli({
      cwd: appRoot,
      args: [
        "create",
        "migration",
        "--package",
        "@demo-app/report-values",
        "--id",
        "report-values-v2",
        "--dry-run"
      ]
    });
    assert.equal(dryRunResult.status, 0, String(dryRunResult.stderr || ""));
    assert.match(String(dryRunResult.stdout || ""), /Dry run enabled: no files were written/);
    assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
    await assert.rejects(() =>
      readFile(
        path.join(appRoot, "packages", "report-values", "templates", "migrations", "report-values-v2.cjs"),
        "utf8"
      )
    );

    const helpResult = runCli({
      cwd: appRoot,
      args: ["help", "create"]
    });
    assert.equal(helpResult.status, 0, String(helpResult.stderr || ""));
    assert.match(
      `${String(helpResult.stdout || "")}\n${String(helpResult.stderr || "")}`,
      /jskit create migration --package @local\/contacts --id add-contact-status/
    );
  });
});
