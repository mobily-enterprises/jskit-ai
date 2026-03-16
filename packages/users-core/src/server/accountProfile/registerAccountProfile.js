import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import {
  ACCOUNT_SETTINGS_CHANGED_EVENT,
  USERS_BOOTSTRAP_CHANGED_EVENT
} from "../../shared/events/usersEvents.js";
import { createService as createAccountProfileService } from "./accountProfileService.js";
import { createService as createAvatarStorageService } from "./avatarStorageService.js";
import { createService as createAvatarService } from "./avatarService.js";
import { accountProfileActions } from "./accountProfileActions.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import {
  USERS_AVATAR_STORAGE_SERVICE_TOKEN,
  USERS_AVATAR_SERVICE_TOKEN
} from "../common/diTokens.js";

const USERS_ACCOUNT_PROFILE_SERVICE_TOKEN = "users.accountProfile.service";
const ACCOUNT_PROFILE_CHANGE_EVENTS = deepFreeze([
  {
    type: "entity.changed",
    source: "account",
    entity: "settings",
    operation: "updated",
    entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
    realtime: {
      event: ACCOUNT_SETTINGS_CHANGED_EVENT,
      audience: "actor_user"
    }
  },
  {
    type: "entity.changed",
    source: "users",
    entity: "bootstrap",
    operation: "updated",
    entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
    realtime: {
      event: USERS_BOOTSTRAP_CHANGED_EVENT,
      audience: "actor_user"
    }
  }
]);

function registerAccountProfile(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
    throw new Error("registerAccountProfile requires application singleton()/service()/actions().");
  }

  app.singleton(USERS_AVATAR_STORAGE_SERVICE_TOKEN, (scope) =>
    createAvatarStorageService({
      storage: scope.make(KERNEL_TOKENS.Storage)
    })
  );

  app.singleton(USERS_AVATAR_SERVICE_TOKEN, (scope) =>
    createAvatarService({
      userProfilesRepository: scope.make("userProfilesRepository"),
      avatarStorageService: scope.make(USERS_AVATAR_STORAGE_SERVICE_TOKEN)
    })
  );

  app.service(
    USERS_ACCOUNT_PROFILE_SERVICE_TOKEN,
    (scope) =>
      createAccountProfileService({
        userSettingsRepository: scope.make("userSettingsRepository"),
        userProfilesRepository: scope.make("userProfilesRepository"),
        authService: scope.make("authService"),
        avatarService: scope.make(USERS_AVATAR_SERVICE_TOKEN)
      }),
    {
      events: deepFreeze({
        updateProfile: ACCOUNT_PROFILE_CHANGE_EVENTS,
        uploadAvatar: ACCOUNT_PROFILE_CHANGE_EVENTS,
        deleteAvatar: ACCOUNT_PROFILE_CHANGE_EVENTS
      })
    }
  );

  app.actions(
    withActionDefaults(accountProfileActions, {
      domain: "settings",
      dependencies: {
        accountProfileService: USERS_ACCOUNT_PROFILE_SERVICE_TOKEN
      }
    })
  );
}

export { USERS_ACCOUNT_PROFILE_SERVICE_TOKEN, registerAccountProfile };
