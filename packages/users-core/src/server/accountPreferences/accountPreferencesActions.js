import {
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";
import { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS } from "../common/support/realtimeServiceEvents.js";

const accountPreferencesActionSpecifications = Object.freeze([
  {
    id: "settings.preferences.update",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "authenticated"
    },
    input: userSettingsResource.operations.preferencesUpdate.body,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: "settings.preferences.update"
    },
    observability: {},
    events: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
    async run(accountPreferencesService, input, context) {
      return accountPreferencesService.updatePreferences(
        resolveRequest(context),
        resolveActionUser(context, input),
        input,
        {
          context
        }
      );
    }
  }
]);

function buildAccountPreferencesActions({ accountPreferencesService } = {}) {
  if (!accountPreferencesService) throw new TypeError("buildAccountPreferencesActions requires accountPreferencesService.");
  return accountPreferencesActionSpecifications.map(({ run, ...definition }) => Object.freeze({
    ...definition,
    execute(input, context) {
      return run(accountPreferencesService, input, context);
    }
  }));
}

export { accountPreferencesActionSpecifications, buildAccountPreferencesActions };
