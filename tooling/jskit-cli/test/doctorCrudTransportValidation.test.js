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

test("doctor flags explicit transport on high-level CRUD hooks", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-crud-transport-app");
    await createMinimalApp(appRoot, { name: "doctor-crud-transport-app" });

    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      [
        "<script setup>",
        "const records = useCrudList({",
        "  resource: contactsResource,",
        "  transport: { kind: \"jsonapi-resource\", responseType: \"contacts\", responseKind: \"collection\" }",
        "});",
        "",
        "const view = useCrudView({",
        "  resource: contactsResource,",
        "  transport: UI_VIEW_TRANSPORT",
        "});",
        "",
        "const formRuntime = useCrudAddEdit({",
        "  resource: contactsResource,",
        "  operationName: \"create\",",
        "  transport: UI_CREATE_TRANSPORT",
        "});",
        "",
        "void records;",
        "void view;",
        "void formRuntime;",
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
    assert.equal(payload.issues.length, 3);
    assert.match(
      String(payload.issues[0] || ""),
      /src\/pages\/home\/contacts\/index\.vue:2: \[crud:transport-derived\] do not pass explicit transport to useCrudList\(\.\.\.\)/
    );
    assert.match(
      String(payload.issues[1] || ""),
      /src\/pages\/home\/contacts\/index\.vue:7: \[crud:transport-derived\] do not pass explicit transport to useCrudView\(\.\.\.\)/
    );
    assert.match(
      String(payload.issues[2] || ""),
      /src\/pages\/home\/contacts\/index\.vue:12: \[crud:transport-derived\] do not pass explicit transport to useCrudAddEdit\(\.\.\.\)/
    );
  });
});

test("doctor allows explicit transport on lower-level request hooks", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-noncrud-transport-app");
    await createMinimalApp(appRoot, { name: "doctor-noncrud-transport-app" });

    await mkdir(path.join(appRoot, "src", "pages", "home", "contacts"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "pages", "home", "contacts", "index.vue"),
      [
        "<script setup>",
        "const records = useList({",
        "  query: {},",
        "  transport: { kind: \"jsonapi-resource\", responseType: \"contacts\", responseKind: \"collection\" }",
        "});",
        "",
        "const formRuntime = useAddEdit({",
        "  transport: { kind: \"jsonapi-resource\", requestType: \"contacts\", responseType: \"contacts\", responseKind: \"record\" }",
        "});",
        "",
        "void records;",
        "void formRuntime;",
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
