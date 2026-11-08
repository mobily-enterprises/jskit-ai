import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noTransactionReader } from "../plugin/rules/noTransactionReader.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const EXCUSE = "// readable-check: allow no-transaction-reader - infrastructure: the transaction manager every handle runs on";

new RuleTester().run("jskit/no-transaction-reader", noTransactionReader, {
  valid: [
    "function save(row, options) { return records.create(row, options); }",
    "function settle(input, options) { return lots.withTransaction(options, (tx) => lots.patch(input.id, input.changes, tx)); }",
    "const next = { ...options, lockVersion: 2 };",
    // Settings ride in the options the call received, spread with the setting.
    "function once(options, work) { return lots.withTransaction({ ...options, retry: false }, work); }",
    "function takeOne(options) { return queue.claim({ filters: { due: true }, take: 1 }, { ...options, missing: \"skip\" }); }",
    "const { context } = options;",
    "const reference = payment.transaction.id;",
    "function begin(trx) { return trx; }",
    // Work reads the context from its txOptions and every other key from the method's own options.
    "const save = (row, options) => lots.withTransaction(options, async (txOptions) => { if (options.skipEmail) { return lots.create(row, { ...options, ...txOptions }); } return txOptions.context; });",
    "const top = (row, options) => balances.lockOrCreate(row, options, async (balance, txOptions) => balances.patch(balance.id, { total: balance.total + options.amount }, txOptions));",
    "const runAll = (database) => database.withTransaction(async (scope) => scope.raw);",
    `${EXCUSE}\nexport function joinOrOpen(options, work) { return options.trx ? work(options.trx) : open(work); }`,
    "/* readable-check: allow jskit/no-transaction-reader - infrastructure: the transaction manager */\nexport const client = ({ trx } = {}) => trx;"
  ],
  invalid: [
    {
      // txOptions are { context, trx }: an application key read from them is undefined, read directly, through an
      // optional chain, or where work's parameter shadows the method's options.
      code: [
        "const checkout = (order, options) => orders.withTransaction(options, async (txOptions) => {",
        "  if (txOptions.checkout) await notify(order, txOptions?.cache);",
        "});",
        "const add = (row, options) => lots.withTransaction(options, async (options) => lots.create(row, { ...options, returning: options.returning }));"
      ].join("\n"),
      errors: [
        { messageId: "txOptionsKey", data: { text: "txOptions.checkout", key: "checkout" }, line: 2 },
        { messageId: "txOptionsKey", data: { text: "txOptions?.cache", key: "cache" }, line: 2 },
        { messageId: "txOptionsKey", data: { text: "options.returning", key: "returning" }, line: 4 }
      ]
    },
    {
      // The same keys destructured, and lockOrCreate's work, whose second parameter is its txOptions.
      code: [
        "const send = (options) => mail.withTransaction(options, async ({ context, skipEmail }) => skipEmail || queue(context));",
        "const top = (row, options) => balances.lockOrCreate(row, options, (balance, txOptions = {}) => balance.total < txOptions.limit);"
      ].join("\n"),
      errors: [
        { messageId: "txOptionsKey", data: { text: "skipEmail", key: "skipEmail" }, line: 1 },
        { messageId: "txOptionsKey", data: { text: "txOptions.limit", key: "limit" }, line: 2 }
      ]
    },
    {
      code: "const client = options.trx || knex;",
      errors: [{ messageId: "handRead", data: { text: "options.trx" } }]
    },
    {
      code: "const client = options?.trx ?? knex;\nif (callOptions.trx) {}",
      errors: [{ messageId: "handRead", line: 1 }, { messageId: "handRead", line: 2 }]
    },
    {
      code: "await repository.list(query, { trx: options.trx });",
      errors: [{ messageId: "handRead", data: { text: "options.trx" } }]
    },
    {
      code: "await lots.withTransaction({ context: options.context, trx: options.trx, retry: false }, work);",
      errors: [{ messageId: "handRead", data: { text: "options.trx" } }]
    },
    {
      code: "function save(row, { trx, context }) { return [row, trx, context]; }",
      errors: [{ messageId: "handRead", data: { text: "Destructuring trx" } }]
    },
    {
      code: "const { trx = null } = options;\nconst { trx: transaction } = callOptions;",
      errors: [{ messageId: "handRead", line: 1 }, { messageId: "handRead", line: 2 }]
    },
    {
      code: "function save(row, trx = knex) { return trx(\"rows\").insert(row); }",
      errors: [{ messageId: "knexDefault", data: { text: "trx = knex" } }]
    },
    {
      code: "function save(row, trx = this.knex) { return row; }",
      errors: [{ messageId: "knexDefault", data: { text: "trx = this.knex" } }]
    },
    {
      code: "const transaction = options.transaction;\nawait api.query({ transaction: queryOptions.transaction }, context);\nconst t = opts.transaction;",
      errors: [{ messageId: "handRead", line: 1 }, { messageId: "handRead", line: 2 }, { messageId: "handRead", line: 3 }]
    },
    {
      code: "// readable-check: allow no-transaction-reader - infrastructure: not yet converted to handles\nconst client = options.trx;",
      errors: [{ messageId: "handRead" }]
    },
    {
      code: "const a = 1;\n// readable-check: allow no-transaction-reader - infrastructure: the transaction manager\nconst client = options.trx;",
      errors: [{ messageId: "handRead" }]
    },
    {
      code: "// readable-check: allow no-direct-knex - infrastructure: the transaction manager\nconst client = options.trx;",
      errors: [{ messageId: "handRead" }]
    },
    {
      code: "// readable-check: allow no-transaction-reader - data: a transaction handle\nconst client = options.trx;",
      errors: [{ messageId: "handRead" }]
    }
  ]
});
