const logoDevDefinition = Object.freeze({
  id: "logo-dev", name: "Logo.dev", description: "Display company logos using a publishable image-service key.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  runtimeKind: "public-resource", configurationOnly: true,
  apiKeyReferenceLabel: "Publishable key reference",
  apiKeyReferenceHint: "Reference a pk_ key. Your application publishes its value in image URLs. A private sk_ key cannot be used for this image flow.",
  setup: {
    url: "https://www.logo.dev/docs/platform/api-keys",
    steps: [
      "Sign into https://www.logo.dev/dashboard/api-keys and copy the publishable key beginning pk_. Do not copy the private sk_ key: this integration displays images, and its pk_ value will be visible in the published application's image URLs.",
      "Enter env:LOGO_DEV_PUBLISHABLE_KEY in Publishable key reference, then Save configuration. Choose Set credential in Env and store the actual pk_ value as LOGO_DEV_PUBLISHABLE_KEY. Return after saving Env. Your application must resolve this reference and expose only this publishable value to its image code.",
      "In Logo.dev API Keys, enable Allowed Domains Only, enter allowed domains one per line, then Save Changes. Include the application's actual hosting/custom domain and intended preview domains. example.com matches that domain; *.example.com matches its subdomains. Add localhost explicitly if needed for local development.",
      "Before enabling restrictions, ensure image requests send an origin referrer. Use referrerpolicy=origin on the image or an equivalent application policy; no-referrer and same-origin policies block cross-site referrers. Unlisted domains or missing referrers cause image failures.",
      "Application image code can look up a domain, stock ticker such as AAPL or SHEL.L, or an email domain. Email lookup strips the part before @ locally; it displays the company logo, not a personal avatar. Supply exactly one lookup value and use meaningful alternative text and a missing-image fallback.",
      "LIMITATIONS: no brand search, private enrichment API, crypto or ISIN lookup in this helper. Example: a gmail.com address resolves the email provider logo, not the person's business. Your app must add any attribution required by your provider plan; saving does not add an attribution badge.",
      "This setup creates image configuration, not an OAuth grant. The application's image load/error events report delivery; saving cannot verify the key. A missing logo may return a monogram unless the application selects the 404 fallback. To rotate keys, contact Logo.dev support, then replace the Env value."

    ]
  }
});
export { logoDevDefinition };
