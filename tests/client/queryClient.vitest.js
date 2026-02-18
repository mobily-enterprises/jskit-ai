import { describe, expect, it } from "vitest";
import { queryClient, __testables } from "../../src/queryClient.js";

describe("queryClient retry policy", () => {
  it("retries for network failures and selected server statuses", () => {
    expect(__testables.shouldRetryRequest(0, { status: 0 })).toBe(true);
    expect(__testables.shouldRetryRequest(0, { status: 500 })).toBe(true);
    expect(__testables.shouldRetryRequest(0, { status: 429 })).toBe(true);
  });

  it("does not retry for client errors or when retry limit is reached", () => {
    expect(__testables.shouldRetryRequest(0, { status: 400 })).toBe(false);
    expect(__testables.shouldRetryRequest(2, { status: 500 })).toBe(false);
  });

  it("uses retry policy for queries and disables mutation retries by default", () => {
    const queryRetry = queryClient.getDefaultOptions().queries.retry;
    const mutationRetry = queryClient.getDefaultOptions().mutations.retry;

    expect(typeof queryRetry).toBe("function");
    expect(mutationRetry).toBe(false);
    expect(queryRetry(0, { status: 503 })).toBe(true);
  });
});
