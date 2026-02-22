import { Type } from "@fastify/type-provider-typebox";

const billableEntity = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    entityType: Type.String({ minLength: 1 }),
    entityRef: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    workspaceId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    ownerUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    status: Type.String({ minLength: 1 }),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    updatedAt: Type.String({ format: "iso-utc-date-time" })
  },
  {
    additionalProperties: false
  }
);

const planCorePrice = Type.Object(
  {
    provider: Type.String({ minLength: 1 }),
    providerPriceId: Type.String({ minLength: 1, maxLength: 191 }),
    providerProductId: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    interval: Type.String({ minLength: 1, maxLength: 32 }),
    intervalCount: Type.Integer({ minimum: 1 }),
    currency: Type.String({ minLength: 3, maxLength: 3 }),
    unitAmountMinor: Type.Integer({ minimum: 0 })
  },
  {
    additionalProperties: false
  }
);

const entitlement = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    planId: Type.Integer({ minimum: 1 }),
    code: Type.String({ minLength: 1 }),
    schemaVersion: Type.String({ minLength: 1 }),
    valueJson: Type.Unknown(),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    updatedAt: Type.String({ format: "iso-utc-date-time" })
  },
  {
    additionalProperties: false
  }
);

const plan = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    code: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    description: Type.Union([Type.String(), Type.Null()]),
    appliesTo: Type.String({ minLength: 1 }),
    corePrice: Type.Union([planCorePrice, Type.Null()]),
    isActive: Type.Boolean(),
    metadataJson: Type.Unknown(),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    updatedAt: Type.String({ format: "iso-utc-date-time" }),
    entitlements: Type.Array(entitlement)
  },
  {
    additionalProperties: false
  }
);

const productPrice = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 32 }),
    providerPriceId: Type.String({ minLength: 1, maxLength: 191 }),
    providerProductId: Type.Union([Type.String({ minLength: 1, maxLength: 191 }), Type.Null()]),
    interval: Type.Union([Type.String({ minLength: 1, maxLength: 32 }), Type.Null()]),
    intervalCount: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    currency: Type.String({ minLength: 3, maxLength: 3 }),
    unitAmountMinor: Type.Integer({ minimum: 0 })
  },
  {
    additionalProperties: false
  }
);

const product = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    code: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.Union([Type.String(), Type.Null()]),
    productKind: Type.String({ minLength: 1, maxLength: 64 }),
    price: Type.Union([productPrice, Type.Null()]),
    isActive: Type.Boolean(),
    metadataJson: Type.Unknown(),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    updatedAt: Type.String({ format: "iso-utc-date-time" })
  },
  {
    additionalProperties: false
  }
);

const subscription = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    billableEntityId: Type.Integer({ minimum: 1 }),
    planId: Type.Integer({ minimum: 1 }),
    billingCustomerId: Type.Integer({ minimum: 1 }),
    provider: Type.String({ minLength: 1 }),
    providerSubscriptionId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    providerSubscriptionCreatedAt: Type.String({ format: "iso-utc-date-time" }),
    currentPeriodEnd: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    trialEnd: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    canceledAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    cancelAtPeriodEnd: Type.Boolean(),
    endedAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    isCurrent: Type.Boolean(),
    lastProviderEventCreatedAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    lastProviderEventId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    metadataJson: Type.Unknown(),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    updatedAt: Type.String({ format: "iso-utc-date-time" })
  },
  {
    additionalProperties: false
  }
);

const paymentMethod = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    billableEntityId: Type.Integer({ minimum: 1 }),
    billingCustomerId: Type.Integer({ minimum: 1 }),
    provider: Type.String({ minLength: 1 }),
    providerPaymentMethodId: Type.String({ minLength: 1 }),
    type: Type.String({ minLength: 1 }),
    brand: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    last4: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    expMonth: Type.Union([Type.Integer({ minimum: 1, maximum: 12 }), Type.Null()]),
    expYear: Type.Union([Type.Integer({ minimum: 2000, maximum: 9999 }), Type.Null()]),
    isDefault: Type.Boolean(),
    status: Type.String({ minLength: 1 }),
    lastProviderSyncedAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    metadataJson: Type.Unknown(),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    updatedAt: Type.String({ format: "iso-utc-date-time" })
  },
  {
    additionalProperties: false
  }
);

