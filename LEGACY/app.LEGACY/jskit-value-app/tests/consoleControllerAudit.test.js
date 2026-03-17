import assert from "node:assert/strict";
import test from "node:test";

import { createController as createConsoleController } from "../server/modules/console/controller.js";
import { createReplyDouble } from "./helpers/replyDouble.js";

function createBaseRequest(overrides = {}) {
  return {
    id: "req-console-1",
    method: "POST",
    url: "/api/console/invites",
    headers: {
      "x-forwarded-for": "198.51.100.10, 203.0.113.4",
      "user-agent": "console-action-test"
    },
    user: {
      id: 5,
      email: "console-owner@example.com"
    },
    ...overrides
  };
}

test("console controller delegates critical writes to canonical actions", async () => {
  const calls = [];
  const controller = createConsoleController({
    actionExecutor: {
      async execute({ actionId, input, context }) {
        calls.push({
          actionId,
          input,
          context
        });

        if (actionId === "console.member.role.update") {
          return { members: [{ userId: 22, roleId: "moderator" }] };
        }
        if (actionId === "console.invite.create") {
          return { invites: [], createdInvite: { inviteId: 401 } };
        }
        if (actionId === "console.settings.update") {
          return { settings: { assistantSystemPromptWorkspace: "Use concise language." } };
        }
        if (actionId === "console.invite.revoke") {
          return { invites: [] };
        }
        if (actionId === "console.invite.redeem") {
          return { ok: true, decision: "accept", inviteId: 902 };
        }
        throw new Error(`Unexpected action: ${actionId}`);
      }
    }
  });

  const updateReply = createReplyDouble();
  await controller.updateMemberRole(
    createBaseRequest({
      method: "PATCH",
      url: "/api/console/members/22/role",
      params: { memberUserId: "22" },
      body: { roleId: "moderator" }
    }),
    updateReply
  );
  assert.equal(updateReply.statusCode, 200);

  const createReply = createReplyDouble();
  await controller.createInvite(
    createBaseRequest({
      method: "POST",
      url: "/api/console/invites",
      body: { email: "invitee@example.com", roleId: "moderator" }
    }),
    createReply
  );
  assert.equal(createReply.statusCode, 200);

  const settingsReply = createReplyDouble();
  await controller.updateAssistantSettings(
    createBaseRequest({
      method: "PATCH",
      url: "/api/console/settings",
      body: {
        assistantSystemPromptWorkspace: "Use concise language."
      }
    }),
    settingsReply
  );
  assert.equal(settingsReply.statusCode, 200);

  const revokeReply = createReplyDouble();
  await controller.revokeInvite(
    createBaseRequest({
      method: "DELETE",
      url: "/api/console/invites/401",
      params: { inviteId: "401" }
    }),
    revokeReply
  );
  assert.equal(revokeReply.statusCode, 200);

  const redeemReply = createReplyDouble();
  await controller.respondToPendingInviteByToken(
    createBaseRequest({
      method: "POST",
      url: "/api/console/invitations/redeem",
      body: { token: "console-secret-token", decision: "accept" }
    }),
    redeemReply
  );
  assert.equal(redeemReply.statusCode, 200);

  assert.deepEqual(
    calls.map((entry) => entry.actionId),
    [
      "console.member.role.update",
      "console.invite.create",
      "console.settings.update",
      "console.invite.revoke",
      "console.invite.redeem"
    ]
  );
  for (const call of calls) {
    assert.equal(call.context.channel, "api");
  }
});

test("console controller delegates entitlement definition reads to canonical actions", async () => {
  const calls = [];
  const controller = createConsoleController({
    actionExecutor: {
      async execute({ actionId, input, context }) {
        calls.push({
          actionId,
          input,
          context
        });

        if (actionId === "console.billing.entitlement_definitions.list") {
          return { entries: [] };
        }
        if (actionId === "console.billing.entitlement_definition.get") {
          return {
            definition: {
              id: 7,
              code: "projects.max"
            }
          };
        }
        throw new Error(`Unexpected action: ${actionId}`);
      }
    }
  });

  const listReply = createReplyDouble();
  await controller.listBillingEntitlementDefinitions(
    createBaseRequest({
      method: "GET",
      url: "/api/console/billing/entitlement-definitions",
      query: { includeInactive: "false" }
    }),
    listReply
  );
  assert.equal(listReply.statusCode, 200);

  const getReply = createReplyDouble();
  await controller.getBillingEntitlementDefinition(
    createBaseRequest({
      method: "GET",
      url: "/api/console/billing/entitlement-definitions/7",
      params: { definitionId: "7" }
    }),
    getReply
  );
  assert.equal(getReply.statusCode, 200);

  assert.deepEqual(
    calls.map((entry) => entry.actionId),
    ["console.billing.entitlement_definitions.list", "console.billing.entitlement_definition.get"]
  );
  assert.equal(calls[0].input.includeInactive, "false");
  assert.equal(calls[1].input.definitionId, "7");
  for (const call of calls) {
    assert.equal(call.context.channel, "api");
  }
});

