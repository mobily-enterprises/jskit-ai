import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateI18nCatalogContract } from "../../../tooling/test-support/i18nCatalogContract.mjs";

// A throwaway repo with a shared kernel catalog and one package whose source
// sends undotted codes.
function fixtureRepo(t, { catalog, source }) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jskit-i18n-contract-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, file), content);
  };
  write("packages/kernel/locales/en.json", JSON.stringify({
    jskit: { errors: { not_found: "Not found." } }
  }));
  write("packages/sample/locales/en.json", JSON.stringify({ jskit: catalog }));
  write("packages/sample/src/server/errors.js", source);
  return { repoRoot, packageDir: path.join(repoRoot, "packages", "sample") };
}

test("an undotted code sent with fixed English needs its jskit.errors entry", (t) => {
  const { problems } = evaluateI18nCatalogContract(fixtureRepo(t, {
    catalog: { sample: { label: "Sample" } },
    source: [
      "const label = \"jskit.sample.label\";",
      "throw new AppError(409, \"This conversation is still working.\", { code: \"sample_busy\" });"
    ].join("\n")
  }));

  assert.deepEqual(problems, [
    "code sample_busy is sent with the fixed English \"This conversation is still working.\" but " +
      "jskit.errors.sample_busy is missing; catalog it, give the site a messageCode, or list the code in variableCodes"
  ]);
});

test("a catalogued, shared, named or variable undotted code passes", (t) => {
  const { problems } = evaluateI18nCatalogContract(fixtureRepo(t, {
    catalog: {
      errors: { sample_busy: "This conversation is still working." },
      sample: { stopped: "The command was stopped." }
    },
    source: [
      "throw new AppError(409, \"This conversation is still working.\", { code: \"sample_busy\" });",
      "throw new AppError(404, \"Not found.\", { code: \"not_found\" });",
      "throw new AppError(409, \"The command was stopped.\", { code: \"sample_busy\", messageCode: \"sample.stopped\" });",
      "throw new AppError(502, \"The provider refused the request.\", { code: \"sample_provider_failed\" });",
      "const options = { code: \"en\" };"
    ].join("\n")
  }));

  assert.deepEqual(problems, [
    "code sample_provider_failed is sent with the fixed English \"The provider refused the request.\" but " +
      "jskit.errors.sample_provider_failed is missing; catalog it, give the site a messageCode, or list the code in variableCodes"
  ]);

  const allowed = evaluateI18nCatalogContract({
    ...fixtureRepo(t, {
      catalog: { errors: { sample_busy: "This conversation is still working." } },
      source: "throw new AppError(502, \"The provider refused the request.\", { code: \"sample_provider_failed\" });\n" +
        "throw new AppError(409, \"This conversation is still working.\", { code: \"sample_busy\" });"
    }),
    variableCodes: ["sample_provider_failed"]
  });
  assert.deepEqual(allowed.problems, []);
});

test("an undotted code sent with English other than its catalog entry needs a messageCode", (t) => {
  const { problems } = evaluateI18nCatalogContract(fixtureRepo(t, {
    catalog: { errors: { sample_busy: "This conversation is still working." } },
    source: [
      "throw new AppError(409, \"This conversation is still working.\", { code: \"sample_busy\" });",
      "throw new AppError(409, \"The terminal is still open.\", { code: \"sample_busy\" });"
    ].join("\n")
  }));

  assert.deepEqual(problems, [
    "code sample_busy is sent with \"The terminal is still open.\", not jskit.errors.sample_busy's English; give the site a messageCode"
  ]);
});

test("a literal { code, message } entry must send its catalog English", (t) => {
  const { problems } = evaluateI18nCatalogContract(fixtureRepo(t, {
    catalog: { sample: { field: { required: "Name is required.", long: "Use at most {max} characters." } } },
    source: [
      "const required = { code: \"sample.field.required\", message: \"Name is required.\" };",
      "const long = { code: \"sample.field.long\", message: \"Use at most 80 characters.\", params: { max: 80 } };",
      "const wrong = { message: \"A name is required.\", code: \"sample.field.required\" };"
    ].join("\n")
  }));

  assert.deepEqual(problems, [
    "code sample.field.required is sent with \"A name is required.\", not its catalog English \"Name is required.\""
  ]);
});
