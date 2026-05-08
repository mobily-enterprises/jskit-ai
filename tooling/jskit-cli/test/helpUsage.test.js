import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

function assertHelpExamples(stdout, expectedPatterns = []) {
  assert.match(stdout, /Examples \(2\):/);
  assert.match(stdout, /Common usage/);
  assert.match(stdout, /More advanced usage/);
  for (const pattern of expectedPatterns) {
    assert.match(stdout, pattern);
  }
}

function assertMaxLineLength(stdout, maxLength = 100) {
  for (const line of String(stdout || "").split(/\r?\n/u)) {
    assert.ok(
      line.length <= maxLength,
      `Expected help line length <= ${maxLength}, got ${line.length}: ${line}`
    );
  }
}

test("jskit with no args prints top-level command overview", () => {
  const result = runCli({ args: [] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assertMaxLineLength(stdout);
  assert.match(stdout, /JSKit CLI/);
  assert.match(stdout, /Available commands:/);
  assert.match(stdout, /app\s+Run JSKIT-managed app maintenance helpers/);
  assert.match(stdout, /completion\s+Print shell completion script support/);
  assert.match(stdout, /generate\s+Run a generator package/);
  assert.match(stdout, /list-placements\s+List discovered UI placement targets/);
  assert.match(stdout, /list-component-tokens\s+List available placement component tokens/);
  assert.match(stdout, /Generator quick starts:/);
  assert.match(stdout, /feature-server-generator scaffold booking-engine/);
});

test("jskit help app prints app maintenance command help", () => {
  const result = runCli({ args: ["help", "app"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assertMaxLineLength(stdout);
  assert.match(stdout, /Command: app/);
  assert.match(stdout, /jskit app verify/);
  assert.match(stdout, /adopt-managed-scripts/);
  assert.match(stdout, /jskit app <subcommand> \[help\]/);
});

test("jskit app help release prints release-specific options", () => {
  const result = runCli({ args: ["app", "help", "release"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assertMaxLineLength(stdout);
  assert.match(stdout, /App subcommand: release/);
  assert.match(stdout, /--registry <url>/);
  assert.match(stdout, /--dry-run/);
});

test("jskit app help verify and doctor help mention --against", () => {
  const verifyResult = runCli({ args: ["app", "help", "verify"] });
  assert.equal(verifyResult.status, 0, String(verifyResult.stderr || ""));
  const verifyStdout = String(verifyResult.stdout || "");
  assertMaxLineLength(verifyStdout);
  assert.match(verifyStdout, /App subcommand: verify/);
  assert.match(verifyStdout, /--against <base-ref>/);

  const doctorResult = runCli({ args: ["help", "doctor"] });
  assert.equal(doctorResult.status, 0, String(doctorResult.stderr || ""));
  const doctorStdout = String(doctorResult.stdout || "");
  assertMaxLineLength(doctorStdout);
  assert.match(doctorStdout, /jskit doctor \[--against <base-ref>\] \[--json\]/);
});

test("jskit help completion prints completion command help", () => {
  const result = runCli({ args: ["help", "completion"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assertMaxLineLength(stdout);
  assert.match(stdout, /Command: completion/);
  assert.match(stdout, /jskit completion bash \[--install\]/);
  assert.match(stdout, /--install/);
  assert.match(stdout, /source <\(npx jskit completion bash\)/);
});

test("unsupported alias commands are rejected as unknown commands", () => {
  for (const alias of [
    "gen",
    "ls",
    "lp",
    "lct",
    "lpct",
    "list-link-items",
    "list-placement-component-tokens",
    "view"
  ]) {
    const result = runCli({ args: [alias] });
    assert.equal(result.status, 1, `expected ${alias} to fail`);
    assert.match(String(result.stderr || ""), new RegExp(`Unknown command: ${alias.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`));
  }
});

test("jskit generate with no params lists available generators", () => {
  const result = runCli({ args: ["generate"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assertMaxLineLength(stdout);
  assert.match(stdout, /Generate command/);
  assert.match(stdout, /Available generators \(\d+\):/);
  assert.match(stdout, /@jskit-ai\/crud-server-generator/);
  assert.match(stdout, /Recommended non-CRUD server starts \(\d+\):/);
  assert.match(stdout, /feature-server-generator scaffold[\s\S]*booking-engine/);
  assert.match(stdout, /jskit generate <generatorId> help/);
});

test("jskit add with no params lists bundles and runtime packages", () => {
  const result = runCli({ args: ["add"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assertMaxLineLength(stdout);
  assert.match(stdout, /Add command/);
  assert.match(stdout, /Available bundles \(\d+\):/);
  assert.match(stdout, /Available runtime packages \(\d+\):/);
  assert.match(stdout, /jskit add package <packageId> help/);
});

test("jskit help generate prints generate command help", () => {
  const result = runCli({ args: ["help", "generate"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assertMaxLineLength(stdout);
  assert.match(stdout, /Command: generate/);
  assert.match(stdout, /jskit generate <generatorId>/);
  assert.match(stdout, /3\) Examples/);
  assert.match(stdout, /feature-server-generator scaffold/);
  assert.match(stdout, /booking-engine/);
  assert.match(stdout, /availability-engine/);
});

test("jskit generate ui-generator help wraps long generator help lines", () => {
  const result = runCli({ args: ["generate", "ui-generator", "help"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assertMaxLineLength(stdout);
  assert.match(stdout, /Generator help: @jskit-ai\/ui-generator/);
  assert.match(stdout, /Subcommands \(\d+\):/);
  assert.match(stdout, /- add-subpages: Upgrade an existing page into a routed subpage host with[\s\S]*\n {2}ShellOutlet, and RouterView\./);
  assert.match(stdout, /- page \[primary\]: Create a route page at an explicit target file and add a link placement entry for[\s\S]*\n {2}it\./);
  assert.match(stdout, /Use subcommand help for positional args, options, notes, and examples:/);
  assert.match(stdout, /\n {2}jskit generate <generatorId> <subcommand> help/);
  assert.doesNotMatch(stdout, /jskit generate .* help <subcommand>/);
  assert.doesNotMatch(stdout, /- Use subcommand help for positional args, options, notes, and examples:/);
  assert.doesNotMatch(stdout, /Examples \(\d+\):/);
  assert.doesNotMatch(stdout, /Options \(\d+\):/);
});

test("jskit generate <generatorId> with no subcommand shows generator help", () => {
  const result = runCli({ args: ["generate", "ui-generator"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assertMaxLineLength(stdout);
  assert.match(stdout, /Generator help: @jskit-ai\/ui-generator/);
  assert.match(stdout, /Subcommands \(\d+\):/);
  assert.doesNotMatch(stdout, /Generated with @jskit-ai\/ui-generator/);
});

test("jskit generate --help prints generate command help", () => {
  const result = runCli({ args: ["generate", "--help"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Command: generate/);
  assert.match(stdout, /\[subcommand\]/);
});

test("jskit generate ui-generator outlet help prints outlet-specific usage", () => {
  const result = runCli({ args: ["generate", "ui-generator", "outlet", "help"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Generator subcommand help: @jskit-ai\/ui-generator outlet/);
  assert.match(stdout, /Long:/);
  assert.match(stdout, /A ShellOutlet creates a concrete placement recipient inside a Vue file\./);
  assert.match(stdout, /appends the semantic topology mapping for that outlet/);
  assert.match(stdout, /Notes \(2\):/);
  assert.doesNotMatch(stdout, /RouterView or SectionContainerShell/);
  assert.match(stdout, /target-file/);
  assert.match(stdout, /--target/);
});

test("jskit generate ui-generator outlet with no options prints subcommand help", () => {
  const result = runCli({ args: ["generate", "ui-generator", "outlet"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Generator subcommand help: @jskit-ai\/ui-generator outlet/);
  assert.match(stdout, /target-file/);
  assert.match(stdout, /--target/);
});

test("jskit generate ui-generator page help includes link options", () => {
  const result = runCli({ args: ["generate", "ui-generator", "page", "help"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assertMaxLineLength(stdout);
  assert.match(stdout, /Generator subcommand help: @jskit-ai\/ui-generator page/);
  assert.match(stdout, /Long:/);
  assert.match(stdout, /If an ancestor page has already been enhanced with sub-pages, JSKIT treats that ancestor outlet as\s+the real placement target\./);
  assert.match(stdout, /child pages\s+belong under `index\/\.\.\.`/);
  assert.match(stdout, /target-file \[required\]: Vue page file relative to src\/pages\/\. It must\s+resolve to a configured\s+surface\./);
  assert.match(stdout, /--link-placement/);
  assert.doesNotMatch(stdout, /--link-component-token/);
  assert.match(stdout, /--link-to/);
  assertHelpExamples(stdout, [
    /admin\/reports\/index\.vue/,
    /admin\/customers\/\[customerId\]\/index\/notes\/index\.vue/
  ]);
  assert.match(stdout, /Notes \(3\):/);
  assert.match(stdout, /semantic placement and props\.to are\s+inferred\s+automatically/);
  assert.match(stdout, /target page file already exists, rerun with --force/);
});

test("jskit generate ui-generator add-subpages help prints subpage target usage", () => {
  const result = runCli({ args: ["generate", "ui-generator", "add-subpages", "help"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Generator subcommand help: @jskit-ai\/ui-generator add-subpages/);
  assert.match(stdout, /target-file/);
  assert.match(stdout, /--target/);
  assert.match(stdout, /--title/);
  assert.match(stdout, /--subtitle/);
  assertHelpExamples(stdout, [
    /admin\/customers\/\[customerId\]\/index\.vue/,
    /contact-view:summary-tabs/
  ]);
  assert.match(stdout, /Notes \(2\):/);
  assert.match(stdout, /If the outlet page is index\.vue, create child pages under index\/\.\.\./);
});

test("jskit generate ui-generator placed-element help includes common and advanced examples", () => {
  const result = runCli({ args: ["generate", "ui-generator", "placed-element", "help"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Generator subcommand help: @jskit-ai\/ui-generator placed-element/);
  assert.match(stdout, /If --placement is omitted, the placed element is added at shell\.status\./);
  assert.match(stdout, /--name/);
  assert.match(stdout, /--surface/);
  assert.match(stdout, /--force/);
  assertHelpExamples(stdout, [/Alerts Widget/, /Ops Panel/, /--path src\/widgets/, /--force/]);
});

test("jskit generate ui-generator outlet help includes common and advanced examples", () => {
  const result = runCli({ args: ["generate", "ui-generator", "outlet", "help"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Generator subcommand help: @jskit-ai\/ui-generator outlet/);
  assert.match(stdout, /--target/);
  assertHelpExamples(stdout, [/ContactSummaryCard\.vue/, /customer-view:summary-actions/]);
});

test("jskit generate crud-ui-generator crud help includes common and advanced examples", () => {
  const result = runCli({ args: ["generate", "crud-ui-generator", "crud", "help"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Generator subcommand help: @jskit-ai\/crud-ui-generator crud/);
  assert.match(stdout, /Long:/);
  assert.match(stdout, /CRUD generation follows the same page-placement model as `ui-generator page`\./);
  assert.match(stdout, /read `jskit generate ui-generator page help`\./);
  assert.match(stdout, /target-root \[required\]: Route root directory relative to src\/pages\/ \(example: admin\/products\)\./);
  assert.match(stdout, /--resource-file/);
  assert.match(stdout, /--operations <text> \[optional; default: list,view,new,edit\]/);
  assertHelpExamples(stdout, [
    /admin\/catalog\/index\/products/,
    /admin\/customers\/\[customerId\]\/index\/pets/,
    /--id-param petId/
  ]);
  assert.match(stdout, /Notes \(3\):/);
  assert.match(stdout, /same mental\s+model as ui-generator page/);
  assert.match(stdout, /target root already exists and is not empty, rerun with --force/);
});

test("jskit generate assistant help includes examples for setup, page, and settings-page", () => {
  const cases = [
    {
      args: ["generate", "assistant", "setup", "help"],
      patterns: [/--settings-surface/, /--ai-api-key/, /CONSOLE_ASSISTANT/, /localhost:11434/, /Notes \(2\):/]
    },
    {
      args: ["generate", "assistant", "page", "help"],
      patterns: [/admin\/assistant\/index\.vue/, /admin\/ops\/copilot\/index\.vue/, /Page-link placement follows the same inference rules/]
    },
    {
      args: ["generate", "assistant", "settings-page", "help"],
      patterns: [/admin\/settings\/index\/assistant\/index\.vue/, /--surface app/, /App Assistant/, /Display label\./]
    }
  ];

  for (const testCase of cases) {
    const result = runCli({ args: testCase.args });
    assert.equal(result.status, 0, String(result.stderr || ""));
    const stdout = String(result.stdout || "");
    assertHelpExamples(stdout, testCase.patterns);
  }
});

test("jskit help list-component-tokens prints command help", () => {
  const result = runCli({ args: ["help", "list-component-tokens"] });
  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Command: list-component-tokens/);
  assert.match(stdout, /jskit list-component-tokens/);
  assert.match(stdout, /--prefix <value>/);
  assert.match(stdout, /--all/);
});
