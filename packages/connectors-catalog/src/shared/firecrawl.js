const firecrawlDefinition = Object.freeze({
  id: "firecrawl", name: "Firecrawl", description: "jskit.connectors.firecrawl.description",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  setup: {
    url: "https://docs.firecrawl.dev/introduction",
    steps: [
      "Open https://www.firecrawl.dev/app/api-keys and sign in. Select the team that will pay for this application and check its available credits.",
      "Open API Keys and create or copy a key for that team.",
      "Enter env:FIRECRAWL_API_KEY as the API key reference and Save configuration. Follow Set credential in Env, save the real key as FIRECRAWL_API_KEY, then return here and choose Connect account or Verify again. Check connection reads saved status. Keep the key out of source and browser code.",
      "Verification reads remaining team credits without scraping. A valid key with zero credits can connect, but does not promise a successful scrape. Scraping is a separate, authorized operation that consumes credits. Correct invalid keys or team access before retrying a failed connection.",
      "Search, mapping, extraction and crawling use your team credits. Crawls require an explicit page limit. Save the returned job ID, check its status, follow returned result pages and inspect crawl errors; starting a crawl is not a completed import. Your app owns scheduling and saved content.",
      "To rotate a key, use the team API Keys page, update Env and verify again before revoking the previous key. Disconnect only removes this application connection; revoke the key in Firecrawl separately. No OAuth app ID, secret or callback is required. This setup uses your team credits; the connector does not supply a managed subscription."
    ]
  }
});

export { firecrawlDefinition };
