import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { actionCreator } from "../plugin/rules/actionCreator.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const definition = "Object.freeze({ id: ACTION_READ, input: readInput, execute: (input, context) => invoices.read(input, { context }) })";

new RuleTester().run("jskit/action-creator", actionCreator, {
  valid: [
    `function createInvoiceActions({ invoices }) { return Object.freeze([${definition}]); }`,
    `const createInvoiceActions = ({ invoices }) => Object.freeze([${definition}]);`,
    `function createInvoiceActions() { return Object.freeze([Object.freeze({ id: "invoices.ping", execute: () => pong() })]); }`,
    "defineCrudJsonApiFeature({ actions: { archive: { id: \"crud.invoices.archive\", execute: ({ input, service }) => service.archive(input) } } });",
    "const route = { id: \"invoices.read\", method: \"GET\" };"
  ],
  invalid: [
    {
      code: `const READ_ACTION = ${definition};`,
      errors: [{ messageId: "outsideCreator", data: { action: "ACTION_READ" } }]
    },
    {
      code: `defineFeature({ id: "invoices", actions({ invoices }) { return Object.freeze([${definition}]); } });`,
      errors: [{ messageId: "outsideCreator" }]
    },
    {
      code: `function buildInvoiceActions(invoices) { return Object.freeze([${definition}]); }`,
      errors: [{ messageId: "outsideCreator" }]
    },
    {
      code: `function createInvoiceActions(invoices) { return Object.freeze([${definition}]); }`,
      errors: [{ messageId: "positionalCreator", data: { name: "createInvoiceActions" } }]
    }
  ]
});