const quotaLimitation = Type.Object(
  {
    interval: Type.String({ minLength: 1 }),
    enforcement: Type.String({ minLength: 1 }),
    limit: Type.Integer({ minimum: 0 }),
    used: Type.Integer({ minimum: 0 }),
    remaining: Type.Integer({ minimum: 0 }),
    reached: Type.Boolean(),
    exceeded: Type.Boolean(),
    windowStartAt: Type.String({ format: "iso-utc-date-time" }),
    windowEndAt: Type.String({ format: "iso-utc-date-time" })
  },
  {
    additionalProperties: false
  }
);

const limitation = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    schemaVersion: Type.String({ minLength: 1 }),
    type: Type.String({ minLength: 1 }),
    valueJson: Type.Unknown(),
    enabled: Type.Optional(Type.Boolean()),
    values: Type.Optional(Type.Array(Type.String())),
    quota: Type.Optional(quotaLimitation)
  },
  {
    additionalProperties: false
  }
);

const timelineEntry = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    occurredAt: Type.String({ format: "iso-utc-date-time" }),
    kind: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    description: Type.String(),
    provider: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    operationKey: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    providerEventId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    sourceId: Type.Integer({ minimum: 0 })
  },
  {
    additionalProperties: false
  }
);

const plansResponse = Type.Object(
  {
    plans: Type.Array(plan)
  },
  {
    additionalProperties: false
  }
);

const productsResponse = Type.Object(
  {
    products: Type.Array(product)
  },
  {
    additionalProperties: false
  }
);

const purchase = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    purchaseKind: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    amountMinor: Type.Integer({ minimum: 0 }),
    currency: Type.String({ minLength: 3, maxLength: 3 }),
    quantity: Type.Integer({ minimum: 1 }),
    displayName: Type.Union([Type.String(), Type.Null()]),
    purchasedAt: Type.String({ format: "iso-utc-date-time" })
  },
  {
    additionalProperties: false
  }
);

const purchasesResponse = Type.Object(
  {
    billableEntity,
    purchases: Type.Array(purchase)
  },
  {
    additionalProperties: false
  }
);

const checkoutBody = Type.Object(
  {
    checkoutType: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    planCode: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    oneOff: Type.Optional(
      Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 160 }),
          amountMinor: Type.Integer({ minimum: 1, maximum: 99999999 }),
          quantity: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
          currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 }))
        },
        {
          additionalProperties: false
        }
      )
    ),
    successPath: Type.String({ minLength: 1, maxLength: 2048 }),
    cancelPath: Type.String({ minLength: 1, maxLength: 2048 })
  },
  {
    additionalProperties: false
  }
);

const checkoutResponse = Type.Object(
  {
    provider: Type.String({ minLength: 1 }),
    billableEntityId: Type.Integer({ minimum: 1 }),
    operationKey: Type.String({ minLength: 1 }),
    checkoutType: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    checkoutSession: Type.Object(
      {
        providerCheckoutSessionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        status: Type.String({ minLength: 1 }),
        providerStatus: Type.String({ minLength: 1 }),
        checkoutUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        expiresAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
        customerId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
        subscriptionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
      },
      {
        additionalProperties: false
      }
    )
  },
  {
    additionalProperties: false
  }
);

const portalBody = Type.Object(
  {
    returnPath: Type.String({ minLength: 1, maxLength: 2048 })
  },
  {
    additionalProperties: false
  }
);

const paymentLinkLineItemBody = Type.Object(
  {
    priceId: Type.Optional(Type.String({ minLength: 1, maxLength: 191 })),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    amountMinor: Type.Optional(Type.Integer({ minimum: 1, maximum: 99999999 })),
    quantity: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
    currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 }))
  },
  {
    additionalProperties: false
  }
);

const paymentLinkBody = Type.Object(
  {
    successPath: Type.String({ minLength: 1, maxLength: 2048 }),
    lineItems: Type.Optional(Type.Array(paymentLinkLineItemBody, { minItems: 1, maxItems: 20 })),
    oneOff: Type.Optional(
      Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 160 }),
          amountMinor: Type.Integer({ minimum: 1, maximum: 99999999 }),
          quantity: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
          currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 }))
        },
        {
          additionalProperties: false
        }
      )
    )
  },
  {
    additionalProperties: false
  }
);

const portalResponse = Type.Object(
  {
    provider: Type.String({ minLength: 1 }),
    portalSession: Type.Object(
      {
        id: Type.String({ minLength: 1 }),
        url: Type.String({ minLength: 1 })
      },
      {
        additionalProperties: false
      }
    )
  },
  {
    additionalProperties: false
  }
);

