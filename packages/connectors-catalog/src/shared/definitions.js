import { aiDefinition } from "./ai.js";
export { aiDefinition } from "./ai.js";
import { wizDefinition } from "./wiz.js";
export { wizDefinition } from "./wiz.js";
import { shopifyDefinition } from "./shopify.js";
export { shopifyDefinition } from "./shopify.js";
import { workdayDefinition } from "./workday.js";
export { workdayDefinition } from "./workday.js";
import { geminiEnterpriseDefinition } from "./gemini-enterprise.js";
export { geminiEnterpriseDefinition } from "./gemini-enterprise.js";
import { snowflakeDefinition } from "./snowflake.js";
export { snowflakeDefinition } from "./snowflake.js";
import { wixDefinition } from "./wix.js";
export { wixDefinition } from "./wix.js";
import { tiktokDefinition } from "./tiktok.js";
export { tiktokDefinition } from "./tiktok.js";
import { xTwitterDefinition } from "./x-twitter.js";
export { xTwitterDefinition } from "./x-twitter.js";
import { linkedinDefinition } from "./linkedin.js";
export { linkedinDefinition } from "./linkedin.js";
import { googleAdsDefinition } from "./google-ads.js";
export { googleAdsDefinition } from "./google-ads.js";
import { salesforceDefinition } from "./salesforce.js";
export { salesforceDefinition } from "./salesforce.js";
import { firebaseCloudMessagingDefinition } from "./firebase-cloud-messaging.js";
export { firebaseCloudMessagingDefinition } from "./firebase-cloud-messaging.js";
import { dbtSemanticLayerDefinition } from "./dbt-semantic-layer.js";
export { dbtSemanticLayerDefinition } from "./dbt-semantic-layer.js";
import { microsoftFabricDefinition } from "./microsoft-fabric.js";
import { databricksDefinition } from "./databricks.js";
export { databricksDefinition } from "./databricks.js";
import { lightspeedDefinition } from "./lightspeed.js";
export { lightspeedDefinition } from "./lightspeed.js";
import { confidenceFlagsDefinition, confidenceExpDefinition } from "./confidence.js";
export { confidenceFlagsDefinition, confidenceExpDefinition } from "./confidence.js";
import { hexDefinition } from "./hex.js";
export { hexDefinition } from "./hex.js";
import { granolaDefinition } from "./granola.js";
export { granolaDefinition } from "./granola.js";
import { zohoBooksDefinition } from "./zoho-books.js";
export { zohoBooksDefinition } from "./zoho-books.js";
import { zohoCrmDefinition } from "./zoho-crm.js";
export { zohoCrmDefinition } from "./zoho-crm.js";
import { waveDefinition } from "./wave.js";
export { waveDefinition } from "./wave.js";
import { semrushDefinition } from "./semrush.js";
export * from "./semrush.js";
import { xeroDefinition } from "./xero.js";
export { xeroDefinition } from "./xero.js";
import { amazonRedshiftDefinition } from "./amazon-redshift.js";
export { amazonRedshiftDefinition } from "./amazon-redshift.js";
import { awsS3Definition, awsAthenaDefinition } from "./aws.js";
export { awsS3Definition, awsAthenaDefinition } from "./aws.js";
import { slackDefinition } from "./slack.js";
export { slackDefinition } from "./slack.js";
import { figmaDefinition } from "./figma.js";
import { prestashopDefinition } from "./prestashop.js";
import { clickhouseDefinition } from "./clickhouse.js";
import { twitchDefinition } from "./twitch.js";
export * from "./twitch.js";
export * from "./clickhouse.js";
export * from "./prestashop.js";
import { miroDefinition } from "./miro.js";
export * from "./figma.js";
export * from "./miro.js";
import { canvaDefinition } from "./canva.js";
export * from "./canva.js";
import { atlassianDefinition } from "./atlassian.js";
export * from "./atlassian.js";
import { amplitudeDefinition } from "./amplitude.js";
import { wordpressComDefinition } from "./wordpress-com.js";
import { n8nDefinition, sanityDefinition } from "./mcp.js";
import { inngestDefinition } from "./inngest.js";
export * from "./inngest.js";
export * from "./mcp.js";
import { googleDefinitions } from "./google.js";
import { tokenDefinitions } from "./tokens.js";
import { microsoftDefinitions } from "./microsoft.js";
import { ouraDefinition } from "./oura.js";
import { algoliaDefinition } from "./algolia.js";
import { twilioDefinition } from "./twilio.js";
import { gongDefinition } from "./gong.js";
import { posthogDefinition } from "./posthog.js";
import { chargebeeDefinition } from "./chargebee.js";
import { mapboxDefinition } from "./mapbox.js";
import { logoDevDefinition } from "./logo-dev.js";
import { googleMapsPlatformDefinition } from "./google-maps-platform.js";
import { woocommerceDefinition, wordpressSelfHostedDefinition } from "./wordpress.js";
export * from "./wordpress-com.js";
export * from "./google.js";
export * from "./tokens.js";
export * from "./microsoft.js";
export * from "./oura.js";
export * from "./algolia.js";
export * from "./twilio.js";
export * from "./gong.js";
export * from "./posthog.js";
export * from "./chargebee.js";
export * from "./mapbox.js";
export * from "./logo-dev.js";
export * from "./google-maps-platform.js";
export * from "./wordpress.js";
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

