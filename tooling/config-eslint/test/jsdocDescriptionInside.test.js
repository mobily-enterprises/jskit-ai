import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { jsdocDescriptionInside } from "../plugin/rules/jsdocDescriptionInside.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/jsdoc-description-inside", jsdocDescriptionInside, {
  valid: [
    "/**\n * Resolves the profile mirror's repositories.\n * @param {UsersIdentity} identity\n */\nfunction createProfileMirror(identity) {}",
    "// The type of the `feature.booking-engine` capability, for features that require it.\n\n/** @typedef {ReturnType<typeof import(\"./bookingEngine.js\").createBookingEngine>} BookingEngine */",
    "// eslint-disable-next-line max-lines-per-function -- one route table\n/** @param {RuntimeRouter} router */\nfunction registerHubRoutes(router) {}",
    "// readable-check: allow method-probe - platform object: a fetch Response may lack getSetCookie()\n/** @type {any} */ (response).getSetCookie?.();",
    "const limit = 10; // the page size\n/** @param {number} page */\nfunction readPage(page) {}",
    "// A plain comment above code.\nfunction readPage(page) {}",
    "/* not JSDoc */\n// heading\n/* still not JSDoc */\nconst x = 1;"
  ],
  invalid: [
    {
      code: "// Supplies the transfer account rows a group's invoices need.\n/** @param {TransferAccounts} accounts */\nfunction createTransferRows(accounts) {}",
      errors: [{ messageId: "descriptionOutside", line: 1, endLine: 1 }]
    },
    {
      code: "// The session changes the terminals service publishes, one publisher per kind\n// of change; they all share one session change publisher.\n/** @param {RuntimeEvents} events */\nfunction createTerminalSessionChangedPublishers(events) {}",
      errors: [{ messageId: "descriptionOutside", line: 1, endLine: 2 }]
    },
    {
      code: "function createService() {\n  // Cross-project commands act for the person who submitted the current request.\n  /**\n   * @param {SessionStore} store\n   */\n  function forRequest(store) {}\n  return Object.freeze({ forRequest });\n}",
      errors: [{ messageId: "descriptionOutside", line: 2 }]
    },
    {
      code: "// An absent definition reaches the checks below, which name what is missing.\n/** @param {ProviderDefinition} [definition] */\nfunction defineProvider(definition) {}",
      errors: [{ messageId: "descriptionOutside" }]
    }
  ]
});