test("console controller delegates purchase operations to canonical actions", async () => {
  const calls = [];
  const controller = createConsoleController({
    actionExecutor: {
      async execute({ actionId, input, context }) {
        calls.push({
          actionId,
          input,
          context
        });

        if (actionId === "console.billing.purchases.list") {
          return { entries: [], page: 1, pageSize: 25, hasMore: false };
        }
        if (
          actionId === "console.billing.purchase.refund" ||
          actionId === "console.billing.purchase.void" ||
          actionId === "console.billing.purchase.correction.create"
        ) {
          return {
            purchase: null,
            adjustment: null,
            adjustments: []
          };
        }
        throw new Error(`Unexpected action: ${actionId}`);
      }
    }
  });

  const listReply = createReplyDouble();
  await controller.listBillingPurchases(
    createBaseRequest({
      method: "GET",
      url: "/api/console/billing/purchases",
      query: {
        workspaceSlug: "acme"
      }
    }),
    listReply
  );
  assert.equal(listReply.statusCode, 200);

  const refundReply = createReplyDouble();
  await controller.refundBillingPurchase(
    createBaseRequest({
      method: "POST",
      url: "/api/console/billing/purchases/91/refund",
      headers: {
        "idempotency-key": "idem_refund_91"
      },
      params: {
        purchaseId: "91"
      },
      body: {
        reasonCode: "manual_refund"
      }
    }),
    refundReply
  );
  assert.equal(refundReply.statusCode, 200);

  const voidReply = createReplyDouble();
  await controller.voidBillingPurchase(
    createBaseRequest({
      method: "POST",
      url: "/api/console/billing/purchases/91/void",
      headers: {
        "idempotency-key": "idem_void_91"
      },
      params: {
        purchaseId: "91"
      },
      body: {
        reasonCode: "manual_void"
      }
    }),
    voidReply
  );
  assert.equal(voidReply.statusCode, 200);

  const correctionReply = createReplyDouble();
  await controller.createBillingPurchaseCorrection(
    createBaseRequest({
      method: "POST",
      url: "/api/console/billing/purchases/91/corrections",
      headers: {
        "idempotency-key": "idem_correction_91"
      },
      params: {
        purchaseId: "91"
      },
      body: {
        amountMinor: -500,
        currency: "USD",
        reasonCode: "manual_correction"
      }
    }),
    correctionReply
  );
  assert.equal(correctionReply.statusCode, 200);

  assert.deepEqual(
    calls.map((entry) => entry.actionId),
    [
      "console.billing.purchases.list",
      "console.billing.purchase.refund",
      "console.billing.purchase.void",
      "console.billing.purchase.correction.create"
    ]
  );
  assert.equal(calls[0].input.workspaceSlug, "acme");
  assert.equal(calls[1].input.purchaseId, "91");
  assert.equal(calls[1].input.idempotencyKey, "idem_refund_91");
  assert.equal(calls[2].input.idempotencyKey, "idem_void_91");
  assert.equal(calls[3].input.idempotencyKey, "idem_correction_91");
});

