const resendDefinition = Object.freeze({
  id: "resend", name: "Resend", description: "Send transactional email and manage contact segments and draft broadcasts.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  setup: {
    url: "https://resend.com/docs/create-an-api-key",
    steps: [
      "Open API Keys in your Resend dashboard and choose Create API key.",
      "Name the key and select Full access: this connector checks access by listing domains. Sending access cannot perform that check. Full access also permits changes to Resend resources, so keep this key on your application's backend.",
      "Create the key and copy its value before closing; Resend shows the value only once. If you lose it, create a replacement.",
      "Enter env:RESEND_API_KEY in API key reference and save the configuration. Choose Set credential in Env, paste the copied key as the RESEND_API_KEY value, and save it there. Return here and choose Connect / Verify when the application setup is ready.",
      "Open Domains in Resend, choose Add domain, enter the sender domain and copy the displayed SPF/DKIM DNS records into your DNS host. Return to Resend and verify until the domain is verified; use a From address on that domain. Connecting only lists domains and cannot prove inbox delivery.",
      "For marketing, open Contacts and create a Segment (older guides call these Audiences). Add only opted-in contacts; contacts.create requires an explicit unsubscribed value, and contacts.update can unsubscribe them. segments.list/create and contacts.list/get/addSegment/removeSegment support the same workflow in your app.",
      "Prepare your HTML in the app or Resend Broadcasts editor; include {{{RESEND_UNSUBSCRIBE_URL}}} as the unsubscribe link. broadcasts.create always creates a draft. Use broadcasts.get/update to review its segment, sender and content; test with a segment containing only your own addresses before an explicitly authorized broadcasts.send. Sending affects the whole selected segment.",
      "LIMITATIONS: no embedded visual campaign builder, hosted-template catalogue, automation engine, inbound mail, attachment handling, delivery webhook processor or automatic editor-tool attachment. For example, an app can save a newsletter draft and send it to a reviewed segment; the app or Resend dashboard supplies preview, scheduling and analytics. Transactional emails.send remains plain text with an app-owned idempotency key.",
      "No OAuth app registration or callback URL is needed. Connection verification lists domains without sending email. Sending from your own domain additionally requires adding and verifying it in Resend."
    ]
  }
});

export { resendDefinition };
