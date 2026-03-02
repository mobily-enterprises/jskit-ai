import { describe, expect, it } from "vitest";

import { toErrorMessage } from "../../src/views/login/lib/loginErrorMessage.js";

describe("toErrorMessage", () => {
  it("joins unique field error messages when available", () => {
    const message = toErrorMessage(
      {
        fieldErrors: {
          email: "Email is required.",
          password: "Password is required.",
          duplicate: "Email is required."
        },
        message: "Fallback"
      },
      "Fallback"
    );

    expect(message).toBe("Email is required. Password is required.");
  });

  it("falls back to error.message or fallback", () => {
    expect(toErrorMessage({ message: "Something broke." }, "Fallback")).toBe("Something broke.");
    expect(toErrorMessage({}, "Fallback")).toBe("Fallback");
  });
});
