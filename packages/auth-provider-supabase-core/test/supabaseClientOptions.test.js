import test from "node:test";
import assert from "node:assert/strict";
import { buildSupabaseServerClientOptions } from "../src/server/lib/supabaseClientOptions.js";

test("buildSupabaseServerClientOptions omits realtime transport when native WebSocket exists", () => {
  const NativeWebSocket = function NativeWebSocket() {};
  const options = buildSupabaseServerClientOptions({
    nativeWebSocket: NativeWebSocket,
    fallbackTransport: function FallbackTransport() {}
  });

  assert.deepEqual(options, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
});

test("buildSupabaseServerClientOptions injects fallback transport when native WebSocket is unavailable", () => {
  const fallbackTransport = function FallbackTransport() {};
  const options = buildSupabaseServerClientOptions({
    nativeWebSocket: undefined,
    fallbackTransport
  });

  assert.deepEqual(options, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    realtime: {
      transport: fallbackTransport
    }
  });
});
