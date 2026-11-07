import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { baseConfig, typedFeaturesConfig } from "@jskit-ai/config-eslint/server";
import { ESLint } from "eslint";

const execFileAsync = promisify(execFile);

const patternRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../patterns/feature-package"
);

async function collectFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }
  await walk(root);
  return files.sort();
}

test("server feature pattern preserves the three useful package boundaries without authoring metadata", async () => {
  const document = await readFile(path.join(patternRoot, "PATTERN.md"), "utf8");
  const exampleFiles = await collectFiles(path.join(patternRoot, "example"));
  const sources = await Promise.all(exampleFiles.map((file) => readFile(file, "utf8")));
  const combinedSource = sources.join("\n");

  assert.match(document, /feature declaration, named capability inputs and outputs, and first-class\s+actions/u);
  assert.match(document, /repository-free lane/u);
  assert.match(document, /repository over a table the feature owns/u);
  assert.match(combinedSource, /defineFeature/u);
  assert.match(combinedSource, /const AvailabilityEngineFeature/u);
  assert.match(combinedSource, /owns: \[invoiceResource\]/u);
  assert.match(combinedSource, /invoices\.aggregate\(/u);
  assert.doesNotMatch(combinedSource, /createWithTransaction|database\.knex|runtime\.database/u);
  assert.doesNotMatch(combinedSource, /__JSKIT_|\$\{option:/u);
  assert.doesNotMatch(combinedSource, /scaffoldShape|scaffoldMode|provenance|receipt/u);

  for (const file of exampleFiles.filter((entry) => entry.endsWith(".js"))) {
    await execFileAsync(process.execPath, ["--check", file]);
  }
});

const TYPED_FEATURE_RULES = /^(?:jskit\/|max-lines)/u;

function typedFeaturesLinter() {
  return new ESLint({
    cwd: patternRoot,
    overrideConfigFile: true,
    overrideConfig: [...baseConfig, ...typedFeaturesConfig(["example/**"])]
  });
}

function typedFeatureFindings(results) {
  return results.flatMap((result) => result.messages
    .filter((message) => message.fatal || TYPED_FEATURE_RULES.test(message.ruleId || ""))
    .map((message) => `${path.relative(patternRoot, result.filePath)}:${message.line} ${message.ruleId || "parse"}`));
}

test("the feature package example passes the typed-features rules as errors", async () => {
  const eslint = typedFeaturesLinter();
  const results = await eslint.lintFiles(["example/**/*.js"]);
  assert.ok(results.length >= 11, `linted ${results.length} files`);
  assert.deepEqual(typedFeatureFindings(results), []);

  const probe = "export function createReader({ store } = {}) {\n  return () => store.read?.();\n}\n";
  const [probeResult] = await eslint.lintText(probe, {
    filePath: path.join(patternRoot, "example/booking-engine/src/server/reader.js")
  });
  assert.ok(probeResult.messages.some((message) => message.ruleId === "jskit/required-collaborators" && message.severity === 2));
});

test("the feature package example shows each typed-features shape", async () => {
  const serverRoot = path.join(patternRoot, "example/booking-engine/src/server");
  const read = (name) => readFile(path.join(serverRoot, name), "utf8");
  const [feature, engine, actions, types, availability] = await Promise.all([
    read("BookingEngineFeature.js"),
    read("bookingEngine.js"),
    read("bookingEngineActions.js"),
    read("types.js"),
    read("bookingAvailability.js")
  ]);

  assert.match(feature, /optional: \{\s+availability: "feature\.booking-engine\.availability"/u);
  assert.match(feature, /BookingEngineAvailability \| null \}\} capabilities/u);
  assert.match(feature, /availability: availability \?\? everyScopeOpen/u);
  assert.match(availability, /async function everyScopeOpen\(\)/u);
  assert.match(types, /@typedef \{ReturnType<typeof import\("\.\/bookingEngine\.js"\)\.createBookingEngine>\} BookingEngine/u);
  assert.match(types, /\} BookingEngineAvailability/u);
  assert.match(engine, /function createBookingEngine\(\{ availability \}\)/u);
  assert.match(engine, /import \{ resolveActorId \} from "@jskit-ai\/kernel\/server\/actions\/actionContributorHelpers";/u);
  assert.match(engine, /requestedBy: resolveActorId\(context\)/u);
  assert.match(engine, /return Object\.freeze\(\{ readStatus \}\);/u);
  assert.match(actions, /function createBookingEngineActions\(\{ bookingEngine \}\)/u);
  assert.match(actions, /execute: \(input, context\) => bookingEngine\.readStatus\(input, \{ context \}\)/u);
  assert.match(actions, /return Object\.freeze\(\[\s+Object\.freeze\(\{\s+\.\.\.BOOKING_QUERY,\s+id: ACTION_GET_STATUS,/u);
  assert.match(actions, /const BOOKING_QUERY = Object\.freeze\(\{/u);

  const exampleSource = (await Promise.all(
    (await collectFiles(path.join(patternRoot, "example")))
      .filter((file) => file.endsWith(".js"))
      .map((file) => readFile(file, "utf8"))
  )).join("\n");
  assert.doesNotMatch(exampleSource, /async execute|execute: async|\?\.\w+\?\.\(|= null[,)}]/u);
  assert.doesNotMatch(exampleSource, /actionDefaults/u, "Shared action fields come from a constant each definition spreads.");
  assert.doesNotMatch(exampleSource, /^\/\/ .*\n(?:async )?function /mu, "A description sits in a // line above a function.");
});
