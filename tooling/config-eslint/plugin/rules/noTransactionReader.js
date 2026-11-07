import { DATA_ACCESS_GUIDE_URL, compactText, keyName, ruleMeta, unwrapChain } from "../support.js";
import { INFRASTRUCTURE_HINT, KNEX_NAMES, isAssignmentTarget, isInfrastructureFile } from "../dataAccess.js";

// The options a call carries: `options`, `opts`, `callOptions`, `queryOptions`.
const OPTIONS_NAME = /^opts$|options$/iu;
const HINT = INFRASTRUCTURE_HINT;

// The Knex a `trx = knex` default falls back to: a Knex-named variable other than trx itself, or a `.knex` read.
function isKnexValue(node) {
  const value = unwrapChain(node);
  if (value?.type === "Identifier") {
    return KNEX_NAMES.has(value.name) && value.name !== "trx";
  }
  return value?.type === "MemberExpression" && !value.computed && value.property.name === "knex";
}

function isOptionsObject(node) {
  const value = unwrapChain(node);
  return value?.type === "Identifier" && OPTIONS_NAME.test(value.name);
}

// The transaction travels inside the call's options and nobody reads it by hand: not `options.trx`, not `{ trx }`, not
// `trx = knex`, not `options.transaction`. The handle joins options.trx itself, and withTransaction(options, work)
// hands work its txOptions.
const noTransactionReader = Object.freeze({
  meta: ruleMeta("Disallow reading the transaction out of a call's options by hand.", {
    handRead: `{{text}} reads the transaction by hand. Pass the call's options on untouched: every handle call joins options.trx itself, and withTransaction(options, work) hands work its txOptions. ${HINT}`,
    knexDefault: `{{text}} falls back to Knex when no transaction is passed. Take the call's options and pass them on; the handle joins the transaction when there is one. ${HINT}`
  }, "transactions", DATA_ACCESS_GUIDE_URL),
  create(context) {
    if (isInfrastructureFile(context, "no-transaction-reader")) {
      return {};
    }
    const sourceCode = context.sourceCode;
    return {
      MemberExpression(node) {
        if (node.computed || isAssignmentTarget(node)) {
          return;
        }
        if (node.property.name === "trx" || (node.property.name === "transaction" && isOptionsObject(node.object))) {
          context.report({ node, messageId: "handRead", data: { text: compactText(sourceCode, node) } });
        }
      },
      Property(node) {
        if (node.parent.type === "ObjectPattern" && !node.computed && keyName(node) === "trx") {
          context.report({ node, messageId: "handRead", data: { text: `Destructuring ${compactText(sourceCode, node)}` } });
        }
      },
      AssignmentPattern(node) {
        // Inside `{ trx = knex }` the destructuring is already reported.
        if (node.left.type === "Identifier" && node.left.name === "trx" && node.parent.type !== "Property" && isKnexValue(node.right)) {
          context.report({ node, messageId: "knexDefault", data: { text: compactText(sourceCode, node) } });
        }
      }
    };
  }
});

export { noTransactionReader };