test("console controller delegates assignment and subscription operations to canonical actions", async () => {
  const calls = [];
  const controller = createConsoleController({
    actionExecutor: {
      async execute({ actionId, input, context }) {
        calls.push({
          actionId,
          input,
          context
        });

        if (actionId === "console.billing.plan_assignments.list") {
          return { entries: [], page: 1, pageSize: 25, hasMore: false };
        }
        if (
          actionId === "console.billing.plan_assignment.create" ||
          actionId === "console.billing.plan_assignment.update" ||
          actionId === "console.billing.plan_assignment.cancel"
        ) {
          return {
            assignment: {
              id: 22
            }
          };
        }
        if (actionId === "console.billing.subscriptions.list") {
          return { entries: [], page: 1, pageSize: 25, hasMore: false };
        }
        if (
          actionId === "console.billing.subscription.change_plan" ||
          actionId === "console.billing.subscription.cancel" ||
          actionId === "console.billing.subscription.cancel_at_period_end"
        ) {
          return {
            subscription: {
              providerSubscriptionId: "sub_123"
            }
          };
        }
        throw new Error(`Unexpected action: ${actionId}`);
      }
    }
  });

  const listAssignmentsReply = createReplyDouble();
  await controller.listBillingPlanAssignments(
    createBaseRequest({
      method: "GET",
      url: "/api/console/billing/plan-assignments",
      query: {
        workspaceSlug: "acme"
      }
    }),
    listAssignmentsReply
  );
  assert.equal(listAssignmentsReply.statusCode, 200);

  const createAssignmentReply = createReplyDouble();
  await controller.createBillingPlanAssignment(
    createBaseRequest({
      method: "POST",
      url: "/api/console/billing/plan-assignments",
      headers: {
        "idempotency-key": "idem_assignment_create_1"
      },
      body: {
        billableEntityId: 10,
        planId: 12
      }
    }),
    createAssignmentReply
  );
  assert.equal(createAssignmentReply.statusCode, 200);

  const updateAssignmentReply = createReplyDouble();
  await controller.updateBillingPlanAssignment(
    createBaseRequest({
      method: "PATCH",
      url: "/api/console/billing/plan-assignments/22",
      headers: {
        "idempotency-key": "idem_assignment_update_22"
      },
      params: {
        assignmentId: "22"
      },
      body: {
        status: "upcoming"
      }
    }),
    updateAssignmentReply
  );
  assert.equal(updateAssignmentReply.statusCode, 200);

  const cancelAssignmentReply = createReplyDouble();
  await controller.cancelBillingPlanAssignment(
    createBaseRequest({
      method: "POST",
      url: "/api/console/billing/plan-assignments/22/cancel",
      headers: {
        "idempotency-key": "idem_assignment_cancel_22"
      },
      params: {
        assignmentId: "22"
      },
      body: {}
    }),
    cancelAssignmentReply
  );
  assert.equal(cancelAssignmentReply.statusCode, 200);

  const listSubscriptionsReply = createReplyDouble();
  await controller.listBillingSubscriptions(
    createBaseRequest({
      method: "GET",
      url: "/api/console/billing/subscriptions",
      query: {
        provider: "stripe"
      }
    }),
    listSubscriptionsReply
  );
  assert.equal(listSubscriptionsReply.statusCode, 200);

  const changePlanReply = createReplyDouble();
  await controller.changeBillingSubscriptionPlan(
    createBaseRequest({
      method: "POST",
      url: "/api/console/billing/subscriptions/sub_123/change-plan",
      headers: {
        "idempotency-key": "idem_subscription_change_123"
      },
      params: {
        providerSubscriptionId: "sub_123"
      },
      body: {
        planId: 12
      }
    }),
    changePlanReply
  );
  assert.equal(changePlanReply.statusCode, 200);

  const cancelSubscriptionReply = createReplyDouble();
  await controller.cancelBillingSubscription(
    createBaseRequest({
      method: "POST",
      url: "/api/console/billing/subscriptions/sub_123/cancel",
      headers: {
        "idempotency-key": "idem_subscription_cancel_123"
      },
      params: {
        providerSubscriptionId: "sub_123"
      },
      body: {}
    }),
    cancelSubscriptionReply
  );
  assert.equal(cancelSubscriptionReply.statusCode, 200);

  const cancelAtPeriodEndReply = createReplyDouble();
  await controller.cancelBillingSubscriptionAtPeriodEnd(
    createBaseRequest({
      method: "POST",
      url: "/api/console/billing/subscriptions/sub_123/cancel-at-period-end",
      headers: {
        "idempotency-key": "idem_subscription_cape_123"
      },
      params: {
        providerSubscriptionId: "sub_123"
      },
      body: {}
    }),
    cancelAtPeriodEndReply
  );
  assert.equal(cancelAtPeriodEndReply.statusCode, 200);

  assert.deepEqual(
    calls.map((entry) => entry.actionId),
    [
      "console.billing.plan_assignments.list",
      "console.billing.plan_assignment.create",
      "console.billing.plan_assignment.update",
      "console.billing.plan_assignment.cancel",
      "console.billing.subscriptions.list",
      "console.billing.subscription.change_plan",
      "console.billing.subscription.cancel",
      "console.billing.subscription.cancel_at_period_end"
    ]
  );
  assert.equal(calls[0].input.workspaceSlug, "acme");
  assert.equal(calls[1].input.idempotencyKey, "idem_assignment_create_1");
  assert.equal(calls[2].input.assignmentId, "22");
  assert.equal(calls[3].input.assignmentId, "22");
  assert.equal(calls[5].input.providerSubscriptionId, "sub_123");
  assert.equal(calls[7].input.idempotencyKey, "idem_subscription_cape_123");
});

