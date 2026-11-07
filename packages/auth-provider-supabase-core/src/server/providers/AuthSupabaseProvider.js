import {
  attachDeferredAuthService,
  createDeferredAuthService
} from "@jskit-ai/auth-core/server/deferredAuthService";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { assertSelectedProvider, resolveSupabaseConfig } from "../lib/config.js";
import { PROVIDER_MODE_PROFILES, createUsersModeProfiles } from "../lib/profileModes.js";
import { createSupabaseAuthService } from "../lib/service.js";

const AuthSupabaseProvider = defineProvider({
  id: "auth.supabase",
  requires: {
    config: "runtime.config",
    env: "runtime.env",
    extensions: "auth.extensions"
  },
  optional: {
    profileProjector: "auth.profile.projector",
    userProfiles: "users.profiles",
    userSettings: "users.settings"
  },
  provides: {
    authService: "auth.service"
  },
  /**
   * @param {object} dependencies
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
   */
  setup({ env }) {
    assertSelectedProvider(env);
    return { authService: createDeferredAuthService() };
  },
  /**
   * @param {object} dependencies
   * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} dependencies.config
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
   * @param {import("@jskit-ai/auth-core/server/types").AuthExtensions} dependencies.extensions
   * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector | null} dependencies.profileProjector The app profile projector, when users-core is installed.
   * @param {import("@jskit-ai/users-core/server/types").UsersProfiles | null} dependencies.userProfiles The users' records, when users-core is installed.
   * @param {import("@jskit-ai/users-core/server/types").UsersSettings | null} dependencies.userSettings The users' settings, when users-core is installed.
   */
  boot({ config, env, extensions, profileProjector, userProfiles, userSettings }, { outputs }) {
    const supabaseConfig = resolveSupabaseConfig({ config, env });
    if (supabaseConfig.profileMode === "users" && !(profileProjector && userProfiles && userSettings)) {
      throw new Error(
        'Supabase auth profileMode "users" requires the users.profiles, users.settings and auth.profile.projector capabilities.'
      );
    }
    const profiles = supabaseConfig.profileMode === "users"
      ? createUsersModeProfiles({ profileProjector, userProfiles, userSettings })
      : PROVIDER_MODE_PROFILES;
    const baseService = createSupabaseAuthService({ config: supabaseConfig, profiles });
    // readable-check: allow setter-seam - deferred until boot: auth.service is built after every setup has registered its auth extensions, and those setups already receive it
    attachDeferredAuthService(outputs.authService, extensions.decorateService(baseService));
  }
});

export { AuthSupabaseProvider };