const paymentLinkResponse = Type.Object(
  {
    provider: Type.String({ minLength: 1 }),
    billableEntityId: Type.Integer({ minimum: 1 }),
    operationKey: Type.String({ minLength: 1 }),
    paymentLink: Type.Object(
      {
        id: Type.String({ minLength: 1 }),
        url: Type.String({ minLength: 1 }),
        active: Type.Boolean()
      },
      {
        additionalProperties: false
      }
    )
  },
  {
    additionalProperties: false
  }
);

const webhookResponse = Type.Object(
  {
    ok: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const paymentMethodsResponse = Type.Object(
  {
    billableEntity,
    paymentMethods: Type.Array(paymentMethod)
  },
  {
    additionalProperties: false
  }
);

const paymentMethodSyncResponse = Type.Object(
  {
    billableEntity,
    paymentMethods: Type.Array(paymentMethod),
    syncedAt: Type.String({ format: "iso-utc-date-time" }),
    syncStatus: Type.String({ minLength: 1 }),
    fetchedCount: Type.Integer({ minimum: 0 })
  },
  {
    additionalProperties: false
  }
);

const limitationsResponse = Type.Object(
  {
    billableEntity,
    subscription: Type.Union([subscription, Type.Null()]),
    generatedAt: Type.String({ format: "iso-utc-date-time" }),
    limitations: Type.Array(limitation)
  },
  {
    additionalProperties: false
  }
);

const timelineResponse = Type.Object(
  {
    billableEntity,
    entries: Type.Array(timelineEntry),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    hasMore: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const timelineQuery = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
    source: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    operationKey: Type.Optional(Type.String({ minLength: 1, maxLength: 191 })),
    providerEventId: Type.Optional(Type.String({ minLength: 1, maxLength: 191 }))
  },
  {
    additionalProperties: false
  }
);

const planSelection = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    code: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    description: Type.Union([Type.String(), Type.Null()]),
    isActive: Type.Boolean(),
    corePrice: Type.Union([planCorePrice, Type.Null()])
  },
  {
    additionalProperties: false
  }
);

const currentPlanState = Type.Object(
  {
    ...planSelection.properties
  },
  {
    additionalProperties: false
  }
);

const planStatePayload = Type.Object(
  {
    currentPlan: Type.Union([currentPlanState, Type.Null()]),
    currentPeriodEndAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    nextPlan: Type.Union([planSelection, Type.Null()]),
    nextEffectiveAt: Type.Union([Type.String({ format: "iso-utc-date-time" }), Type.Null()]),
    pendingChange: Type.Boolean(),
    availablePlans: Type.Array(planSelection),
    settings: Type.Object(
      {
        paidPlanChangePaymentMethodPolicy: Type.Union([
          Type.Literal("required_now"),
          Type.Literal("allow_without_payment_method")
        ])
      },
      {
        additionalProperties: false
      }
    )
  },
  {
    additionalProperties: false
  }
);

const planStateResponse = Type.Object(
  {
    billableEntity,
    ...planStatePayload.properties
  },
  {
    additionalProperties: false
  }
);

const planChangeBody = Type.Object(
  {
    planCode: Type.String({ minLength: 1, maxLength: 120 }),
    successPath: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    cancelPath: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 }))
  },
  {
    additionalProperties: false
  }
);

const planChangeResponse = Type.Object(
  {
    mode: Type.Union([
      Type.Literal("applied"),
      Type.Literal("scheduled"),
      Type.Literal("checkout_required")
    ]),
    checkout: Type.Optional(checkoutResponse),
    state: planStatePayload
  },
  {
    additionalProperties: false
  }
);

const planChangeCancelResponse = Type.Object(
  {
    canceled: Type.Boolean(),
    state: planStatePayload
  },
  {
    additionalProperties: false
  }
);

const schema = {
  body: {
    checkout: checkoutBody,
    portal: portalBody,
    paymentLink: paymentLinkBody,
    planChange: planChangeBody
  },
  query: {
    timeline: timelineQuery
  },
  response: {
    plans: plansResponse,
    products: productsResponse,
    purchases: purchasesResponse,
    paymentMethods: paymentMethodsResponse,
    paymentMethodSync: paymentMethodSyncResponse,
    limitations: limitationsResponse,
    timeline: timelineResponse,
    planState: planStateResponse,
    planChange: planChangeResponse,
    planChangeCancel: planChangeCancelResponse,
    checkout: checkoutResponse,
    portal: portalResponse,
    paymentLink: paymentLinkResponse,
    webhook: webhookResponse
  }
};

export { schema };
