import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleUnauthorizedError: vi.fn(async () => false),
  queryResult: {
    data: { value: { entries: [{ id: 1 }] } },
    error: { value: null },
    isPending: { value: false },
    isFetching: { value: false }
  },
  useQuery: vi.fn(),
  useQueryErrorMessage: vi.fn(),
  api: {
    console: {
      listEntitlementDefinitions: vi.fn(async () => ({ entries: [] })),
      listPlanAssignments: vi.fn(async () => ({ entries: [] })),
      listPurchases: vi.fn(async () => ({ entries: [] })),
      listSubscriptions: vi.fn(async () => ({ entries: [] }))
    }
  }
}));

vi.mock("@tanstack/vue-query", () => ({
  useQuery: (options = {}) => {
    mocks.useQuery(options);
    if (typeof options.queryFn === "function") {
      void options.queryFn();
    }
    return mocks.queryResult;
  }
}));

vi.mock("@jskit-ai/web-runtime-core", () => ({
  useQueryErrorMessage: (options) => {
    mocks.useQueryErrorMessage(options);
    return { value: options.mapError({}) };
  }
}));

vi.mock("../../src/modules/auth/useAuthGuard.js", () => ({
  useAuthGuard: () => ({
    handleUnauthorizedError: mocks.handleUnauthorizedError
  })
}));

vi.mock("../../src/platform/http/api/index.js", () => ({
  api: mocks.api
}));

import { useConsoleBillingEntitlementsView } from "../../src/views/console/useConsoleBillingEntitlementsView.js";
import { useConsoleBillingPlanAssignmentsView } from "../../src/views/console/useConsoleBillingPlanAssignmentsView.js";
import { useConsoleBillingPurchasesView } from "../../src/views/console/useConsoleBillingPurchasesView.js";
import { useConsoleBillingSubscriptionsView } from "../../src/views/console/useConsoleBillingSubscriptionsView.js";

describe("console billing query composables", () => {
  beforeEach(() => {
    mocks.handleUnauthorizedError.mockReset();
    mocks.handleUnauthorizedError.mockResolvedValue(false);
    mocks.useQuery.mockReset();
    mocks.useQueryErrorMessage.mockReset();
    mocks.api.console.listEntitlementDefinitions.mockReset();
    mocks.api.console.listEntitlementDefinitions.mockResolvedValue({ entries: [] });
    mocks.api.console.listPlanAssignments.mockReset();
    mocks.api.console.listPlanAssignments.mockResolvedValue({ entries: [] });
    mocks.api.console.listPurchases.mockReset();
    mocks.api.console.listPurchases.mockResolvedValue({ entries: [] });
    mocks.api.console.listSubscriptions.mockReset();
    mocks.api.console.listSubscriptions.mockResolvedValue({ entries: [] });
  });

  it("wires entitlements query through useQueryErrorMessage with unauthorized handling", async () => {
    const view = useConsoleBillingEntitlementsView();
    await Promise.resolve();

    expect(mocks.api.console.listEntitlementDefinitions).toHaveBeenCalledWith({
      includeInactive: true
    });
    expect(view.entries.value).toEqual([{ id: 1 }]);
    expect(view.queryPending.value).toBe(false);
    expect(view.queryError.value).toBe("Unable to load entitlement definitions.");

    expect(mocks.useQueryErrorMessage).toHaveBeenCalledTimes(1);
    expect(mocks.useQueryErrorMessage.mock.calls[0][0].handleUnauthorizedError).toBe(
      mocks.handleUnauthorizedError
    );
  });

  it("wires plan assignments query through useQueryErrorMessage with unauthorized handling", async () => {
    const view = useConsoleBillingPlanAssignmentsView();
    await Promise.resolve();

    expect(mocks.api.console.listPlanAssignments).toHaveBeenCalledWith({
      page: 1,
      pageSize: 50
    });
    expect(view.entries.value).toEqual([{ id: 1 }]);
    expect(view.queryPending.value).toBe(false);
    expect(view.queryError.value).toBe("Unable to load plan assignments.");

    expect(mocks.useQueryErrorMessage).toHaveBeenCalledTimes(1);
    expect(mocks.useQueryErrorMessage.mock.calls[0][0].handleUnauthorizedError).toBe(
      mocks.handleUnauthorizedError
    );
  });

  it("wires purchases query through useQueryErrorMessage with unauthorized handling", async () => {
    const view = useConsoleBillingPurchasesView();
    await Promise.resolve();

    expect(mocks.api.console.listPurchases).toHaveBeenCalledWith({
      page: 1,
      pageSize: 50
    });
    expect(view.entries.value).toEqual([{ id: 1 }]);
    expect(view.queryPending.value).toBe(false);
    expect(view.queryError.value).toBe("Unable to load purchases.");

    expect(mocks.useQueryErrorMessage).toHaveBeenCalledTimes(1);
    expect(mocks.useQueryErrorMessage.mock.calls[0][0].handleUnauthorizedError).toBe(
      mocks.handleUnauthorizedError
    );
  });

  it("wires subscriptions query through useQueryErrorMessage with unauthorized handling", async () => {
    const view = useConsoleBillingSubscriptionsView();
    await Promise.resolve();

    expect(mocks.api.console.listSubscriptions).toHaveBeenCalledWith({
      page: 1,
      pageSize: 50
    });
    expect(view.entries.value).toEqual([{ id: 1 }]);
    expect(view.queryPending.value).toBe(false);
    expect(view.queryError.value).toBe("Unable to load subscriptions.");

    expect(mocks.useQueryErrorMessage).toHaveBeenCalledTimes(1);
    expect(mocks.useQueryErrorMessage.mock.calls[0][0].handleUnauthorizedError).toBe(
      mocks.handleUnauthorizedError
    );
  });
});
