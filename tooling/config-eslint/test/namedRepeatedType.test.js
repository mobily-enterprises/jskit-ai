import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { RuleTester } from "eslint";
import { namedRepeatedType } from "../plugin/rules/namedRepeatedType.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const root = mkdtempSync(path.join(tmpdir(), "jskit-repeated-type-"));
const server = path.join(root, "checklists", "src", "server");

function writeSource(relativePath, text) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const REPOSITORY_TYPE = "ReturnType<typeof import(\"./repository.js\").decorateChecklistsRepository>";
writeSource("checklists/package.json", "{}\n");
writeSource("checklists/src/server/checklistEmailService.js",
  `/** @param {${REPOSITORY_TYPE}} repository */\nexport function createChecklistEmailService(repository) {}\n` +
  "/** @param {import(\"@jskit-ai/crud-core/server/types\").CrudResourceApi[\"service\"]} contacts */\nexport function createContactsReader(contacts) {}\n" +
  "import { createMailer } from \"./mailer.js\";\n/** @param {ReturnType<typeof createMailer>} mailer */\nexport function createSender(mailer) {}\n" +
  "/** @typedef {ReturnType<typeof createService>} ChecklistEmailService */\nexport function createService() {}\n");
writeSource("checklists/src/server/types.js", "/** @typedef {ReturnType<typeof import(\"./jobContext.js\").createChecklistJobContext>} ChecklistJobContext */\nexport {};\n");
writeSource("checklists/src/server/test/fixture.js", "/** @type {import(\"./types.js\").Hidden[\"rows\"]} */\nexport const rows = [];\n");
writeSource("checklists/patterns/checklist-screen/example/server/service.js", "/** @type {import(\"./types.js\").Example[\"rows\"]} */\nexport const rows = [];\n");
// A pattern's example application (an `example` beside a PATTERN.md) is a package of its own.
writeSource("checklists/patterns/checklist-list/PATTERN.md", "# Checklist list\n");
writeSource("checklists/patterns/checklist-list/example/server/rows.js", "/** @type {import(\"./types.js\").Listed[\"rows\"]} */\nexport const rows = [];\n");
writeSource("invoices/package.json", "{}\n");
writeSource("invoices/src/server/service.js", "/** @param {import(\"@jskit-ai/crud-core/server/types\").CrudResourceApi[\"repository\"]} repository */\nexport function createService(repository) {}\n");

after(() => rmSync(root, { recursive: true, force: true }));

const listExample = path.join(root, "checklists", "patterns", "checklist-list", "example", "server");
const listedRows = path.relative(process.cwd(), path.join(listExample, "rows.js")).split(path.sep).join("/");

const emailService = path.relative(process.cwd(), path.join(server, "checklistEmailService.js")).split(path.sep).join("/");
const typesModule = path.relative(process.cwd(), path.join(server, "types.js")).split(path.sep).join("/");

new RuleTester().run("jskit/named-repeated-type", namedRepeatedType, {
  valid: [
    { code: "/** @param {import(\"./types.js\").ChecklistJobContext} context */\nexport function createImport(context) {}\n", filename: path.join(server, "checklistImportService.js") },
    { code: "/** @typedef {ReturnType<typeof createService>} ChecklistImportService */\nexport function createService() {}\n", filename: path.join(server, "checklistImportService.js") },
    { code: "/** @param {import(\"@jskit-ai/crud-core/server/types\").CrudResourceApi[\"repository\"]} repository */\nexport function createReader(repository) {}\n", filename: path.join(server, "reader.js") },
    { code: "/** @type {import(\"./types.js\").Hidden[\"rows\"]} */\nexport const rows = [];\n", filename: path.join(server, "rows.js") },
    { code: "/** @type {import(\"./types.js\").Example[\"rows\"]} */\nexport const rows = [];\n", filename: path.join(server, "examples.js") },
    { code: `/** @typedef {${REPOSITORY_TYPE}} ChecklistsRepository */\nexport {};\n`, filename: path.join(server, "types.js") },
    { code: "/** @type {import(\"./types.js\").Listed[\"rows\"]} */\nexport const listed = [];\n", filename: path.join(server, "listed.js") },
    { code: `/** @param {${REPOSITORY_TYPE}} repository */\nexport function createImport(repository) {}\n`, filename: path.join(root, "checklists", "skills", "jskit", "references", "patterns", "page", "example", "import.js") },
    { code: `// readable-check: allow repeated-type - data: the two services read one fixture type\n/** @param {${REPOSITORY_TYPE}} repository */\nexport function createImport(repository) {}\n`, filename: path.join(server, "checklistImportService.js") }
  ],
  invalid: [
    {
      code: `/** @param {${REPOSITORY_TYPE}} repository */\nexport function createImport(repository) {}\n`,
      filename: path.join(server, "checklistImportService.js"),
      errors: [{ messageId: "repeatedType", data: { type: REPOSITORY_TYPE, other: emailService }, line: 1, column: 13 }]
    },
    {
      code: `/**\n * @param {ReturnType<typeof import("../repository.js").decorateChecklistsRepository>} repository\n */\nexport function createImport(repository) {}\n`,
      filename: path.join(server, "nested", "checklistImportService.js"),
      errors: [{ messageId: "repeatedType", line: 2 }]
    },
    {
      code: "/** @param {import(\"@jskit-ai/crud-core/server/types\").CrudResourceApi[ 'service' ]} contacts */\nexport function createContacts(contacts) {}\n",
      filename: path.join(server, "contacts.js"),
      errors: [{ messageId: "repeatedType", data: { type: "import(\"@jskit-ai/crud-core/server/types\").CrudResourceApi[ 'service' ]", other: emailService } }]
    },
    {
      code: "import { createMailer as mailerFactory } from \"./mailer.js\";\n/** @param {{ mailer: ReturnType<typeof mailerFactory> }} dependencies */\nexport function createHub({ mailer }) {}\n",
      filename: path.join(server, "hub.js"),
      errors: [{ messageId: "repeatedType", data: { type: "ReturnType<typeof mailerFactory>", other: emailService } }]
    },
    {
      code: "/** @type {import(\"./types.js\").Listed[\"rows\"]} */\nexport const listed = [];\n",
      filename: path.join(listExample, "listed.js"),
      errors: [{ messageId: "repeatedType", data: { type: "import(\"./types.js\").Listed[\"rows\"]", other: listedRows } }]
    },
    {
      code: "/** @param {ReturnType<typeof import(\"./jobContext.js\").createChecklistJobContext>} context */\nexport function createImport(context) {}\n",
      filename: path.join(server, "checklistImportService.js"),
      errors: [{ messageId: "repeatedType", data: { type: "ReturnType<typeof import(\"./jobContext.js\").createChecklistJobContext>", other: typesModule } }]
    }
  ]
});
