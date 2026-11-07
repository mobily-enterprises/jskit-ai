// The types of the payment objects an application composes, for code that receives them,
// and the contracts of the store and provider adapter it chooses.

/** @typedef {ReturnType<typeof import("./catalogue.js").createPaymentCatalogue>} PaymentCatalogue */
/** @typedef {ReturnType<typeof import("./checkout.js").createPaymentCheckoutService>} PaymentCheckoutService */
/** @typedef {ReturnType<typeof import("./readiness.js").createPaymentReadiness>} PaymentReadiness */
/** @typedef {ReturnType<typeof import("./service.js").createPaymentService>} PaymentService */
/** @typedef {ReturnType<typeof import("../shared/configuration.js").validatePaymentConfiguration>} PaymentConfiguration */

/**
 * The merchant a payment record belongs to: one application's provider account
 * in one environment.
 * @typedef {object} PaymentMerchantScope
 * @property {string} applicationId
 * @property {string} integrationId
 * @property {string} providerAccountId
 * @property {"sandbox" | "live"} environment
 */

/**
 * One billable subject of a merchant.
 * @typedef {PaymentMerchantScope & { subjectId: string }} PaymentAccountScope
 */

/**
 * One billable account's stored state.
 * @typedef {object} PaymentAccountState
 * @property {Array<{ id: string, remaining: number, expiresAt: number | null }>} lots The credit grants and what remains of each.
 * @property {Record<string, { id: string, status: string, planId: string, periodEnd: number }>} subscriptions
 * @property {string} [customerId] The provider customer bound to the account.
 * @property {Record<string, any>} [pendingPaymentOperation] A provider request whose outcome is not recorded yet.
 */

/**
 * An account held under the store's lock while work runs: its state, which the
 * work changes in place, and the entries recorded under business references.
 * @typedef {object} PaymentAccountTransaction
 * @property {PaymentAccountState} state
 * @property {(reference: string) => Promise<any>} find The entry recorded under a reference, or null.
 * @property {(reference: string, entry: any) => Promise<void>} record Records an entry under a new reference.
 */

/**
 * One merchant's published catalogue: each plan's provider product and price.
 * @typedef {object} PaymentCatalogueState
 * @property {Record<string, Record<string, any>>} plans
 * @property {Array<Record<string, any>>} history The price bindings each plan had before its current one.
 * @property {number} [revision]
 * @property {Record<string, any>} [pending] A provider write whose outcome is not recorded yet.
 */

/**
 * Where payment accounts and catalogues are kept: the store PaymentStoreFeature
 * provides as `payments.store`, or the application's own store. Each `with*` call runs its work under the
 * record's lock and saves the state the work leaves.
 * @typedef {object} PaymentStore
 * @property {(scope: PaymentAccountScope) => Promise<PaymentAccountState>} inspect
 * @property {<T>(scope: PaymentAccountScope, work: (account: PaymentAccountTransaction) => Promise<T>) => Promise<T>} withAccount
 * @property {(scope: PaymentMerchantScope, customerId: string, subjectId: string) => Promise<void>} bindCustomer
 *   Binds a provider customer to one billable subject, refusing a customer bound to another.
 * @property {(scope: PaymentMerchantScope, customerId: string) => Promise<string | null>} resolveCustomer The subject a provider customer is bound to.
 * @property {(scope: PaymentMerchantScope) => Promise<PaymentCatalogueState>} inspectCatalogue
 * @property {<T>(scope: PaymentMerchantScope, work: (state: PaymentCatalogueState) => Promise<T>) => Promise<T>} withCatalogue
 */

/**
 * A provider's billing page: its id and the URL the customer opens.
 * @typedef {{ id: string, url: string }} PaymentProviderPage
 */

/**
 * A price as the provider holds it.
 * @typedef {object} PaymentProviderPrice
 * @property {string} id
 * @property {string} productId
 * @property {number} amount In the currency's minor unit.
 * @property {string} currency
 * @property {string} interval
 * @property {boolean} active
 */

/**
 * A payment provider's operations: createStripePaymentAdapter() or
 * createPaddlePaymentAdapter().
 * @typedef {object} PaymentProviderAdapter
 * @property {(planId: string) => void} validatePlan Throws for a plan with no current price binding.
 * @property {() => Promise<{ environment: string, accountId?: string, credentialsVerified?: boolean, chargesEnabled?: boolean, payoutsEnabled?: boolean }>} verifyAccount
 *   What the provider confirms about the configured account.
 * @property {(rawBody: Buffer, signature: string) => Promise<any>} verifyEvent The webhook event, once its signature is verified.
 * @property {(event: any) => { eventId: string, customerId: string } | null} eventIdentity The event and customer of a billing event, or null for an event to ignore.
 * @property {(event: any) => Promise<{ customerId: string, subscription: Record<string, any>, renewal?: Record<string, any> } | null>} loadEvent
 *   The provider's current subscription facts for the event.
 * @property {(request: { email: string, requestId: string }) => Promise<string>} createCustomer The new customer's id.
 * @property {(request: { customerId: string, planId: string, returnUrl: string, requestId: string }) => Promise<PaymentProviderPage>} createCheckout
 * @property {(request: { customerId: string, returnUrl: string }) => Promise<PaymentProviderPage>} createPortal
 * @property {(request: { customerId: string, collection: string, after?: string | null }) => Promise<{ collection: string, items: Array<Record<string, any>>, nextCursor: string | null }>} readHistory
 *   One page of the customer's subscriptions or transactions.
 * @property {(productId: string) => Promise<{ id: string, name: string }>} readProduct
 * @property {(request: { name: string, requestId: string }) => Promise<{ id: string }>} createProduct
 * @property {(request: { id: string, name: string, requestId: string }) => Promise<{ id: string }>} renameProduct
 * @property {(priceId: string) => Promise<PaymentProviderPrice>} readPrice
 * @property {(request: { productId: string, amount: number, currency: string, interval: string, requestId: string }) => Promise<{ id: string }>} createPrice
 */

export {};
