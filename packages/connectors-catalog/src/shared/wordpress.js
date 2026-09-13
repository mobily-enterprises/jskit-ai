import { createSchema } from "json-rest-schema";
import { httpsSiteUrlField as siteUrl } from "./siteUrl.js";
const siteHint = "Use the site address before /wp-json, keeping any installation subdirectory. The runtime sends credentials only to this configured origin.";

const woocommerceDefinition = Object.freeze({
  id: "woocommerce", name: "WooCommerce", description: "Manage your WooCommerce catalogue, orders, customers, discounts and refunds, and read store reports.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "Consumer secret reference",
  apiKeyReferenceHint: "Store the consumer secret in Env. Use Read for lookups or Read/Write for changes; the key's WordPress user must also have permission for the requested operation.",
  settingsSchema: createSchema({
    siteUrl,
    consumerKey: { type: "string", required: true, minLength: 4, maxLength: 256,
      validator: (value) => /^ck_[a-z0-9]+$/iu.test(value) || "Enter the WooCommerce consumer key beginning ck_." }
  }),
  settingsFields: [
    { name: "siteUrl", label: "Store URL", placeholder: "https://shop.example.com", hint: siteHint },
    { name: "consumerKey", label: "Consumer key", placeholder: "ck_...", hint: "The key identifier from WooCommerce. Store its matching consumer secret separately." }
  ],
  setup: {
    url: "https://developer.woocommerce.com/docs/apis/rest-api/authentication/",
    steps: [
      "Open WooCommerce, Settings, Advanced, REST API in the store dashboard. Choose Add key.",
      "Enter a description, choose the intended WordPress user and select Read for lookup only or Read/Write for product, inventory, customer, coupon or order changes. Choose Generate API key.",
      "Copy the consumer key here. Store its one-time consumer secret in Env and enter the secret reference.",
      "Use the store's final HTTPS address, including a subdirectory if present. WooCommerce REST v3 requires pretty permalinks.",
      "Product prices and stock edits affect the store immediately. Choose draft when creating a product for review. Stock quantities replace the current value; they are not increments. Review concurrent stock changes in your app.",
      "Creating an order creates a store record, not a payment or checkout. Your app must supply the intended customer, items and addresses, then inspect the returned order. Uncertain creation must be reconciled before retrying.",
      "Order status changes can trigger store emails and stock actions. Marking completed does not collect payment; marking refunded does not issue a gateway refund. Your app must authorize and review the change.",
      "Refund creation requires an explicit choice: return money through the payment gateway, or record a manual refund only. Choose whether to restock and select original order-line IDs and quantities. Review remaining refundable amounts; after an uncertain result, inspect refunds and gateway history before retrying.",
      "Category changes affect store navigation immediately; category deletion is permanent but does not delete products. Reports require reporting permission on the selected WordPress user, even with a Read key. A successful product check does not prove report access.",
      "Coupon creation and edits affect live checkout discounts. Your app must review amounts and restrictions before submitting; free shipping also requires a compatible store shipping method. Failed writes are not automatically retried.",
      "Deletion requires an explicit trash/permanent choice. Customers and variations support only permanent deletion. Review customer content reassignment first; deleting an order does not refund payment.",
      "For event notifications, open WooCommerce, Settings, Advanced, Webhooks, Add webhook. Choose the topic and your app receiver URL; store a separate signing secret in app Env. Activate only after the receiver verifies signatures. Pause/delete the store webhook to stop deliveries.",
      "Save configuration. The application runtime verifies access by reading products; orders, customers and coupons still depend on the selected user's permissions. Your app must authorize each visitor's access; this administrator key does not sign customers in."
    ]
  }
});

const wordpressSelfHostedDefinition = Object.freeze({
  id: "wordpress-self-hosted", name: "WordPress (self-hosted)", description: "Manage WordPress posts, pages, media and users with a site-owned account.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  apiKeyReferenceLabel: "Application password reference",
  apiKeyReferenceHint: "Use a WordPress Application Password for this user, stored in Env. The user's role controls access; this is separate from the user's login password.",
  settingsSchema: createSchema({
    siteUrl,
    username: { type: "string", required: true, minLength: 1, maxLength: 60,
      validator: (value) => !/[:\p{Cc}]/u.test(value) || "Enter a username without colons or control characters." }
  }),
  settingsFields: [
    { name: "siteUrl", label: "Site URL", placeholder: "https://example.com", hint: siteHint },
    { name: "username", label: "Username", placeholder: "editor", hint: "The WordPress login name that owns the Application Password." }
  ],
  setup: {
    url: "https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/",
    steps: [
      "On the HTTPS WordPress site, open Users and edit the intended user's profile. Find Application Passwords.",
      "Enter a distinct application name and choose Add New Application Password. Copy the password when it is shown.",
      "Store the password in Env, then enter the site URL, username and password reference here.",
      "Save configuration. The runtime verifies the authenticated user with users/me, then exposes post/page reads and explicit draft, publish, edit and trash operations. Public post access alone does not verify the account.",
      "Choose a user whose site role permits the intended actions. Reading an account does not prove permission to edit pages, publish or delete content. Creation defaults to draft; publishing and editing already-published content are explicit app actions.",
      "Media uploads need upload_files permission and follow the site's size/type limits. User creation, role changes and deletion require administrative capabilities; grant only what the application's intended features need. Shared app callers all act as this WordPress user.",
      "Media and user deletion are permanent operations requiring explicit app-side authorization and confirmation. User deletion also requires a chosen replacement author. Saving this form performs none of those actions.",
      "To rotate the password, create another named Application Password, replace its value in Env, then reconnect. Revoke the old password in the user's profile. Disconnecting here only removes this application's local connection.",
      "If Application Passwords or REST routes are disabled by the host or a plugin, ask the site administrator to enable the intended access."
    ]
  }
});

export { woocommerceDefinition, wordpressSelfHostedDefinition };
