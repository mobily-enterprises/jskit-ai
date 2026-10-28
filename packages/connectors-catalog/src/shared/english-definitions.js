// The browser-safe catalog ("@jskit-ai/connectors-catalog/shared") in English; the
// keyed definitions are in definitions.js (see english-texts.js).
import * as keyedDefinitions from "./definitions.js";
import { englishTexts } from "./english-texts.js";

export { createCanvaClientMetadata, validN8nOAuthDiscovery } from "./definitions.js";
export const {
  aiDefinition, airtableDefinition, algoliaDefinition, amazonRedshiftDefinition, apifyDefinition,
  apolloIoDefinition, asanaDefinition, ashbyDefinition, atlassianDefinition, attentionDefinition,
  awsAthenaDefinition, awsS3Definition, bigqueryDefinition, brevoDefinition, calendlyDefinition,
  canvaDefinition, chargebeeDefinition, clayDefinition, clickhouseDefinition,
  confidenceExpDefinition, confidenceFlagsDefinition, connectorDefinitions, contentfulDefinition,
  databricksDefinition, dbtSemanticLayerDefinition, elevenlabsDefinition, figmaDefinition,
  firebaseCloudMessagingDefinition, firecrawlDefinition, firefliesDefinition,
  fireworksAiDefinition, gatewayApiDefinition, geminiEnterpriseDefinition, githubApiDefinition,
  gitlabApiDefinition, gmailDefinition, gongDefinition, googleAdsDefinition,
  googleAnalyticsDefinition, googleDefinitions, googleDocsDefinition, googleDriveDefinition,
  googleMapsPlatformDefinition, googleSearchConsoleDefinition, googleSheetsDefinition,
  googleSlidesDefinition, granolaDefinition, hexDefinition, heygenDefinition, hubspotDefinition,
  incidentIoDefinition, inngestDefinition, klipyDefinition, lexwareDefinition,
  lightspeedDefinition, linearDefinition, linkedinDefinition, logoDevDefinition, mailgunDefinition,
  mapboxDefinition, microsoftDefinitions, microsoftExcelDefinition, microsoftOneDriveDefinition,
  microsoftOneNoteDefinition, microsoftOutlookDefinition, microsoftPowerPointDefinition,
  microsoftSharePointDefinition, microsoftTeamsDefinition, microsoftWordDefinition, miroDefinition,
  n8nDefinition, notionDefinition, ouraDefinition, paddleDefinition, perplexityDefinition,
  pipedriveDefinition, polarDefinition, posthogDefinition, prestashopDefinition,
  replicateDefinition, resendDefinition, salesforceDefinition, sanityDefinition, semrushDefinition,
  sentryDefinition, sevdeskDefinition, shopifyDefinition, slackDefinition, snowflakeDefinition,
  storyblokDefinition, stripeDefinition, supabaseDefinition, tallyDefinition, telegramDefinition,
  tiktokDefinition, tokenDefinitions, twilioDefinition, twitchDefinition, waveDefinition,
  wixDefinition, wizDefinition, woocommerceDefinition, wordpressComDefinition,
  wordpressSelfHostedDefinition, workdayDefinition, xTwitterDefinition, xeroDefinition,
  zohoBooksDefinition, zohoCrmDefinition
} = englishTexts({ ...keyedDefinitions });