test("console controller purchase mutations require Idempotency-Key header", async () => {
  const controller = createConsoleController({
    actionExecutor: {
      async execute() {
        throw new Error("not expected");
      }
    }
  });

  const scenarios = [
    {
      invoke: () =>
        controller.refundBillingPurchase(
          createBaseRequest({
            method: "POST",
            url: "/api/console/billing/purchases/100/refund",
            params: { purchaseId: "100" },
            body: { reasonCode: "manual_refund" }
          }),
          createReplyDouble()
        )
    },
    {
      invoke: () =>
        controller.voidBillingPurchase(
          createBaseRequest({
            method: "POST",
            url: "/api/console/billing/purchases/100/void",
            params: { purchaseId: "100" },
            body: { reasonCode: "manual_void" }
          }),
          createReplyDouble()
        )
    },
    {
      invoke: () =>
        controller.createBillingPurchaseCorrection(
          createBaseRequest({
            method: "POST",
            url: "/api/console/billing/purchases/100/corrections",
            params: { purchaseId: "100" },
            body: { amountMinor: -100, currency: "USD" }
          }),
          createReplyDouble()
        )
    },
    {
      invoke: () =>
        controller.createBillingPlanAssignment(
          createBaseRequest({
            method: "POST",
            url: "/api/console/billing/plan-assignments",
            body: {
              billableEntityId: 10,
              planId: 12
            }
          }),
          createReplyDouble()
        )
    },
    {
      invoke: () =>
        controller.updateBillingPlanAssignment(
          createBaseRequest({
            method: "PATCH",
            url: "/api/console/billing/plan-assignments/9",
            params: { assignmentId: "9" },
            body: { status: "upcoming" }
          }),
          createReplyDouble()
        )
    },
    {
      invoke: () =>
        controller.cancelBillingPlanAssignment(
          createBaseRequest({
            method: "POST",
            url: "/api/console/billing/plan-assignments/9/cancel",
            params: { assignmentId: "9" },
            body: {}
          }),
          createReplyDouble()
        )
    },
    {
      invoke: () =>
        controller.changeBillingSubscriptionPlan(
          createBaseRequest({
            method: "POST",
            url: "/api/console/billing/subscriptions/sub_9/change-plan",
            params: { providerSubscriptionId: "sub_9" },
            body: { planId: 12 }
          }),
          createReplyDouble()
        )
    },
    {
      invoke: () =>
        controller.cancelBillingSubscription(
          createBaseRequest({
            method: "POST",
            url: "/api/console/billing/subscriptions/sub_9/cancel",
            params: { providerSubscriptionId: "sub_9" },
            body: {}
          }),
          createReplyDouble()
        )
    },
    {
      invoke: () =>
        controller.cancelBillingSubscriptionAtPeriodEnd(
          createBaseRequest({
            method: "POST",
            url: "/api/console/billing/subscriptions/sub_9/cancel-at-period-end",
            params: { providerSubscriptionId: "sub_9" },
            body: {}
          }),
          createReplyDouble()
        )
    }
  ];

  for (const scenario of scenarios) {
    await assert.rejects(scenario.invoke, (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "IDEMPOTENCY_KEY_REQUIRED");
      return true;
    });
  }
});

test("console controller rethrows action errors", async () => {
  const expectedError = Object.assign(new Error("not found"), {
    status: 404,
    code: "INVITE_NOT_FOUND"
  });
  const controller = createConsoleController({
    actionExecutor: {
      async execute({ actionId }) {
        assert.equal(actionId, "console.invite.revoke");
        throw expectedError;
      }
    }
  });

  const reply = createReplyDouble();
  await assert.rejects(
    () =>
      controller.revokeInvite(
        createBaseRequest({
          method: "DELETE",
          url: "/api/console/invites/999",
          params: { inviteId: "999" }
        }),
        reply
      ),
    (error) => {
      assert.equal(error, expectedError);
      return true;
    }
  );
});
