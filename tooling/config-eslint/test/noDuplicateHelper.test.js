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
const root = mkdtempSync(path.join(tmpdir(), "jskit-duplicate-helper-"));
const server = path.join(root, "booking", "src", "server");

function writeSource(relativePath, text) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

writeSource("booking/package.json", "{}\n");
writeSource("booking/src/server/format.js", HELPER);
writeSource("booking/src/server/test/fixture.js", HELPER.replace("toText", "fixtureText"));
writeSource("booking/src/server/vendor/package.json", "{}\n");
writeSource("booking/src/server/vendor/aaa.js", HELPER);
writeSource("booking/src/client/format.js", HELPER);
writeSource("invoices/package.json", "{}\n");
writeSource("invoices/src/server/format.js", HELPER);

after(() => rmSync(root, { recursive: true, force: true }));

const first = `${path.relative(process.cwd(), path.join(server, "format.js")).split(path.sep).join("/")}:1`;

new RuleTester().run("jskit/no-duplicate-helper", noDuplicateHelper, {
  valid: [
    { code: HELPER, filename: path.join(server, "format.js") },
    { code: HELPER, filename: path.join(server, "a-first.js") },
    { code: HELPER, filename: path.join(root, "invoices", "src", "server", "format.js") },
    { code: `export ${HELPER.replace("\nexport { toText };", "")}`, filename: path.join(server, "zeta.js") },
    { code: "function toLabel(value) {\n  return String(value).toUpperCase();\n}\nexport { toLabel };\n", filename: path.join(server, "zeta.js") },
    { code: `// readable-check: allow duplicate-helper - a published copy\n${HELPER}`, filename: path.join(server, "zeta.js") }
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
    }
  ]
});
