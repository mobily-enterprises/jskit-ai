import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { onePropertyPerLine } from "../plugin/rules/onePropertyPerLine.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/one-property-per-line", onePropertyPerLine, {
  valid: [
    "function createReads() {\n  return Object.freeze({\n    listInvoices,\n    readInvoice\n  });\n}",
    "function createReads() {\n  return Object.freeze({ listInvoices });\n}",
    "const field = { type: \"string\", required: true };",
    "function toRow(row) {\n  return { id: row.id, name: row.name };\n}",
    "const frozen = Object.freeze({ a: 1, b: 2 });",
    "const rows = items.map((item) => Object.freeze({ id: item.id, name: item.name }));",
    "const feature = defineFeature({\n  id: \"invoices\",\n  requires: {\n    database: \"runtime.database\",\n    logger: \"runtime.logger\"\n  },\n  provides: { invoices: \"invoices.service\" }\n});",
    "const options = buildOptions({ requires: { a: \"x\", b: \"y\" } });",
    "function createReads() {\n  // readable-check: allow one-property-per-line - data: a pair kept together\n  return Object.freeze({ low, high });\n}"
  ],
  invalid: [
    {
      code: "function createReads() {\n  return Object.freeze({ listInvoices, readInvoice });\n}",
      output: "function createReads() {\n  return Object.freeze({\n    listInvoices,\n    readInvoice\n  });\n}",
      errors: [{ messageId: "sharedLine", data: { place: "A frozen result", line: 2 } }]
    },
    {
      code: "const feature = defineFeature({\n  id: \"invoices\",\n  requires: { database: \"runtime.database\", logger: \"runtime.logger\" }\n});",
      output: "const feature = defineFeature({\n  id: \"invoices\",\n  requires: {\n    database: \"runtime.database\",\n    logger: \"runtime.logger\"\n  }\n});",
      errors: [{ messageId: "sharedLine", data: { place: "The requires map of defineFeature()", line: 3 } }]
    },
    {
      code: "const feature = defineFeature({\n  id: \"audit\",\n  late: { evidence: \"evidence.files\", notes: \"notes.files\" }\n});",
      output: "const feature = defineFeature({\n  id: \"audit\",\n  late: {\n    evidence: \"evidence.files\",\n    notes: \"notes.files\"\n  }\n});",
      errors: [{ messageId: "sharedLine", data: { place: "The late map of defineFeature()", line: 3 } }]
    },
    {
      code: "const provider = defineProvider({ id: \"x\", optional: { clock: \"x.clock\", mailer: \"x.mailer\" } });",
      output: "const provider = defineProvider({ id: \"x\", optional: {\n  clock: \"x.clock\",\n  mailer: \"x.mailer\"\n} });",
      errors: [{ messageId: "sharedLine", data: { place: "The optional map of defineProvider()", line: 1 } }]
    },
    {
      code: "function createReads() {\n  return Object.freeze({\n    listInvoices, readInvoice,\n    countInvoices\n  });\n}",
      output: "function createReads() {\n  return Object.freeze({\n    listInvoices,\n    readInvoice,\n    countInvoices\n  });\n}",
      errors: [{ messageId: "sharedLine", data: { place: "A frozen result", line: 3 } }]
    },
    {
      code: "function createReads() {\n  return Object.freeze({ listInvoices, /* the reader */ readInvoice });\n}",
      output: null,
      errors: [{ messageId: "sharedLine" }]
    },
    {
      code: "function createReads() {\n  return Object.freeze({ list, read() {\n    return 1;\n  } });\n}",
      output: "function createReads() {\n  return Object.freeze({\n    list,\n    read() {\n    return 1;\n  }\n  });\n}",
      errors: [{ messageId: "sharedLine" }]
    }
  ]
});
