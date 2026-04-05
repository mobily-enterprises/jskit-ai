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

async function createMinimalMdiSvgApp(appRoot, { name = "tmp-app" } = {}) {
  await createMinimalApp(appRoot, { name });
  await mkdir(path.join(appRoot, "src"), { recursive: true });
  await writeFile(
    path.join(appRoot, "src", "main.js"),
    [
      "import { aliases as mdiAliases, mdi } from \"vuetify/iconsets/mdi-svg\";",
      "",
      "void mdiAliases;",
      "void mdi;"
    ].join("\n"),
    "utf8"
  );
}

test("doctor fails on raw mdi literal icon usage in vue templates for mdi-svg apps", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-mdi-svg-raw-literal-app");
    await createMinimalMdiSvgApp(appRoot, { name: "doctor-mdi-svg-raw-literal-app" });

    await writeFile(
      path.join(appRoot, "src", "App.vue"),
      [
        "<template>",
        "  <v-icon icon=\"mdi-paw\" />",
        "</template>"
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
      /src\/App\.vue:2: raw "mdi-paw" passed to <v-icon> icon while the app uses vuetify\/iconsets\/mdi-svg/
    );
  });
});

test("doctor fails on raw mdi bound literal icon usage in vue templates for mdi-svg apps", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-mdi-svg-bound-literal-app");
    await createMinimalMdiSvgApp(appRoot, { name: "doctor-mdi-svg-bound-literal-app" });

    await writeFile(
      path.join(appRoot, "src", "List.vue"),
      [
        "<template>",
        "  <v-list-item :prepend-icon=\"'mdi-cog-outline'\" />",
        "</template>"
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
      /src\/List\.vue:2: raw "mdi-cog-outline" passed to <v-list-item> prepend-icon while the app uses vuetify\/iconsets\/mdi-svg/
    );
  });
});

test("doctor allows mdi-svg vue usage via @mdi/js paths and ignores placement metadata icon strings", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "doctor-mdi-svg-valid-app");
    await createMinimalMdiSvgApp(appRoot, { name: "doctor-mdi-svg-valid-app" });

    await writeFile(
      path.join(appRoot, "src", "App.vue"),
      [
        "<script setup>",
        "import { mdiPaw } from \"@mdi/js\";",
        "</script>",
        "",
        "<template>",
        "  <v-icon :icon=\"mdiPaw\" />",
        "</template>"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "src", "placement.js"),
      [
        "export default [{",
        "  id: \"demo.settings\",",
        "  props: {",
        "    icon: \"mdi-cog-outline\"",
        "  }",
        "}];"
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
