import { DATA_ACCESS_GUIDE_URL, compactText, keyName, ruleMeta, unwrapChain } from "../support.js";
import { INFRASTRUCTURE_HINT, KNEX_NAMES, calledMethod, isAssignmentTarget, isInfrastructureFile } from "../dataAccess.js";

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

// The work callbacks a handle hands its transaction options: withTransaction(options, work) gives work's first
// parameter, lockOrCreate(row, options, work) its second (after the record).
const WORK_CALLBACKS = Object.freeze({ withTransaction: { work: 1, parameter: 0 }, lockOrCreate: { work: 2, parameter: 1 } });
// All that transaction options hold: the call's context and its transaction.
const TX_OPTIONS_KEYS = new Set(["context", "trx"]);

// The parameter a work callback receives its transaction options in, or null when the call is no handle's work call.
function txOptionsParameter(node) {
  const method = calledMethod(node);
  const callback = method ? WORK_CALLBACKS[method.name] : null;
  const work = callback ? node.arguments[callback.work] : null;
  if (work?.type !== "ArrowFunctionExpression" && work?.type !== "FunctionExpression") {
    return null;
  }
  const parameter = work.params[callback.parameter];
  return { work, parameter: parameter?.type === "AssignmentPattern" ? parameter.left : parameter };
}

const NULLISH = (node) => (node?.type === "Literal" && node.value === null) || (node?.type === "Identifier" && node.name === "undefined");

// What an `if` that tests a transaction read and throws asks for: "joinOnly" when it throws without one (`if
// (!options.trx) throw ...`, `if (options.trx == null) { throw ... }`), "outermost" when it throws inside one (`if
// (options.trx) throw ...`), also inside && or ||. Null for any other read.
function transactionRequirement(node) {
  let test = node;
  let present = true;
  for (;;) {
    const parent = test.parent;
    if (parent?.type === "UnaryExpression" && parent.operator === "!") {
      present = !present;
    } else if (parent?.type === "BinaryExpression" && ["==", "===", "!=", "!=="].includes(parent.operator) &&
      NULLISH(parent.left === test ? parent.right : parent.left)) {
      present = parent.operator.startsWith("!") ? present : !present;
    } else if (parent?.type !== "ChainExpression" && parent?.type !== "LogicalExpression") {
      break;
    }
    test = parent;
  }
  const statement = test.parent;
  if (statement?.type !== "IfStatement" || statement.test !== test) {
    return null;
  }
  const { consequent } = statement;
  const throws = consequent.type === "ThrowStatement" || (consequent.type === "BlockStatement" && consequent.body.some(({ type }) => type === "ThrowStatement"));
  return throws ? (present ? "outermost" : "joinOnly") : null;
}

// The transaction travels inside the call's options and nobody reads it by hand: not `options.trx`, not `{ trx }`, not
// `trx = knex`, not `options.transaction`. The handle joins options.trx itself, and withTransaction(options, work)
// hands work its txOptions. Those hold `{ context, trx }` and nothing else, so a key work reads from them, the
// application's own included (`txOptions.checkout`, or `options.checkout` where work's parameter shadows the method's
// options), is always undefined there. Code that requires its caller's transaction (`if (!options.trx) throw`) runs
// its work in withTransaction({ ...options, joinOnly: true }, work) instead, which refuses a call outside one, and code
// that refuses one (`if (options.trx) throw`) in withTransaction({ ...options, outermost: true }, work).
const noTransactionReader = Object.freeze({
  meta: ruleMeta("Disallow reading the transaction out of a call's options by hand.", {
    handRead: `{{text}} reads the transaction by hand. Pass the call's options on untouched: every handle call joins options.trx itself, and withTransaction(options, work) hands work its txOptions. ${HINT}`,
    joinOnly: `{{text}} checks by hand that the call runs in its caller's transaction. Run the work in withTransaction({ ...options, joinOnly: true }, work), which joins the caller's transaction and refuses a call outside one; code never asks whether it runs in a transaction. ${HINT}`,
    outermost: `{{text}} checks by hand that the call runs outside a transaction. Run the work in withTransaction({ ...options, outermost: true }, work), which opens its own transaction and refuses a call inside one; code never asks whether it runs in a transaction. ${HINT}`,
    knexDefault: `{{text}} falls back to Knex when no transaction is passed. Take the call's options and pass them on; the handle joins the transaction when there is one. ${HINT}`,
    txOptionsKey: `{{text}} reads {{key}} from the transaction options the work receives, which are { context, trx } and nothing else, so it is undefined there. Read it from the method's own options, and name the work's parameter txOptions. ${HINT}`
  }, "transactions", DATA_ACCESS_GUIDE_URL),
  create(context) {
    if (isInfrastructureFile(context, "no-transaction-reader")) {
      return {};
    }
    const sourceCode = context.sourceCode;
    const reportKey = (node, key) => context.report({ node, messageId: "txOptionsKey", data: { text: compactText(sourceCode, node), key } });
    return {
      CallExpression(node) {
        const { work, parameter } = txOptionsParameter(node) || {};
        if (parameter?.type === "ObjectPattern") {
          // A destructured trx is reported as a hand read below.
          for (const property of parameter.properties) {
            if (property.type === "Property" && !property.computed && !TX_OPTIONS_KEYS.has(keyName(property))) {
              reportKey(property, keyName(property));
            }
          }
        } else if (parameter?.type === "Identifier") {
          const variable = sourceCode.getDeclaredVariables(work).find(({ name }) => name === parameter.name);
          for (const { identifier } of variable?.references || []) {
            const member = identifier.parent;
            if (member.type === "MemberExpression" && member.object === identifier && !member.computed &&
              !TX_OPTIONS_KEYS.has(member.property.name) && !isAssignmentTarget(member)) {
              reportKey(member, member.property.name);
            }
          }
        }
      },
      MemberExpression(node) {
        if (node.computed || isAssignmentTarget(node)) {
          return;
        }
        if (node.property.name === "trx" || (node.property.name === "transaction" && isOptionsObject(node.object))) {
          const messageId = transactionRequirement(node) ?? "handRead";
          context.report({ node, messageId, data: { text: compactText(sourceCode, node) } });
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
