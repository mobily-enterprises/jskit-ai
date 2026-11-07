import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { normalizeOpaqueId } from "@jskit-ai/kernel/shared/support/normalize";

// The payment tables. Each row is keyed by a fingerprint of its merchant (and, for accounts and their entries, its
// billable subject), not by a workspace or user column: the key is the row's scope, so the tables are public to their
// owner feature, which reaches them only through keys it computes from a caller's merchant and subject.

// A string key the store computes; text is kept exactly as written.
const key = (column) => Object.freeze({ type: "string", primary: true, required: true, storage: { column } });
const text = Object.freeze({ type: "string", required: true, noTrim: true });

// One billable subject's account under one merchant: its state as JSON.
const paymentAccountResource = defineTableResource({
  name: "paymentAccounts",
  tableName: "payment_accounts",
  ownership: "public",
  idProperty: "account_key",
  schema: {
    id: key("account_key"),
    payload: text
  }
});

// What an account recorded once under a business reference, keyed by the account and the reference.
const paymentEntryResource = defineTableResource({
  name: "paymentEntries",
  tableName: "payment_entries",
  ownership: "public",
  idProperty: "entry_key",
  schema: {
    id: key("entry_key"),
    accountKey: { ...text, storage: { column: "account_key" } },
    payload: text
  }
});

// The billable subject a provider customer is bound to, per merchant.
const paymentCustomerResource = defineTableResource({
  name: "paymentCustomers",
  tableName: "payment_customers",
  ownership: "public",
  idProperty: "customer_key",
  schema: {
    id: key("customer_key"),
    subjectId: { ...text, storage: { column: "subject_id" } }
  }
});

// One merchant's published catalogue: its state as JSON.
const paymentCatalogueResource = defineTableResource({
  name: "paymentCatalogues",
  tableName: "payment_catalogues",
  ownership: "public",
  idProperty: "catalogue_key",
  schema: {
    id: key("catalogue_key"),
    payload: text
  }
});

// The feature's owns entries: each key is an opaque fingerprint, not a numeric id.
const PAYMENT_TABLES = Object.freeze([paymentAccountResource, paymentEntryResource, paymentCustomerResource, paymentCatalogueResource]
  .map((resource) => Object.freeze({ resource, normalizeId: normalizeOpaqueId })));

export {
  PAYMENT_TABLES,
  paymentAccountResource,
  paymentCatalogueResource,
  paymentCustomerResource,
  paymentEntryResource
};
