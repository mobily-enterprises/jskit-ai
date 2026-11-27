import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { requestRecoveryLabel } from "../plugin/rules/requestRecoveryLabel.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

// A screen read (useList, useView, useAddEdit and the CRUD composables on them) leaves shell-web's request recovery
// banner out unless requestRecovery is true, and refuses a requestRecoveryLabel without it, with a TypeError when the
// screen loads; lint names it first.
new RuleTester().run("jskit/request-recovery-label", requestRecoveryLabel, {
  valid: [
    "useList({ resource, requestRecovery: true, requestRecoveryLabel: \"Sites\" });",
    "useCrudListScreen({ resource, requestRecovery: { enabled: true }, requestRecoveryLabel });",
    "useView({ resource, requestRecovery: options.recovery, requestRecoveryLabel: \"Site\" });",
    // What a spread holds is not known here; the call itself still refuses a label without the banner.
    "useAddEdit({ ...options, requestRecoveryLabel: \"Site\" });",
    "useCrudList({ resource });",
    "useEndpointResource({ path, requestRecoveryLabel: \"Feed\" });",
    "translate({ requestRecoveryLabel: \"Sites\" });"
  ],
  invalid: [
    {
      code: "useCrudListScreen({ resource, requestRecoveryLabel: \"Contacts\" });",
      errors: [{ messageId: "labelWithoutRecovery", data: { callee: "useCrudListScreen" } }]
    },
    {
      code: "const view = crud.useCrudView({ resource, requestRecoveryLabel });",
      errors: [{ messageId: "labelWithoutRecovery", data: { callee: "useCrudView" } }]
    },
    {
      code: "useList({ resource, requestRecovery: false, \"requestRecoveryLabel\": \"Sites\" });",
      errors: [{ messageId: "labelWithoutRecovery", data: { callee: "useList" } }]
    },
    {
      code: "useAddEdit({ resource, requestRecovery: { enabled: false }, requestRecoveryLabel: \"Site\" });",
      errors: [{ messageId: "labelWithoutRecovery", data: { callee: "useAddEdit" } }]
    },
    {
      code: "useCrudAddEditScreen({ resource, requestRecovery: null, requestRecoveryLabel: \"Site\" });",
      errors: [{ messageId: "labelWithoutRecovery", data: { callee: "useCrudAddEditScreen" } }]
    }
  ]
});
