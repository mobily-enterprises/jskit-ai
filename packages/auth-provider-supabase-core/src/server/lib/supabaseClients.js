import { createClient } from "@supabase/supabase-js";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { buildSupabaseServerClientOptions } from "./supabaseClientOptions.js";

/**
 * New Supabase clients for the app's project. Each operation makes its own,
 * since a client holds the session it signs in with.
 * @param {import("../types.js").SupabaseConfig} config
 */
function createSupabaseClients(config) {
  /** Refuses the operation when the app names no Supabase project. */
  function ensureConfigured() {
    if (!config.configured) {
      throw new AppError(500, "Auth provider is not configured.", { code: "auth.supabase.config.missing" });
    }
  }

  function createSupabaseClient() {
    ensureConfigured();
    return createClient(config.supabaseUrl, config.supabasePublishableKey, buildSupabaseServerClientOptions());
  }

  return Object.freeze({ ensureConfigured, createSupabaseClient });
}

export { createSupabaseClients };
