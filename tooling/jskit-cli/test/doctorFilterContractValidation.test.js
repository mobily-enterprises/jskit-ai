import assert from "node:assert/strict";
import {
  mkdir,
  writeFile
} from "node:fs/promises";
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

test("doctor flags inline structured filter definitions in page files", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-inline-filter-definitions-app");
    await createMinimalApp(appRoot, { name: "doctor-inline-filter-definitions-app" });

    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      [
        "<script setup>",
        "const listFilters = useCrudListFilters({",
        "  onlyArchived: {",
        "    type: \"flag\",",
        "    label: \"Archived\"",
        "  }",
        "});",
        "</script>"
      ].join("\n"),
      "utf8"
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.equal(payload.issues.length, 1);
    assert.match(
      String(payload.issues[0] || ""),
      /src\/pages\/home\/contacts\/index\.vue:2: \[filters:shared-definition\] do not inline structured filter definitions in useCrudListFilters\(\.\.\.\)/
    );
  });
});

test("doctor flags createQueryValidator calls without explicit invalidValues policy", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-filter-validator-mode-app");
    await createMinimalApp(appRoot, { name: "doctor-filter-validator-mode-app" });

    await mkdir(path.join(appRoot, "packages", "contacts", "src", "server"), { recursive: true });
    await writeFile(
      path.join(appRoot, "packages", "contacts", "src", "server", "listQueryValidators.js"),
      [
        "const contactsListFiltersRuntime = {};",
        "const contactsListFiltersQueryValidator = contactsListFiltersRuntime.createQueryValidator({});",
        "",
        "void contactsListFiltersQueryValidator;"
      ].join("\n"),
      "utf8"
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 1, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.equal(payload.issues.length, 1);
    assert.match(
      String(payload.issues[0] || ""),
      /packages\/contacts\/src\/server\/listQueryValidators\.js:2: \[filters:validator-mode\] createQueryValidator\(\.\.\.\) must be written explicitly as createQueryValidator\(\{ invalidValues: "reject" \| "discard" \}\)/
    );
  });
});

test("doctor accepts shared filter definitions imported into runtimes and explicit validator policy", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-valid-filter-contract-app");
    await createMinimalApp(appRoot, { name: "doctor-valid-filter-contract-app" });

    await mkdir(path.join(appRoot, "packages", "contacts", "src", "shared"), { recursive: true });
    await mkdir(path.join(appRoot, "packages", "contacts", "src", "server"), { recursive: true });
    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });

    await writeFile(
      path.join(appRoot, "packages", "contacts", "src", "shared", "contactListFilters.js"),
      [
        "export const CONTACTS_LIST_FILTER_DEFINITIONS = Object.freeze({",
        "  onlyArchived: {",
        "    type: \"flag\",",
        "    label: \"Archived\"",
        "  }",
        "});"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "packages", "contacts", "src", "server", "contactListFilterSupport.js"),
      [
        "import { CONTACTS_LIST_FILTER_DEFINITIONS } from \"../shared/contactListFilters.js\";",
        "",
        "const contactsListFiltersRuntime = createCrudListFilters(CONTACTS_LIST_FILTER_DEFINITIONS, {",
        "  columns: {",
        "    onlyArchived: \"archived\"",
        "  }",
        "});",
        "",
        "void contactsListFiltersRuntime;"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "packages", "contacts", "src", "server", "listQueryValidators.js"),
      [
        "const contactsListFiltersRuntime = {};",
        "const contactsListFiltersQueryValidator = contactsListFiltersRuntime.createQueryValidator({",
        "  invalidValues: \"reject\"",
        "});",
        "",
        "void contactsListFiltersQueryValidator;"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      [
        "<script setup>",
        "import { CONTACTS_LIST_FILTER_DEFINITIONS } from \"../../../../../packages/contacts/src/shared/contactListFilters.js\";",
        "",
        "const listFilters = useCrudListFilters(CONTACTS_LIST_FILTER_DEFINITIONS, {",
        "  presets: []",
        "});",
        "",
        "void listFilters;",
        "</script>"
      ].join("\n"),
      "utf8"
    );

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor", "--json"]
    });

    assert.equal(doctorResult.status, 0, String(doctorResult.stderr || ""));
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.deepEqual(payload.issues, []);
  });
});
