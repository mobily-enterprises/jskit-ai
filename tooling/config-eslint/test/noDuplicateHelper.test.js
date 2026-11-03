import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noDuplicateHelper } from "../plugin/rules/noDuplicateHelper.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const HELPER = "function toText(value) {\n  return String(value ?? \"\");\n}\nexport { toText };\n";
const ARROW = "const toLabel = (value) => String(value).trim();\nexport { toLabel };\n";
const SLOT_HELPER = "function slotName(slot) {\n  return `slot:${slot}`;\n}\nexport { slotName };\n";
const root = mkdtempSync(path.join(tmpdir(), "jskit-duplicate-helper-"));
const server = path.join(root, "booking", "src", "server");

function writeSource(relativePath, text) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

writeSource("booking/package.json", "{}\n");
writeSource("booking/src/server/format.js", HELPER);
writeSource("booking/src/server/noop.js", "function ignoreDenial() {}\nexport { ignoreDenial };\n");
writeSource("booking/src/server/answers.js", "async function answerNothing() {\n  return null;\n}\nfunction alwaysCurrent() {\n  return true;\n}\nexport { answerNothing, alwaysCurrent };\n");
writeSource("booking/src/server/test/fixture.js", HELPER.replace("toText", "fixtureText"));
writeSource("booking/src/server/vendor/package.json", "{}\n");
writeSource("booking/src/server/vendor/aaa.js", HELPER);
writeSource("booking/src/client/format.js", HELPER);
writeSource("invoices/package.json", "{}\n");
writeSource("invoices/src/server/format.js", HELPER);
// Scaffolding templates hold no package source.
writeSource("invoices/src/server/templates/slots.js", SLOT_HELPER);
writeSource("booking/src/server/labels.js", ARROW);
// A pattern's example application is a package of its own.
writeSource("shell/package.json", "{}\n");
writeSource("shell/lib/topology.js", HELPER);
writeSource("shell/patterns/page/PATTERN.md", "# Page\n");
writeSource("shell/patterns/page/example/src/topology.js", HELPER);
writeSource("shell/patterns/page/example/src/slots.js", SLOT_HELPER);
// The skill bundle's generated copy of a pattern is not compared.
writeSource("docs/package.json", "{}\n");
writeSource("docs/lib/format.js", HELPER);
writeSource("docs/skills/jskit/references/patterns/page/slots.js", SLOT_HELPER);

after(() => rmSync(root, { recursive: true, force: true }));

const relative = (file) => path.relative(process.cwd(), file).split(path.sep).join("/");
const first = `${relative(path.join(server, "format.js"))}:1`;
const firstLabel = `${relative(path.join(server, "labels.js"))}:1`;

new RuleTester().run("jskit/no-duplicate-helper", noDuplicateHelper, {
  valid: [
    { code: HELPER, filename: path.join(server, "format.js") },
    { code: HELPER, filename: path.join(server, "a-first.js") },
    { code: HELPER, filename: path.join(root, "invoices", "src", "server", "format.js") },
    { code: SLOT_HELPER, filename: path.join(root, "invoices", "src", "server", "slots.js") },
    { code: `export ${HELPER.replace("\nexport { toText };", "")}`, filename: path.join(server, "zeta.js") },
    { code: "function toLabel(value) {\n  return String(value).toUpperCase();\n}\nexport { toLabel };\n", filename: path.join(server, "zeta.js") },
    { code: `// readable-check: allow duplicate-helper - a published copy\n${HELPER}`, filename: path.join(server, "zeta.js") },
    { code: HELPER.replace("function", "async function"), filename: path.join(server, "zeta.js") },
    { code: "function keepCache() {}\nexport { keepCache };\n", filename: path.join(server, "zeta.js") },
    // A named constant answer, like a named no-op, says everything in its name.
    { code: "async function keepUploadsReady() {\n  return null;\n}\nconst stillCurrent = () => true;\nexport { keepUploadsReady, stillCurrent };\n", filename: path.join(server, "zeta.js") },
    { code: "let toLabel = (value) => String(value).trim();\nexport { toLabel };\n", filename: path.join(server, "zeta.js") },
    { code: HELPER, filename: path.join(root, "shell", "patterns", "page", "example", "src", "topology.js") },
    { code: SLOT_HELPER, filename: path.join(root, "shell", "zeta.js") },
    { code: HELPER, filename: path.join(root, "docs", "skills", "jskit", "references", "patterns", "page", "format.js") },
    { code: SLOT_HELPER, filename: path.join(root, "docs", "zeta.js") }
  ],
  invalid: [
    {
      code: HELPER,
      filename: path.join(server, "zeta.js"),
      errors: [{ messageId: "duplicateHelper", data: { name: "toText", first }, line: 1 }]
    },
    {
      code: `import "./format.js";\n\n${HELPER.replaceAll("toText", "asText")}`,
      filename: path.join(server, "nested", "labels.js"),
      errors: [{ messageId: "duplicateHelper", data: { name: "asText", first }, line: 3 }]
    },
    {
      code: ARROW.replaceAll("toLabel", "asLabel"),
      filename: path.join(server, "zeta.js"),
      errors: [{ messageId: "duplicateHelper", data: { name: "asLabel", first: firstLabel }, line: 1 }]
    },
    {
      code: "function asLabel(value) {\n  return String(value).trim();\n}\nexport { asLabel };\n",
      filename: path.join(server, "zeta.js"),
      errors: [{ messageId: "duplicateHelper", data: { name: "asLabel", first: firstLabel }, line: 1 }]
    },
    {
      code: "const one = 1,\n  asText = function (value) {\n    return String(value ?? \"\");\n  };\nexport { one, asText };\n",
      filename: path.join(server, "zeta.js"),
      errors: [{ messageId: "duplicateHelper", data: { name: "asText", first }, line: 2 }]
    },
    {
      code: HELPER,
      filename: path.join(root, "shell", "zeta.js"),
      errors: [{ messageId: "duplicateHelper", data: { name: "toText", first: `${relative(path.join(root, "shell", "lib", "topology.js"))}:1` }, line: 1 }]
    }
  ]
});