const firecrawlDefinition = Object.freeze({
  id: "firecrawl", name: "Firecrawl", description: "Search, map, scrape and extract web content; run bounded site crawls.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"], scopes: [],
  setup: {
    url: "https://docs.firecrawl.dev/introduction",
    steps: [
      "Open https://www.firecrawl.dev/app/api-keys and sign in. Select the team that will pay for this application and check its available credits.",
      "Open API Keys and create or copy a key for that team.",
      "Enter env:FIRECRAWL_API_KEY as the API key reference and Save configuration. Follow Set credential in Env, save the real key as FIRECRAWL_API_KEY, then return here and choose Connect account or Verify again. Check connection reads saved status. Keep the key out of source and browser code.",
      "Verification reads remaining team credits without scraping. A valid key with zero credits can connect, but does not promise a successful scrape. Scraping is a separate, authorized operation that consumes credits. Correct invalid keys or team access before retrying a failed connection.",
      "Search, mapping, extraction and crawling use your team credits. Crawls require an explicit page limit. Save the returned job ID, check its status, follow returned result pages and inspect crawl errors; starting a crawl is not a completed import. Your app owns scheduling and saved content.",
      "To rotate a key, use the team API Keys page, update Env and verify again before revoking the previous key. Disconnect only removes this application connection; revoke the key in Firecrawl separately. No OAuth app ID, secret or callback is required. This setup uses your team credits; Vibe64 does not supply a managed subscription."
    ]
  }
});

const connectorDefinitions = Object.freeze([aiDefinition, wizDefinition, shopifyDefinition, workdayDefinition, geminiEnterpriseDefinition, snowflakeDefinition, wixDefinition, tiktokDefinition, xTwitterDefinition, linkedinDefinition, googleAdsDefinition,
  salesforceDefinition, firebaseCloudMessagingDefinition, resendDefinition, firecrawlDefinition, ...googleDefinitions, ...tokenDefinitions, ...microsoftDefinitions, ouraDefinition, algoliaDefinition, twilioDefinition, gongDefinition, posthogDefinition, chargebeeDefinition, mapboxDefinition, logoDevDefinition, googleMapsPlatformDefinition, woocommerceDefinition, wordpressSelfHostedDefinition, wordpressComDefinition, n8nDefinition, sanityDefinition, inngestDefinition, amplitudeDefinition, atlassianDefinition, canvaDefinition, figmaDefinition, miroDefinition, prestashopDefinition, clickhouseDefinition, twitchDefinition, slackDefinition, awsS3Definition, awsAthenaDefinition, amazonRedshiftDefinition, xeroDefinition, semrushDefinition, waveDefinition, zohoCrmDefinition, zohoBooksDefinition, granolaDefinition, hexDefinition, confidenceFlagsDefinition, confidenceExpDefinition, lightspeedDefinition, databricksDefinition, microsoftFabricDefinition, dbtSemanticLayerDefinition]);
export { connectorDefinitions, resendDefinition, firecrawlDefinition };
