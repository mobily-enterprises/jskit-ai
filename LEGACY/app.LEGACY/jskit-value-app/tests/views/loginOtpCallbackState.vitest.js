import { describe, expect, it } from "vitest";

import {
  readOtpLoginCallbackStateFromLocation,
  stripOtpLoginCallbackParamsFromLocation
} from "../../src/views/login/lib/loginOtpCallbackState.js";

describe("loginOtpCallbackState", () => {
  it("reads OTP callback state from search and hash", () => {
    window.history.replaceState({}, "", "/login?token_hash=hash-token&type=email");
    expect(readOtpLoginCallbackStateFromLocation()).toEqual({
      tokenHash: "hash-token",
      type: "email",
      errorCode: "",
      errorDescription: ""
    });

    window.history.replaceState({}, "", "/login#error=access_denied&error_description=cancelled&type=email");
    expect(readOtpLoginCallbackStateFromLocation()).toEqual({
      tokenHash: "",
      type: "email",
      errorCode: "access_denied",
      errorDescription: "cancelled"
    });
  });

  it("returns null when callback hints are absent and strips callback params", () => {
    window.history.replaceState({}, "", "/login?foo=bar");
    expect(readOtpLoginCallbackStateFromLocation()).toBeNull();

    window.history.replaceState(
      {},
      "",
      "/login?token_hash=abc&type=email&error=bad&error_description=oops&expires_in=3600&foo=bar#token=one&keep=yes"
    );

    stripOtpLoginCallbackParamsFromLocation();

    expect(window.location.pathname).toBe("/login");
    expect(window.location.search).toBe("?foo=bar");
    expect(window.location.hash).toBe("#keep=yes");
  });
});
