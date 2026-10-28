# Changelog

## 0.2.0 - 2026-10-29

- Translation ready: every user-visible text is a message key with its English in `locales/en.json`, so an app translates it by supplying translation files only. With no translations, texts and behaviour are unchanged. See the guide "Translating a JSKIT app".
- Definitions carry message keys internally; `./shared` and `./shared/ai` export them rendered to English exactly as before, each linked to its keyed original for connectors-web. With an app language active, the AI model catalogue date follows it.

### New message keys (1327)

All keys in `locales/en.json` (exported as `./locales/en.json`) are new in this version.

<details><summary>Key list</summary>

- `jskit.connectors.ai.access.freeNoSetup`
- `jskit.connectors.ai.access.freeWithConnection`
- `jskit.connectors.ai.access.paid`
- `jskit.connectors.ai.access.unknown`
- `jskit.connectors.ai.accessConnectionDenied`
- `jskit.connectors.ai.apiKeyReferenceHint`
- `jskit.connectors.ai.authenticationHint`
- `jskit.connectors.ai.authenticationLabels.apiKey`
- `jskit.connectors.ai.authenticationLabels.none`
- `jskit.connectors.ai.authorizedAccountApiKeyUnavailable`
- `jskit.connectors.ai.connectionNotConfigured`
- `jskit.connectors.ai.description`
- `jskit.connectors.ai.fields.model.hint`
- `jskit.connectors.ai.fields.model.label`
- `jskit.connectors.ai.fields.model.selectedHint.freeNoSetup`
- `jskit.connectors.ai.fields.model.selectedHint.freeWithConnection`
- `jskit.connectors.ai.fields.model.selectedHint.paid`
- `jskit.connectors.ai.fields.model.selectedHint.unknown`
- `jskit.connectors.ai.individualAccountsRequireUserOwned`
- `jskit.connectors.airtable.description`
- `jskit.connectors.algolia.description`
- `jskit.connectors.algolia.fields.applicationId.hint`
- `jskit.connectors.algolia.fields.applicationId.label`
- `jskit.connectors.algolia.fields.publicApiKeyRef.environmentCredential.label`
- `jskit.connectors.algolia.fields.publicApiKeyRef.hint`
- `jskit.connectors.algolia.fields.publicApiKeyRef.label`
- `jskit.connectors.amazonRedshift.description`
- `jskit.connectors.amazonRedshift.didNotReturnStatementIdentifier`
- `jskit.connectors.amazonRedshift.fields.clusterIdentifier.label`
- `jskit.connectors.amazonRedshift.fields.database.label`
- `jskit.connectors.amazonRedshift.fields.databaseUser.hint`
- `jskit.connectors.amazonRedshift.fields.databaseUser.label`
- `jskit.connectors.amazonRedshift.fields.deploymentType.items.provisioned.title`
- `jskit.connectors.amazonRedshift.fields.deploymentType.items.serverless.title`
- `jskit.connectors.amazonRedshift.fields.deploymentType.label`
- `jskit.connectors.amazonRedshift.fields.region.hint`
- `jskit.connectors.amazonRedshift.fields.region.label`
- `jskit.connectors.amazonRedshift.fields.workgroup.hint`
- `jskit.connectors.amazonRedshift.fields.workgroup.label`
- `jskit.connectors.amazonRedshift.returnedUnexpectedStatement`
- `jskit.connectors.amazonRedshift.statementBelongsDifferentTarget`
- `jskit.connectors.amazonRedshift.statementNoFinishedResultSet`
- `jskit.connectors.amazonRedshift.useSqlParameterNameOnce`
- `jskit.connectors.amplitude.description`
- `jskit.connectors.amplitude.fields.region.hint`
- `jskit.connectors.amplitude.fields.region.items.eu.title`
- `jskit.connectors.amplitude.fields.region.items.us.title`
- `jskit.connectors.amplitude.fields.region.label`
- `jskit.connectors.amplitude.scopes.mcpRead.label`
- `jskit.connectors.amplitude.scopes.mcpWrite.label`
- `jskit.connectors.amplitude.scopes.offlineAccess.label`
- `jskit.connectors.apify.description`
- `jskit.connectors.apify.useFrameworkNativeClientStream`
- `jskit.connectors.apolloIo.description`
- `jskit.connectors.apolloIo.enterRecordRequiredIdentifyingFields`
- `jskit.connectors.asana.description`
- `jskit.connectors.asana.includeDueSettingClearingStart`
- `jskit.connectors.asana.startDateMustPrecedeProject`
- `jskit.connectors.ashby.couldNotCompleteOperation`
- `jskit.connectors.ashby.description`
- `jskit.connectors.ashby.supplyLeastCandidateProfileChange`
- `jskit.connectors.atlassian.description`
- `jskit.connectors.atlassian.scopes.deleteJiraAgentInterface.label`
- `jskit.connectors.atlassian.scopes.email.label`
- `jskit.connectors.atlassian.scopes.manageJiraAgentInterface.label`
- `jskit.connectors.atlassian.scopes.offlineAccess.label`
- `jskit.connectors.atlassian.scopes.readAccount.label`
- `jskit.connectors.atlassian.scopes.readAllTwg.label`
- `jskit.connectors.atlassian.scopes.readConfluenceAgentInterface.label`
- `jskit.connectors.atlassian.scopes.readJiraAgentInterface.label`
- `jskit.connectors.atlassian.scopes.readMe.label`
- `jskit.connectors.atlassian.scopes.readProduct.label`
- `jskit.connectors.atlassian.scopes.searchCodeAgentInterface.label`
- `jskit.connectors.atlassian.scopes.searchConfluenceAgentInterface.label`
- `jskit.connectors.atlassian.scopes.searchJiraAgentInterface.label`
- `jskit.connectors.atlassian.scopes.searchRovoAgentInterface.label`
- `jskit.connectors.atlassian.scopes.writeAllTwg.label`
- `jskit.connectors.atlassian.scopes.writeConfluenceAgentInterface.label`
- `jskit.connectors.atlassian.scopes.writeJiraAgentInterface.label`
- `jskit.connectors.atlassian.scopes.writeProduct.label`
- `jskit.connectors.attention.description`
- `jskit.connectors.attention.endTimeMustFollowStart`
- `jskit.connectors.aws.checkRegionResourceOperationSettings`
- `jskit.connectors.aws.credentials.apiKeyReferenceHint`
- `jskit.connectors.aws.credentials.apiKeyReferenceLabel`
- `jskit.connectors.aws.deniedOperationCheckIamResource`
- `jskit.connectors.aws.fields.accessKeyIdRef.environmentCredential.label`
- `jskit.connectors.aws.fields.accessKeyIdRef.hint`
- `jskit.connectors.aws.fields.accessKeyIdRef.label`
- `jskit.connectors.aws.fields.region.label`
- `jskit.connectors.aws.fields.sessionTokenRef.environmentCredential.label`
- `jskit.connectors.aws.fields.sessionTokenRef.hint`
- `jskit.connectors.aws.fields.sessionTokenRef.label`
- `jskit.connectors.aws.provideAccessKeyIdSecret`
- `jskit.connectors.aws.regionDoesNotMatchOperation`
- `jskit.connectors.aws.regions.afSouth1`
- `jskit.connectors.aws.regions.apEast1`
- `jskit.connectors.aws.regions.apEast2`
- `jskit.connectors.aws.regions.apNortheast1`
- `jskit.connectors.aws.regions.apNortheast2`
- `jskit.connectors.aws.regions.apNortheast3`
- `jskit.connectors.aws.regions.apSouth1`
- `jskit.connectors.aws.regions.apSouth2`
- `jskit.connectors.aws.regions.apSoutheast1`
- `jskit.connectors.aws.regions.apSoutheast2`
- `jskit.connectors.aws.regions.apSoutheast3`
- `jskit.connectors.aws.regions.apSoutheast4`
- `jskit.connectors.aws.regions.apSoutheast5`
- `jskit.connectors.aws.regions.apSoutheast6`
- `jskit.connectors.aws.regions.apSoutheast7`
- `jskit.connectors.aws.regions.caCentral1`
- `jskit.connectors.aws.regions.caWest1`
- `jskit.connectors.aws.regions.euCentral1`
- `jskit.connectors.aws.regions.euCentral2`
- `jskit.connectors.aws.regions.euNorth1`
- `jskit.connectors.aws.regions.euSouth1`
- `jskit.connectors.aws.regions.euSouth2`
- `jskit.connectors.aws.regions.euWest1`
- `jskit.connectors.aws.regions.euWest2`
- `jskit.connectors.aws.regions.euWest3`
- `jskit.connectors.aws.regions.ilCentral1`
- `jskit.connectors.aws.regions.meCentral1`
- `jskit.connectors.aws.regions.meSouth1`
- `jskit.connectors.aws.regions.mxCentral1`
- `jskit.connectors.aws.regions.saEast1`
- `jskit.connectors.aws.regions.usEast1`
- `jskit.connectors.aws.regions.usEast2`
- `jskit.connectors.aws.regions.usWest1`
- `jskit.connectors.aws.regions.usWest2`
- `jskit.connectors.aws.renewCredentialBindingsConnectAgain`
- `jskit.connectors.aws.requestFailedReturnedUnreadableResponse`
- `jskit.connectors.aws.requestLimitReached`
- `jskit.connectors.aws.resourceNotFound`
- `jskit.connectors.aws.sdkSelectedUnexpectedDestination`
- `jskit.connectors.awsAthena.description`
- `jskit.connectors.awsAthena.fields.resultLocation.hint`
- `jskit.connectors.awsAthena.fields.resultLocation.label`
- `jskit.connectors.awsAthena.fields.workgroup.hint`
- `jskit.connectors.awsAthena.fields.workgroup.label`
- `jskit.connectors.awsAthena.queryBelongsDifferentWorkgroup`
- `jskit.connectors.awsAthena.returnedDifferentWorkgroup`
- `jskit.connectors.awsAthena.returnedUnexpectedQuery`
- `jskit.connectors.awsS3.description`
- `jskit.connectors.awsS3.fields.bucket.label`
- `jskit.connectors.awsS3.permissionsHint`
- `jskit.connectors.awsS3.returnedUnexpectedBucketPageSize`
- `jskit.connectors.awsS3.scopes.read.label`
- `jskit.connectors.awsS3.scopes.write.label`
- `jskit.connectors.bigquery.description`
- `jskit.connectors.bigquery.fields.projectId.hint`
- `jskit.connectors.bigquery.fields.projectId.label`
- `jskit.connectors.bigquery.scopes.bigquery.label`
- `jskit.connectors.bigquery.scopes.bigqueryReadonly.label`
- `jskit.connectors.bigquery.scopes.cloudPlatform.label`
- `jskit.connectors.bigquery.scopes.cloudPlatformReadOnly.label`
- `jskit.connectors.brevo.chooseTemplateProvideSubjectEmail`
- `jskit.connectors.brevo.description`
- `jskit.connectors.brevo.smsContentOrTemplate`
- `jskit.connectors.calendly.chooseEventOwner`
- `jskit.connectors.calendly.choosePositiveRangeMost31`
- `jskit.connectors.calendly.description`
- `jskit.connectors.calendly.scopes.activityLogRead.label`
- `jskit.connectors.calendly.scopes.availabilityRead.label`
- `jskit.connectors.calendly.scopes.availabilityWrite.label`
- `jskit.connectors.calendly.scopes.contactsRead.label`
- `jskit.connectors.calendly.scopes.contactsWrite.label`
- `jskit.connectors.calendly.scopes.dataComplianceWrite.label`
- `jskit.connectors.calendly.scopes.eventTypesRead.label`
- `jskit.connectors.calendly.scopes.eventTypesWrite.label`
- `jskit.connectors.calendly.scopes.groupsRead.label`
- `jskit.connectors.calendly.scopes.locationsRead.label`
- `jskit.connectors.calendly.scopes.organizationsRead.label`
- `jskit.connectors.calendly.scopes.organizationsWrite.label`
- `jskit.connectors.calendly.scopes.outgoingCommunicationsRead.label`
- `jskit.connectors.calendly.scopes.routingFormsRead.label`
- `jskit.connectors.calendly.scopes.scheduledEventsRead.label`
- `jskit.connectors.calendly.scopes.scheduledEventsWrite.label`
- `jskit.connectors.calendly.scopes.schedulingLinksWrite.label`
- `jskit.connectors.calendly.scopes.sharesWrite.label`
- `jskit.connectors.calendly.scopes.usersRead.label`
- `jskit.connectors.calendly.scopes.webhooksRead.label`
- `jskit.connectors.calendly.scopes.webhooksWrite.label`
- `jskit.connectors.canva.clientIdHint`
- `jskit.connectors.canva.clientIdLabel`
- `jskit.connectors.canva.description`
- `jskit.connectors.canva.scopes.assetRead.label`
- `jskit.connectors.canva.scopes.assetWrite.label`
- `jskit.connectors.canva.scopes.brandkitRead.label`
- `jskit.connectors.canva.scopes.brandtemplateContentRead.label`
- `jskit.connectors.canva.scopes.brandtemplateContentWrite.label`
- `jskit.connectors.canva.scopes.brandtemplateMetaRead.label`
- `jskit.connectors.canva.scopes.commentRead.label`
- `jskit.connectors.canva.scopes.commentWrite.label`
- `jskit.connectors.canva.scopes.designContentRead.label`
- `jskit.connectors.canva.scopes.designContentWrite.label`
- `jskit.connectors.canva.scopes.designMetaRead.label`
- `jskit.connectors.canva.scopes.folderRead.label`
- `jskit.connectors.canva.scopes.folderWrite.label`
- `jskit.connectors.canva.scopes.helpAnswersRead.label`
- `jskit.connectors.canva.scopes.helpAnswersWrite.label`
- `jskit.connectors.canva.scopes.profileRead.label`
- `jskit.connectors.chargebee.description`
- `jskit.connectors.chargebee.fields.siteName.hint`
- `jskit.connectors.chargebee.fields.siteName.label`
- `jskit.connectors.clay.apiKeyReferenceLabel`
- `jskit.connectors.clay.description`
- `jskit.connectors.clickhouse.apiKeyReferenceHint`
- `jskit.connectors.clickhouse.apiKeyReferenceLabel`
- `jskit.connectors.clickhouse.authenticationHint`
- `jskit.connectors.clickhouse.authenticationLabels.apiKey`
- `jskit.connectors.clickhouse.authenticationLabels.none`
- `jskit.connectors.clickhouse.description`
- `jskit.connectors.clickhouse.fields.httpUrl.hint`
- `jskit.connectors.clickhouse.fields.httpUrl.label`
- `jskit.connectors.clickhouse.fields.username.hint`
- `jskit.connectors.clickhouse.fields.username.label`
- `jskit.connectors.confidence.scopes.email.label`
- `jskit.connectors.confidence.scopes.offlineAccess.label`
- `jskit.connectors.confidence.scopes.openid.label`
- `jskit.connectors.confidence.scopes.profile.label`
- `jskit.connectors.confidenceExp.description`
- `jskit.connectors.confidenceFlags.description`
- `jskit.connectors.contentful.apiKeyReferenceLabel`
- `jskit.connectors.contentful.description`
- `jskit.connectors.contentful.fields.environmentId.hint`
- `jskit.connectors.contentful.fields.environmentId.label`
- `jskit.connectors.contentful.fields.region.items.eu.title`
- `jskit.connectors.contentful.fields.region.items.us.title`
- `jskit.connectors.contentful.fields.region.label`
- `jskit.connectors.contentful.fields.spaceId.hint`
- `jskit.connectors.contentful.fields.spaceId.label`
- `jskit.connectors.databricks.description`
- `jskit.connectors.databricks.fields.workspaceUrl.hint`
- `jskit.connectors.databricks.fields.workspaceUrl.label`
- `jskit.connectors.databricks.oauthGrantHint`
- `jskit.connectors.databricks.permissionsHint`
- `jskit.connectors.databricks.returnedUnexpectedJobResponse`
- `jskit.connectors.databricks.scopes.allApis.label`
- `jskit.connectors.databricks.scopes.jobs.label`
- `jskit.connectors.databricks.scopes.offlineAccess.label`
- `jskit.connectors.dbtSemanticLayer.apiKeyReferenceHint`
- `jskit.connectors.dbtSemanticLayer.apiKeyReferenceLabel`
- `jskit.connectors.dbtSemanticLayer.completedWithoutJsonResultTable`
- `jskit.connectors.dbtSemanticLayer.couldNotCompleteRequestedOperation`
- `jskit.connectors.dbtSemanticLayer.description`
- `jskit.connectors.dbtSemanticLayer.fields.environmentId.hint`
- `jskit.connectors.dbtSemanticLayer.fields.environmentId.label`
- `jskit.connectors.dbtSemanticLayer.fields.host.hint`
- `jskit.connectors.dbtSemanticLayer.fields.host.label`
- `jskit.connectors.dbtSemanticLayer.queryFailedInspectStatusDo`
- `jskit.connectors.dbtSemanticLayer.returnedInvalidJsonResultPage`
- `jskit.connectors.dbtSemanticLayer.returnedInvalidJsonTable`
- `jskit.connectors.dbtSemanticLayer.returnedInvalidOversizedJsonResult`
- `jskit.connectors.dbtSemanticLayer.returnedUnexpectedMetadataPage`
- `jskit.connectors.dbtSemanticLayer.useServiceTokenWithoutSpaces`
- `jskit.connectors.elevenlabs.audioSamplesMustTotalMost`
- `jskit.connectors.elevenlabs.description`
- `jskit.connectors.elevenlabs.didNotReturnAudio`
- `jskit.connectors.elevenlabs.returnedEmptyAudio`
- `jskit.connectors.elevenlabs.useNativeStreamingAudioAbove`
- `jskit.connectors.figma.description`
- `jskit.connectors.figma.scopes.mcpConnect.label`
- `jskit.connectors.firebaseCloudMessaging.couldNotAuthorizeServiceAccount`
- `jskit.connectors.firebaseCloudMessaging.description`
- `jskit.connectors.firebaseCloudMessaging.fields.apiKey.hint`
- `jskit.connectors.firebaseCloudMessaging.fields.apiKey.label`
- `jskit.connectors.firebaseCloudMessaging.fields.appId.hint`
- `jskit.connectors.firebaseCloudMessaging.fields.appId.label`
- `jskit.connectors.firebaseCloudMessaging.fields.clientMode.hint`
- `jskit.connectors.firebaseCloudMessaging.fields.clientMode.items.server.title`
- `jskit.connectors.firebaseCloudMessaging.fields.clientMode.items.web.title`
- `jskit.connectors.firebaseCloudMessaging.fields.clientMode.label`
- `jskit.connectors.firebaseCloudMessaging.fields.projectId.hint`
- `jskit.connectors.firebaseCloudMessaging.fields.projectId.label`
- `jskit.connectors.firebaseCloudMessaging.fields.vapidKey.hint`
- `jskit.connectors.firebaseCloudMessaging.fields.vapidKey.label`
- `jskit.connectors.firebaseCloudMessaging.permissionsHint`
- `jskit.connectors.firebaseCloudMessaging.recipientNoLongerRegisteredRemove`
- `jskit.connectors.firebaseCloudMessaging.rejectedMessageTargetDoNot`
- `jskit.connectors.firebaseCloudMessaging.returnedInvalidMessageJson`
- `jskit.connectors.firebaseCloudMessaging.returnedUnexpectedMessageReceipt`
- `jskit.connectors.firebaseCloudMessaging.returnedUnexpectedTokenRedirect`
- `jskit.connectors.firebaseCloudMessaging.scopes.firebaseMessagingScope.label`
- `jskit.connectors.firebaseCloudMessaging.serviceAccountReferenceHint`
- `jskit.connectors.firebaseCloudMessaging.serviceAccountReferenceLabel`
- `jskit.connectors.firebaseCloudMessaging.useValidServiceAccountJson`
- `jskit.connectors.firecrawl.description`
- `jskit.connectors.firecrawl.useReturnedNextPageUrl`
- `jskit.connectors.fireflies.description`
- `jskit.connectors.fireworksAi.description`
- `jskit.connectors.gatewayApi.description`
- `jskit.connectors.gatewayApi.fields.region.hint`
- `jskit.connectors.gatewayApi.fields.region.items.eu.title`
- `jskit.connectors.gatewayApi.fields.region.items.global.title`
- `jskit.connectors.gatewayApi.fields.region.label`
- `jskit.connectors.gatewayapi.invalidWebhookEvent`
- `jskit.connectors.geminiEnterprise.description`
- `jskit.connectors.geminiEnterprise.fields.engineId.hint`
- `jskit.connectors.geminiEnterprise.fields.engineId.label`
- `jskit.connectors.geminiEnterprise.fields.location.hint`
- `jskit.connectors.geminiEnterprise.fields.location.items.eu.title`
- `jskit.connectors.geminiEnterprise.fields.location.items.global.title`
- `jskit.connectors.geminiEnterprise.fields.location.items.us.title`
- `jskit.connectors.geminiEnterprise.fields.location.label`
- `jskit.connectors.geminiEnterprise.fields.projectId.hint`
- `jskit.connectors.geminiEnterprise.fields.projectId.label`
- `jskit.connectors.geminiEnterprise.permissionsHint`
- `jskit.connectors.geminiEnterprise.scopes.geminiEnterpriseScope.label`
- `jskit.connectors.githubApi.description`
- `jskit.connectors.githubApi.scopes.gist.label`
- `jskit.connectors.githubApi.scopes.notifications.label`
- `jskit.connectors.githubApi.scopes.offlineAccess.label`
- `jskit.connectors.githubApi.scopes.project.label`
- `jskit.connectors.githubApi.scopes.publicRepo.label`
- `jskit.connectors.githubApi.scopes.readOrg.label`
- `jskit.connectors.githubApi.scopes.readUser.label`
- `jskit.connectors.githubApi.scopes.repo.label`
- `jskit.connectors.githubApi.scopes.userEmail.label`
- `jskit.connectors.githubApi.scopes.workflow.label`
- `jskit.connectors.gitlabApi.description`
- `jskit.connectors.gitlabApi.fields.instanceUrl.hint`
- `jskit.connectors.gitlabApi.fields.instanceUrl.label`
- `jskit.connectors.gitlabApi.scopes.api.label`
- `jskit.connectors.gitlabApi.scopes.readApi.label`
- `jskit.connectors.gitlabApi.scopes.readUser.label`
- `jskit.connectors.gmail.description`
- `jskit.connectors.gmail.scopes.gmailAddonsCurrentActionCompose.label`
- `jskit.connectors.gmail.scopes.gmailAddonsCurrentMessageAction.label`
- `jskit.connectors.gmail.scopes.gmailAddonsCurrentMessageMetadata.label`
- `jskit.connectors.gmail.scopes.gmailAddonsCurrentMessageReadonly.label`
- `jskit.connectors.gmail.scopes.gmailCompose.label`
- `jskit.connectors.gmail.scopes.gmailInsert.label`
- `jskit.connectors.gmail.scopes.gmailLabels.label`
- `jskit.connectors.gmail.scopes.gmailMetadata.label`
- `jskit.connectors.gmail.scopes.gmailModify.label`
- `jskit.connectors.gmail.scopes.gmailReadonly.label`
- `jskit.connectors.gmail.scopes.gmailSend.label`
- `jskit.connectors.gmail.scopes.gmailSettingsBasic.label`
- `jskit.connectors.gmail.scopes.gmailSettingsSharing.label`
- `jskit.connectors.gmail.scopes.httpsMailGoogleCom.label`
- `jskit.connectors.gmail.supplyLabelsAddRemove`
- `jskit.connectors.gong.apiKeyReferenceLabel`
- `jskit.connectors.gong.description`
- `jskit.connectors.gong.endDateMustFollowStart`
- `jskit.connectors.gong.fields.accessKey.hint`
- `jskit.connectors.gong.fields.accessKey.label`
- `jskit.connectors.gong.fields.apiBaseUrl.hint`
- `jskit.connectors.gong.fields.apiBaseUrl.label`
- `jskit.connectors.gong.supplyCallIdsOrderedTimestamp`
- `jskit.connectors.gong.supplyIdsStringsPreserveAll`
- `jskit.connectors.google.batchRequestsInvalid`
- `jskit.connectors.google.scopes.drive.label`
- `jskit.connectors.google.scopes.driveFile.label`
- `jskit.connectors.google.scopes.driveReadonly.label`
- `jskit.connectors.googleAds.apiCapacityExhaustedCheckCloud`
- `jskit.connectors.googleAds.checkApiAccessApprovalCloud`
- `jskit.connectors.googleAds.connectAgainRequiredPermission`
- `jskit.connectors.googleAds.description`
- `jskit.connectors.googleAds.fields.loginCustomerId.hint`
- `jskit.connectors.googleAds.fields.loginCustomerId.label`
- `jskit.connectors.googleAds.permissionsHint`
- `jskit.connectors.googleAds.rejectedOperationCheckCampaignFields`
- `jskit.connectors.googleAds.resourceUnavailable`
- `jskit.connectors.googleAds.scopes.httpsWwwGoogleapisComAuthAdwords.label`
- `jskit.connectors.googleAdsSearch.campaignChangedInspectApproveAgain`
- `jskit.connectors.googleAdsSearch.campaignExceedsBoundedSearchReview`
- `jskit.connectors.googleAdsSearch.chooseActiveClientAccount`
- `jskit.connectors.googleAdsSearch.chooseActiveClientAccountMatch`
- `jskit.connectors.googleAdsSearch.chooseEnabledWebsiteConversionAction`
- `jskit.connectors.googleAdsSearch.chooseIntegration`
- `jskit.connectors.googleAdsSearch.confirmInstalledConversionTrackingBilling`
- `jskit.connectors.googleAdsSearch.didNotReturnSelectedAccount`
- `jskit.connectors.googleAdsSearch.enterLocationNameUsingLetters`
- `jskit.connectors.googleAdsSearch.pausedCampaignCanLaunchedHere`
- `jskit.connectors.googleAdsSearch.returnedInvalidCampaignGoal`
- `jskit.connectors.googleAdsSearch.reviewNonPoliticalSearchCampaign`
- `jskit.connectors.googleAdsSearch.screenLaunchesSearchCampaignsManual`
- `jskit.connectors.googleAdsSearch.searchPlanChangedReviewAgain`
- `jskit.connectors.googleAdsSearch.selectAccessibleSearchCampaign`
- `jskit.connectors.googleAnalytics.authenticationHint`
- `jskit.connectors.googleAnalytics.authenticationLabels.none`
- `jskit.connectors.googleAnalytics.description`
- `jskit.connectors.googleAnalytics.fields.measurementId.hint`
- `jskit.connectors.googleAnalytics.fields.measurementId.label`
- `jskit.connectors.googleDocs.description`
- `jskit.connectors.googleDocs.scopes.documents.label`
- `jskit.connectors.googleDocs.scopes.documentsReadonly.label`
- `jskit.connectors.googleDocs.verificationFields.documentId.hint`
- `jskit.connectors.googleDocs.verificationFields.documentId.label`
- `jskit.connectors.googleDrive.base64Invalid`
- `jskit.connectors.googleDrive.description`
- `jskit.connectors.googleDrive.metadataChangeRequired`
- `jskit.connectors.googleDrive.mimeTypeInvalid`
- `jskit.connectors.googleDrive.parentIdNewFilesOnly`
- `jskit.connectors.googleDrive.scopes.drive.label`
- `jskit.connectors.googleDrive.scopes.driveActivity.label`
- `jskit.connectors.googleDrive.scopes.driveActivityReadonly.label`
- `jskit.connectors.googleDrive.scopes.driveAppdata.label`
- `jskit.connectors.googleDrive.scopes.driveAppfolder.label`
- `jskit.connectors.googleDrive.scopes.driveAppsReadonly.label`
- `jskit.connectors.googleDrive.scopes.driveFile.label`
- `jskit.connectors.googleDrive.scopes.driveMeetReadonly.label`
- `jskit.connectors.googleDrive.scopes.driveMetadata.label`
- `jskit.connectors.googleDrive.scopes.driveMetadataReadonly.label`
- `jskit.connectors.googleDrive.scopes.drivePhotosReadonly.label`
- `jskit.connectors.googleDrive.scopes.driveReadonly.label`
- `jskit.connectors.googleDrive.scopes.driveScripts.label`
- `jskit.connectors.googleDrive.uploadTooLarge`
- `jskit.connectors.googleDrive.useFrameworkNativeDriveClient`
- `jskit.connectors.googleMapsPlatform.apiKeyReferenceHint`
- `jskit.connectors.googleMapsPlatform.apiKeyReferenceLabel`
- `jskit.connectors.googleMapsPlatform.checkServerKeyBillingUsage`
- `jskit.connectors.googleMapsPlatform.couldNotAcceptGeocodingRequest`
- `jskit.connectors.googleMapsPlatform.couldNotProcessRequestTry`
- `jskit.connectors.googleMapsPlatform.deniedAccessCheckEnabledApi`
- `jskit.connectors.googleMapsPlatform.description`
- `jskit.connectors.googleMapsPlatform.fields.browserKeyRef.hint`
- `jskit.connectors.googleMapsPlatform.fields.browserKeyRef.label`
- `jskit.connectors.googleMapsPlatform.fields.mapId.hint`
- `jskit.connectors.googleMapsPlatform.fields.mapId.label`
- `jskit.connectors.googleMapsPlatform.requestQuotaReached`
- `jskit.connectors.googleMapsPlatform.verificationFields.address.hint`
- `jskit.connectors.googleMapsPlatform.verificationFields.address.label`
- `jskit.connectors.googleSearchConsole.datesOrder`
- `jskit.connectors.googleSearchConsole.description`
- `jskit.connectors.googleSearchConsole.scopes.siteverification.label`
- `jskit.connectors.googleSearchConsole.scopes.siteverificationVerifyOnly.label`
- `jskit.connectors.googleSearchConsole.scopes.webmasters.label`
- `jskit.connectors.googleSearchConsole.scopes.webmastersReadonly.label`
- `jskit.connectors.googleSheets.description`
- `jskit.connectors.googleSheets.rangesInvalid`
- `jskit.connectors.googleSheets.scopes.driveMetadataReadonly.label`
- `jskit.connectors.googleSheets.scopes.spreadsheets.label`
- `jskit.connectors.googleSheets.scopes.spreadsheetsReadonly.label`
- `jskit.connectors.googleSheets.valuesMatrixInvalid`
- `jskit.connectors.googleSheets.verificationFields.spreadsheetId.hint`
- `jskit.connectors.googleSheets.verificationFields.spreadsheetId.label`
- `jskit.connectors.googleSlides.description`
- `jskit.connectors.googleSlides.scopes.presentations.label`
- `jskit.connectors.googleSlides.scopes.presentationsReadonly.label`
- `jskit.connectors.googleSlides.scopes.spreadsheets.label`
- `jskit.connectors.googleSlides.scopes.spreadsheetsReadonly.label`
- `jskit.connectors.googleSlides.verificationFields.presentationId.hint`
- `jskit.connectors.googleSlides.verificationFields.presentationId.label`
- `jskit.connectors.granola.description`
- `jskit.connectors.granola.noteUnavailable`
- `jskit.connectors.granola.readTranscriptPagesTranscriptsList`
- `jskit.connectors.granola.returnedDataDoesNotMatch`
- `jskit.connectors.granola.scopes.email.label`
- `jskit.connectors.granola.scopes.offlineAccess.label`
- `jskit.connectors.granola.scopes.openid.label`
- `jskit.connectors.granola.scopes.profile.label`
- `jskit.connectors.granola.useGrnApiKeyWithout`
- `jskit.connectors.hex.description`
- `jskit.connectors.hex.fields.endpoint.hint`
- `jskit.connectors.hex.fields.endpoint.items.eu.title`
- `jskit.connectors.hex.fields.endpoint.items.hipaa.title`
- `jskit.connectors.hex.fields.endpoint.items.standard.title`
- `jskit.connectors.hex.fields.endpoint.label`
- `jskit.connectors.hex.scopes.email.label`
- `jskit.connectors.hex.scopes.offlineAccess.label`
- `jskit.connectors.hex.scopes.openid.label`
- `jskit.connectors.hex.scopes.profile.label`
- `jskit.connectors.heygen.description`
- `jskit.connectors.heygen.scopes.email.label`
- `jskit.connectors.heygen.scopes.openid.label`
- `jskit.connectors.heygen.scopes.profile.label`
- `jskit.connectors.heygenKey.description`
- `jskit.connectors.hubspot.contactIdentityRequired`
- `jskit.connectors.hubspot.dealNameStageRequired`
- `jskit.connectors.hubspot.scopes.crmObjectsContactsRead.label`
- `jskit.connectors.hubspot.scopes.crmObjectsContactsWrite.label`
- `jskit.connectors.hubspot.scopes.crmObjectsDealsRead.label`
- `jskit.connectors.hubspot.scopes.crmObjectsDealsWrite.label`
- `jskit.connectors.hubspot.scopes.oauth.label`
- `jskit.connectors.hubspotKey.description`
- `jskit.connectors.incidentIo.description`
- `jskit.connectors.inngest.apiKeyReferenceHint`
- `jskit.connectors.inngest.apiKeyReferenceLabel`
- `jskit.connectors.inngest.configureValidEventKeyReconnect`
- `jskit.connectors.inngest.deniedEvent`
- `jskit.connectors.inngest.description`
- `jskit.connectors.inngest.eventKeyBindingMissingInvalid`
- `jskit.connectors.inngest.eventLimitReached`
- `jskit.connectors.inngest.fields.branchEnvironment.hint`
- `jskit.connectors.inngest.fields.branchEnvironment.label`
- `jskit.connectors.inngest.fields.eventKeyRef.environmentCredential.label`
- `jskit.connectors.inngest.fields.eventKeyRef.hint`
- `jskit.connectors.inngest.fields.eventKeyRef.label`
- `jskit.connectors.klipy.description`
- `jskit.connectors.klipy.rejectedOperation`
- `jskit.connectors.lexware.description`
- `jskit.connectors.lightspeed.description`
- `jskit.connectors.lightspeed.fields.domainPrefix.hint`
- `jskit.connectors.lightspeed.fields.domainPrefix.label`
- `jskit.connectors.lightspeed.lowerVersionMustBelowUpper`
- `jskit.connectors.lightspeed.returnedInvalidTokenGrantDifferent`
- `jskit.connectors.lightspeed.scopes.auditRead.label`
- `jskit.connectors.lightspeed.scopes.businessRulesRead.label`
- `jskit.connectors.lightspeed.scopes.businessRulesWrite.label`
- `jskit.connectors.lightspeed.scopes.channelsRead.label`
- `jskit.connectors.lightspeed.scopes.consignmentsRead.label`
- `jskit.connectors.lightspeed.scopes.consignmentsWriteInventoryCount.label`
- `jskit.connectors.lightspeed.scopes.consignmentsWriteStockOrder.label`
- `jskit.connectors.lightspeed.scopes.consignmentsWriteStockTransfer.label`
- `jskit.connectors.lightspeed.scopes.customFieldsRead.label`
- `jskit.connectors.lightspeed.scopes.customFieldsWrite.label`
- `jskit.connectors.lightspeed.scopes.customersRead.label`
- `jskit.connectors.lightspeed.scopes.customersWrite.label`
- `jskit.connectors.lightspeed.scopes.fulfillmentsRead.label`
- `jskit.connectors.lightspeed.scopes.fulfillmentsWrite.label`
- `jskit.connectors.lightspeed.scopes.giftCardsRead.label`
- `jskit.connectors.lightspeed.scopes.giftCardsWriteIssue.label`
- `jskit.connectors.lightspeed.scopes.giftCardsWriteRedeem.label`
- `jskit.connectors.lightspeed.scopes.inventoryRead.label`
- `jskit.connectors.lightspeed.scopes.inventoryWrite.label`
- `jskit.connectors.lightspeed.scopes.outletsRead.label`
- `jskit.connectors.lightspeed.scopes.paymentTypesRead.label`
- `jskit.connectors.lightspeed.scopes.paymentsRead.label`
- `jskit.connectors.lightspeed.scopes.productsRead.label`
- `jskit.connectors.lightspeed.scopes.productsReadPriceBooks.label`
- `jskit.connectors.lightspeed.scopes.productsWrite.label`
- `jskit.connectors.lightspeed.scopes.productsWritePriceBooks.label`
- `jskit.connectors.lightspeed.scopes.promotionsRead.label`
- `jskit.connectors.lightspeed.scopes.promotionsWrite.label`
- `jskit.connectors.lightspeed.scopes.registerClose.label`
- `jskit.connectors.lightspeed.scopes.registerOpen.label`
- `jskit.connectors.lightspeed.scopes.registersRead.label`
- `jskit.connectors.lightspeed.scopes.remoteRulesRead.label`
- `jskit.connectors.lightspeed.scopes.remoteRulesWrite.label`
- `jskit.connectors.lightspeed.scopes.retailerRead.label`
- `jskit.connectors.lightspeed.scopes.salesRead.label`
- `jskit.connectors.lightspeed.scopes.salesWrite.label`
- `jskit.connectors.lightspeed.scopes.serialNumbersRead.label`
- `jskit.connectors.lightspeed.scopes.serialNumbersWrite.label`
- `jskit.connectors.lightspeed.scopes.servicesRead.label`
- `jskit.connectors.lightspeed.scopes.servicesWrite.label`
- `jskit.connectors.lightspeed.scopes.storeCreditsRead.label`
- `jskit.connectors.lightspeed.scopes.storeCreditsWriteIssue.label`
- `jskit.connectors.lightspeed.scopes.suppliersRead.label`
- `jskit.connectors.lightspeed.scopes.suppliersWrite.label`
- `jskit.connectors.lightspeed.scopes.taxesRead.label`
- `jskit.connectors.lightspeed.scopes.taxesWrite.label`
- `jskit.connectors.lightspeed.scopes.usersRead.label`
- `jskit.connectors.lightspeed.scopes.usersWrite.label`
- `jskit.connectors.lightspeed.scopes.webhooks.label`
- `jskit.connectors.lightspeed.useOrderedInventoryVersionBounds`
- `jskit.connectors.linear.scopes.commentsCreate.label`
- `jskit.connectors.linear.scopes.issuesCreate.label`
- `jskit.connectors.linear.scopes.read.label`
- `jskit.connectors.linear.scopes.timeScheduleWrite.label`
- `jskit.connectors.linear.scopes.write.label`
- `jskit.connectors.linearKey.description`
- `jskit.connectors.linkedin.connectOpenidProfilePermissions`
- `jskit.connectors.linkedin.description`
- `jskit.connectors.linkedin.didNotConfirmPostCreation`
- `jskit.connectors.linkedin.permissionsHint`
- `jskit.connectors.linkedin.returnedInvalidMemberIdentity`
- `jskit.connectors.linkedin.scopes.email.label`
- `jskit.connectors.linkedin.scopes.openid.label`
- `jskit.connectors.linkedin.scopes.profile.label`
- `jskit.connectors.linkedin.scopes.wMemberSocial.label`
- `jskit.connectors.logoDev.apiKeyReferenceHint`
- `jskit.connectors.logoDev.apiKeyReferenceLabel`
- `jskit.connectors.logoDev.description`
- `jskit.connectors.mailgun.description`
- `jskit.connectors.mailgun.fields.region.hint`
- `jskit.connectors.mailgun.fields.region.items.eu.title`
- `jskit.connectors.mailgun.fields.region.items.us.title`
- `jskit.connectors.mailgun.fields.region.label`
- `jskit.connectors.mapbox.apiKeyReferenceHint`
- `jskit.connectors.mapbox.apiKeyReferenceLabel`
- `jskit.connectors.mapbox.configureValidTokenConnectAgain`
- `jskit.connectors.mapbox.description`
- `jskit.connectors.mapbox.fields.publicTokenRef.environmentCredential.label`
- `jskit.connectors.mapbox.fields.publicTokenRef.hint`
- `jskit.connectors.mapbox.fields.publicTokenRef.label`
- `jskit.connectors.mapbox.fields.usage.items.backend.title`
- `jskit.connectors.mapbox.fields.usage.items.browser.title`
- `jskit.connectors.mapbox.fields.usage.label`
- `jskit.connectors.mcp.registrationFailed`
- `jskit.connectors.mcp.registrationInterrupted`
- `jskit.connectors.mcp.transportRequestedUnexpectedDestination`
- `jskit.connectors.microsoft.chooseDocumentFile`
- `jskit.connectors.microsoft.fields.tenantId.hint`
- `jskit.connectors.microsoft.fields.tenantId.label`
- `jskit.connectors.microsoft.returnedInvalidFileList`
- `jskit.connectors.microsoft.returnedInvalidFileMetadata`
- `jskit.connectors.microsoft.scopes.offlineAccess.label`
- `jskit.connectors.microsoftExcel.description`
- `jskit.connectors.microsoftExcel.scopes.filesRead.label`
- `jskit.connectors.microsoftExcel.scopes.filesReadAll.label`
- `jskit.connectors.microsoftExcel.scopes.filesReadWrite.label`
- `jskit.connectors.microsoftExcel.scopes.filesReadWriteAll.label`
- `jskit.connectors.microsoftExcel.scopes.offlineAccess.label`
- `jskit.connectors.microsoftFabric.couldNotCompleteGraphqlDocument`
- `jskit.connectors.microsoftFabric.description`
- `jskit.connectors.microsoftFabric.fields.graphqlEndpoint.hint`
- `jskit.connectors.microsoftFabric.fields.graphqlEndpoint.label`
- `jskit.connectors.microsoftFabric.fields.tenantId.hint`
- `jskit.connectors.microsoftFabric.fields.tenantId.label`
- `jskit.connectors.microsoftFabric.oauthGrantHint`
- `jskit.connectors.microsoftFabric.permissionsHint`
- `jskit.connectors.microsoftFabric.requiresNewSignConsent`
- `jskit.connectors.microsoftFabric.scopes.delegatedScope.label`
- `jskit.connectors.microsoftFabric.scopes.offlineAccess.label`
- `jskit.connectors.microsoftFabric.scopes.serviceScope.label`
- `jskit.connectors.microsoftOneDrive.description`
- `jskit.connectors.microsoftOneDrive.scopes.filesRead.label`
- `jskit.connectors.microsoftOneDrive.scopes.filesReadAll.label`
- `jskit.connectors.microsoftOneDrive.scopes.filesReadWrite.label`
- `jskit.connectors.microsoftOneDrive.scopes.filesReadWriteAll.label`
- `jskit.connectors.microsoftOneDrive.scopes.filesReadWriteAppFolder.label`
- `jskit.connectors.microsoftOneDrive.scopes.offlineAccess.label`
- `jskit.connectors.microsoftOneNote.description`
- `jskit.connectors.microsoftOneNote.scopes.notesCreate.label`
- `jskit.connectors.microsoftOneNote.scopes.notesRead.label`
- `jskit.connectors.microsoftOneNote.scopes.notesReadAll.label`
- `jskit.connectors.microsoftOneNote.scopes.notesReadWrite.label`
- `jskit.connectors.microsoftOneNote.scopes.notesReadWriteAll.label`
- `jskit.connectors.microsoftOneNote.scopes.offlineAccess.label`
- `jskit.connectors.microsoftOnedrive.useStandardPaddedBase64Up`
- `jskit.connectors.microsoftOnenote.useNativeOnenoteClientPages`
- `jskit.connectors.microsoftOutlook.description`
- `jskit.connectors.microsoftOutlook.endMustFollowStart`
- `jskit.connectors.microsoftOutlook.scopes.calendarsRead.label`
- `jskit.connectors.microsoftOutlook.scopes.calendarsReadWrite.label`
- `jskit.connectors.microsoftOutlook.scopes.mailRead.label`
- `jskit.connectors.microsoftOutlook.scopes.mailReadBasic.label`
- `jskit.connectors.microsoftOutlook.scopes.mailReadWrite.label`
- `jskit.connectors.microsoftOutlook.scopes.mailSend.label`
- `jskit.connectors.microsoftOutlook.scopes.offlineAccess.label`
- `jskit.connectors.microsoftPowerPoint.description`
- `jskit.connectors.microsoftPowerPoint.scopes.filesRead.label`
- `jskit.connectors.microsoftSharePoint.description`
- `jskit.connectors.microsoftSharePoint.scopes.filesReadAll.label`
- `jskit.connectors.microsoftSharePoint.scopes.filesReadWriteAll.label`
- `jskit.connectors.microsoftSharePoint.scopes.offlineAccess.label`
- `jskit.connectors.microsoftSharePoint.scopes.sitesFullControlAll.label`
- `jskit.connectors.microsoftSharePoint.scopes.sitesManageAll.label`
- `jskit.connectors.microsoftSharePoint.scopes.sitesReadAll.label`
- `jskit.connectors.microsoftSharePoint.scopes.sitesReadWriteAll.label`
- `jskit.connectors.microsoftSharePoint.scopes.userRead.label`
- `jskit.connectors.microsoftSharePoint.verificationFields.search.hint`
- `jskit.connectors.microsoftSharePoint.verificationFields.search.label`
- `jskit.connectors.microsoftTeams.description`
- `jskit.connectors.microsoftTeams.scopes.channelMessageReadAll.label`
- `jskit.connectors.microsoftTeams.scopes.channelMessageSend.label`
- `jskit.connectors.microsoftTeams.scopes.channelReadBasicAll.label`
- `jskit.connectors.microsoftTeams.scopes.chatReadWrite.label`
- `jskit.connectors.microsoftTeams.scopes.offlineAccess.label`
- `jskit.connectors.microsoftTeams.scopes.teamReadBasicAll.label`
- `jskit.connectors.microsoftTeams.scopes.userRead.label`
- `jskit.connectors.microsoftTeams.scopes.userReadAll.label`
- `jskit.connectors.microsoftWord.description`
- `jskit.connectors.microsoftWord.scopes.filesRead.label`
- `jskit.connectors.miro.description`
- `jskit.connectors.miro.scopes.boardsRead.label`
- `jskit.connectors.miro.scopes.boardsWrite.label`
- `jskit.connectors.miro.scopes.email.label`
- `jskit.connectors.miro.scopes.openid.label`
- `jskit.connectors.n8n.apiKeyReferenceHint`
- `jskit.connectors.n8n.apiKeyReferenceLabel`
- `jskit.connectors.n8n.description`
- `jskit.connectors.n8n.discoverOauthSettingsExactMcp`
- `jskit.connectors.n8n.fields.serverUrl.hint`
- `jskit.connectors.n8n.fields.serverUrl.label`
- `jskit.connectors.n8n.oauthDiscoveryFailedCheckMcp`
- `jskit.connectors.n8n.oauthDiscoveryInterrupted`
- `jskit.connectors.n8n.selectPermissionsAdvertisedMcpServer`
- `jskit.connectors.notion.fields.connectionType.hint`
- `jskit.connectors.notion.fields.connectionType.items.mcp.title`
- `jskit.connectors.notion.fields.connectionType.items.rest.title`
- `jskit.connectors.notion.fields.connectionType.label`
- `jskit.connectors.notion.scopes.default.label`
- `jskit.connectors.notionInternal.description`
- `jskit.connectors.oura.description`
- `jskit.connectors.oura.scopes.daily.label`
- `jskit.connectors.oura.scopes.email.label`
- `jskit.connectors.oura.scopes.heartrate.label`
- `jskit.connectors.oura.scopes.personal.label`
- `jskit.connectors.oura.startNotAfterEnd`
- `jskit.connectors.paddle.assistantActions.apiRead.label`
- `jskit.connectors.paddle.assistantActions.apiWrite.label`
- `jskit.connectors.paddle.assistantActions.enable.label`
- `jskit.connectors.paddle.assistantActions.goLiveCheck.label`
- `jskit.connectors.paddle.assistantActions.pricesCreate.label`
- `jskit.connectors.paddle.assistantActions.productsBatchCreate.label`
- `jskit.connectors.paddle.assistantActions.productsCreate.label`
- `jskit.connectors.paddle.assistantActions.providerRecommend.label`
- `jskit.connectors.paddle.assistantActions.webhooksUpdate.label`
- `jskit.connectors.paddle.chooseLeastNotificationSettingChange`
- `jskit.connectors.paddle.description`
- `jskit.connectors.paddle.fields.environment.hint`
- `jskit.connectors.paddle.fields.environment.items.live.title`
- `jskit.connectors.paddle.fields.environment.items.sandbox.title`
- `jskit.connectors.paddle.fields.environment.label`
- `jskit.connectors.perplexity.description`
- `jskit.connectors.pipedrive.companyAddressChangedConnectAccount`
- `jskit.connectors.pipedrive.fields.companyDomain.hint`
- `jskit.connectors.pipedrive.fields.companyDomain.label`
- `jskit.connectors.pipedrive.returnedInvalidCompanyApiAddress`
- `jskit.connectors.pipedrive.setCompanyDomainApiToken`
- `jskit.connectors.pipedrive.supplyChangedFieldsNewLead`
- `jskit.connectors.pipedriveToken.description`
- `jskit.connectors.polar.description`
- `jskit.connectors.polar.fields.environment.hint`
- `jskit.connectors.polar.fields.environment.items.production.title`
- `jskit.connectors.polar.fields.environment.items.sandbox.title`
- `jskit.connectors.polar.fields.environment.label`
- `jskit.connectors.posthog.apiKeyReferenceHint`
- `jskit.connectors.posthog.apiKeyReferenceLabel`
- `jskit.connectors.posthog.couldNotEvaluateAllRequested`
- `jskit.connectors.posthog.description`
- `jskit.connectors.posthog.featureFlagQuotaReached`
- `jskit.connectors.posthog.fields.projectId.hint`
- `jskit.connectors.posthog.fields.projectId.label`
- `jskit.connectors.posthog.fields.region.hint`
- `jskit.connectors.posthog.fields.region.items.eu.title`
- `jskit.connectors.posthog.fields.region.items.us.title`
- `jskit.connectors.posthog.fields.region.label`
- `jskit.connectors.posthog.usePublicProjectTokenStarting`
- `jskit.connectors.posthog.verificationFields.distinctId.hint`
- `jskit.connectors.posthog.verificationFields.distinctId.label`
- `jskit.connectors.prestashop.apiKeyReferenceHint`
- `jskit.connectors.prestashop.apiKeyReferenceLabel`
- `jskit.connectors.prestashop.description`
- `jskit.connectors.prestashop.fields.siteUrl.hint`
- `jskit.connectors.prestashop.fields.siteUrl.label`
- `jskit.connectors.replicate.description`
- `jskit.connectors.resend.description`
- `jskit.connectors.salesforce.describedDifferentObject`
- `jskit.connectors.salesforce.description`
- `jskit.connectors.salesforce.fields.accountUrl.hint`
- `jskit.connectors.salesforce.fields.accountUrl.label`
- `jskit.connectors.salesforce.fields.environment.hint`
- `jskit.connectors.salesforce.fields.environment.items.production.title`
- `jskit.connectors.salesforce.fields.environment.items.sandbox.title`
- `jskit.connectors.salesforce.fields.environment.label`
- `jskit.connectors.salesforce.organisationApiRequestLimitReached`
- `jskit.connectors.salesforce.permissionsHint`
- `jskit.connectors.salesforce.rejectedQueryObjectCheckApi`
- `jskit.connectors.salesforce.returnedInvalidGrantDifferentOrganisation`
- `jskit.connectors.salesforce.scopes.api.label`
- `jskit.connectors.salesforce.scopes.refreshToken.label`
- `jskit.connectors.salesforce.startQueryAgainResultCursor`
- `jskit.connectors.sanity.apiKeyReferenceHint`
- `jskit.connectors.sanity.apiKeyReferenceLabel`
- `jskit.connectors.sanity.description`
- `jskit.connectors.sanity.scopes.global.label`
- `jskit.connectors.semrush.apiAccessDisabledAccount`
- `jskit.connectors.semrush.apiCapacityExhaustedCheckAccount`
- `jskit.connectors.semrush.apiKeyReferenceHint`
- `jskit.connectors.semrush.apiKeyReferenceLabel`
- `jskit.connectors.semrush.checkV3ApiDatabaseReport`
- `jskit.connectors.semrush.checkV3ApiUnitsReport`
- `jskit.connectors.semrush.chooseMonth201201Through`
- `jskit.connectors.semrush.configureSeparateV3ApiKey`
- `jskit.connectors.semrush.configureSeparateV3ApiKeyReferenceDomainReports`
- `jskit.connectors.semrush.configureV3KeyCampaignDiscovery`
- `jskit.connectors.semrush.configureV3KeyPositionTracking`
- `jskit.connectors.semrush.couldNotCompleteRequest`
- `jskit.connectors.semrush.couldNotReturnV3Report`
- `jskit.connectors.semrush.description`
- `jskit.connectors.semrush.fields.v3ApiKeyRef.environmentCredential.label`
- `jskit.connectors.semrush.fields.v3ApiKeyRef.hint`
- `jskit.connectors.semrush.fields.v3ApiKeyRef.label`
- `jskit.connectors.semrush.projectNotFoundNotAccessible`
- `jskit.connectors.semrush.provideV3ApiKeyThrough`
- `jskit.connectors.semrush.provideValidV3ApiKey`
- `jskit.connectors.semrush.rejectedV3ReportCheckInputs`
- `jskit.connectors.semrush.replaceSeparateV3KeyEnv`
- `jskit.connectors.semrush.replaceV4KeyConnectAgain`
- `jskit.connectors.semrush.requestedPageExceedsProviderResult`
- `jskit.connectors.semrush.returnedIncompleteCsv`
- `jskit.connectors.semrush.returnedInvalidTrackingJson`
- `jskit.connectors.semrush.returnedMalformedCsv`
- `jskit.connectors.semrush.returnedOversizedV3Report`
- `jskit.connectors.semrush.returnedUnexpectedV3ReportColumns`
- `jskit.connectors.semrush.trackingStartDateMustNot`
- `jskit.connectors.semrush.useV4ApiKeyWithout`
- `jskit.connectors.sentry.description`
- `jskit.connectors.sentry.fields.organizationSlug.hint`
- `jskit.connectors.sentry.fields.organizationSlug.label`
- `jskit.connectors.sentry.fields.projectSlug.hint`
- `jskit.connectors.sentry.fields.projectSlug.label`
- `jskit.connectors.sentry.scopes.eventWrite.label`
- `jskit.connectors.sentry.scopes.orgRead.label`
- `jskit.connectors.sentry.scopes.projectWrite.label`
- `jskit.connectors.sentry.scopes.teamWrite.label`
- `jskit.connectors.sevdesk.apiKeyReferenceLabel`
- `jskit.connectors.sevdesk.description`
- `jskit.connectors.shared.apiKeyFormat`
- `jskit.connectors.shared.differentRecord`
- `jskit.connectors.shared.invalidCallback`
- `jskit.connectors.shared.invalidPermissionGrant`
- `jskit.connectors.shared.invalidResponse`
- `jskit.connectors.shared.invalidTokenGrant`
- `jskit.connectors.shared.invalidTokenResponse`
- `jskit.connectors.shared.invalidWebhookSignature`
- `jskit.connectors.shared.operationDenied`
- `jskit.connectors.shared.reconnectAccount`
- `jskit.connectors.shared.requestLimitReached`
- `jskit.connectors.shared.resourceUnavailable`
- `jskit.connectors.shared.supplyCanonicalBase64NonemptyFile`
- `jskit.connectors.shared.supplyLeastChange`
- `jskit.connectors.shared.tooManyRecords`
- `jskit.connectors.shared.unexpectedPage`
- `jskit.connectors.shared.unexpectedResponse`
- `jskit.connectors.shopify.apiKeyReferenceHint`
- `jskit.connectors.shopify.apiKeyReferenceLabel`
- `jskit.connectors.shopify.assistantActions.claim.label`
- `jskit.connectors.shopify.assistantActions.connect.label`
- `jskit.connectors.shopify.assistantActions.discountCodesCreate.label`
- `jskit.connectors.shopify.assistantActions.discountCodesDelete.label`
- `jskit.connectors.shopify.assistantActions.discountCodesUpdate.label`
- `jskit.connectors.shopify.assistantActions.enable.label`
- `jskit.connectors.shopify.assistantActions.priceRulesCreate.label`
- `jskit.connectors.shopify.assistantActions.priceRulesDelete.label`
- `jskit.connectors.shopify.assistantActions.priceRulesUpdate.label`
- `jskit.connectors.shopify.assistantActions.productsCreate.label`
- `jskit.connectors.shopify.assistantActions.productsDelete.label`
- `jskit.connectors.shopify.assistantActions.productsList.label`
- `jskit.connectors.shopify.assistantActions.productsUpdate.label`
- `jskit.connectors.shopify.assistantActions.variantsCreate.label`
- `jskit.connectors.shopify.assistantActions.variantsDelete.label`
- `jskit.connectors.shopify.assistantActions.variantsUpdate.label`
- `jskit.connectors.shopify.authenticationHint`
- `jskit.connectors.shopify.authenticationLabels.apiKey`
- `jskit.connectors.shopify.authenticationLabels.oauth2`
- `jskit.connectors.shopify.description`
- `jskit.connectors.shopify.fields.shopDomain.hint`
- `jskit.connectors.shopify.fields.shopDomain.label`
- `jskit.connectors.shopify.permissionsHint`
- `jskit.connectors.shopify.rejectedProductChangeCheckProduct`
- `jskit.connectors.shopify.returnedMoreProductsRequested`
- `jskit.connectors.shopify.scopes.readProducts.label`
- `jskit.connectors.shopify.scopes.writeProducts.label`
- `jskit.connectors.shopify.selectLeastProductDetailUpdate`
- `jskit.connectors.slack.checkClientRegistrationCallback`
- `jskit.connectors.slack.couldNotAuthorizeRequest`
- `jskit.connectors.slack.description`
- `jskit.connectors.slack.fields.actor.hint`
- `jskit.connectors.slack.fields.actor.items.bot.title`
- `jskit.connectors.slack.fields.actor.items.user.title`
- `jskit.connectors.slack.fields.actor.label`
- `jskit.connectors.slack.fields.signingSecretRef.hint`
- `jskit.connectors.slack.fields.signingSecretRef.label`
- `jskit.connectors.slack.requestFailedTryAgain`
- `jskit.connectors.slack.returnedTokenWrongIdentityInvalid`
- `jskit.connectors.slack.scopes.bookmarksRead.label`
- `jskit.connectors.slack.scopes.bookmarksWrite.label`
- `jskit.connectors.slack.scopes.callsRead.label`
- `jskit.connectors.slack.scopes.callsWrite.label`
- `jskit.connectors.slack.scopes.canvasesRead.label`
- `jskit.connectors.slack.scopes.canvasesWrite.label`
- `jskit.connectors.slack.scopes.channelsHistory.label`
- `jskit.connectors.slack.scopes.channelsJoin.label`
- `jskit.connectors.slack.scopes.channelsManage.label`
- `jskit.connectors.slack.scopes.channelsRead.label`
- `jskit.connectors.slack.scopes.channelsWrite.label`
- `jskit.connectors.slack.scopes.channelsWriteInvites.label`
- `jskit.connectors.slack.scopes.channelsWriteTopic.label`
- `jskit.connectors.slack.scopes.chatWrite.label`
- `jskit.connectors.slack.scopes.chatWriteCustomize.label`
- `jskit.connectors.slack.scopes.chatWritePublic.label`
- `jskit.connectors.slack.scopes.dndRead.label`
- `jskit.connectors.slack.scopes.dndWrite.label`
- `jskit.connectors.slack.scopes.emojiRead.label`
- `jskit.connectors.slack.scopes.filesRead.label`
- `jskit.connectors.slack.scopes.filesWrite.label`
- `jskit.connectors.slack.scopes.groupsHistory.label`
- `jskit.connectors.slack.scopes.groupsRead.label`
- `jskit.connectors.slack.scopes.groupsWrite.label`
- `jskit.connectors.slack.scopes.groupsWriteInvites.label`
- `jskit.connectors.slack.scopes.groupsWriteTopic.label`
- `jskit.connectors.slack.scopes.imHistory.label`
- `jskit.connectors.slack.scopes.imRead.label`
- `jskit.connectors.slack.scopes.imWrite.label`
- `jskit.connectors.slack.scopes.imWriteTopic.label`
- `jskit.connectors.slack.scopes.listsRead.label`
- `jskit.connectors.slack.scopes.listsWrite.label`
- `jskit.connectors.slack.scopes.metadataMessageRead.label`
- `jskit.connectors.slack.scopes.mpimHistory.label`
- `jskit.connectors.slack.scopes.mpimRead.label`
- `jskit.connectors.slack.scopes.mpimWrite.label`
- `jskit.connectors.slack.scopes.mpimWriteTopic.label`
- `jskit.connectors.slack.scopes.pinsRead.label`
- `jskit.connectors.slack.scopes.pinsWrite.label`
- `jskit.connectors.slack.scopes.reactionsRead.label`
- `jskit.connectors.slack.scopes.reactionsWrite.label`
- `jskit.connectors.slack.scopes.remindersRead.label`
- `jskit.connectors.slack.scopes.remindersWrite.label`
- `jskit.connectors.slack.scopes.searchReadFiles.label`
- `jskit.connectors.slack.scopes.searchReadIm.label`
- `jskit.connectors.slack.scopes.searchReadMpim.label`
- `jskit.connectors.slack.scopes.searchReadPrivate.label`
- `jskit.connectors.slack.scopes.searchReadPublic.label`
- `jskit.connectors.slack.scopes.searchReadUsers.label`
- `jskit.connectors.slack.scopes.teamRead.label`
- `jskit.connectors.slack.scopes.usergroupsRead.label`
- `jskit.connectors.slack.scopes.usergroupsWrite.label`
- `jskit.connectors.slack.scopes.usersProfileRead.label`
- `jskit.connectors.slack.scopes.usersProfileWrite.label`
- `jskit.connectors.slack.scopes.usersRead.label`
- `jskit.connectors.slack.scopes.usersReadEmail.label`
- `jskit.connectors.slack.scopes.usersWrite.label`
- `jskit.connectors.snowflake.description`
- `jskit.connectors.snowflake.fields.accountUrl.hint`
- `jskit.connectors.snowflake.fields.accountUrl.label`
- `jskit.connectors.snowflake.fields.database.hint`
- `jskit.connectors.snowflake.fields.database.label`
- `jskit.connectors.snowflake.fields.role.hint`
- `jskit.connectors.snowflake.fields.role.label`
- `jskit.connectors.snowflake.fields.schema.hint`
- `jskit.connectors.snowflake.fields.schema.label`
- `jskit.connectors.snowflake.fields.warehouse.hint`
- `jskit.connectors.snowflake.fields.warehouse.label`
- `jskit.connectors.snowflake.permissionsHint`
- `jskit.connectors.snowflake.rejectedStatementInspectQueryHistory`
- `jskit.connectors.snowflake.responseExceeds16MibReduce`
- `jskit.connectors.snowflake.returnedInvalidStatementResponse`
- `jskit.connectors.snowflake.returnedUnexpectedDatabasePage`
- `jskit.connectors.snowflake.scopes.refreshToken.label`
- `jskit.connectors.snowflake.scopes.refreshTokenOptional.label`
- `jskit.connectors.snowflake.scopes.role.label`
- `jskit.connectors.storyblok.description`
- `jskit.connectors.storyblok.fields.region.hint`
- `jskit.connectors.storyblok.fields.region.items.ap.title`
- `jskit.connectors.storyblok.fields.region.items.ca.title`
- `jskit.connectors.storyblok.fields.region.items.cn.title`
- `jskit.connectors.storyblok.fields.region.items.eu.title`
- `jskit.connectors.storyblok.fields.region.items.us.title`
- `jskit.connectors.storyblok.fields.region.label`
- `jskit.connectors.stripe.description`
- `jskit.connectors.supabase.description`
- `jskit.connectors.tally.chooseNameStatusBlockChange`
- `jskit.connectors.tally.description`
- `jskit.connectors.telegram.apiKeyReferenceLabel`
- `jskit.connectors.telegram.configureBotTokenReferencedEnvironment`
- `jskit.connectors.telegram.description`
- `jskit.connectors.tiktok.clientIdHint`
- `jskit.connectors.tiktok.clientIdLabel`
- `jskit.connectors.tiktok.connectBasicProfilePermission`
- `jskit.connectors.tiktok.connectPermissionRequiredOperation`
- `jskit.connectors.tiktok.couldNotAuthorizeConnection`
- `jskit.connectors.tiktok.couldNotCompleteRequest`
- `jskit.connectors.tiktok.description`
- `jskit.connectors.tiktok.permissionsHint`
- `jskit.connectors.tiktok.returnedDuplicatePermissions`
- `jskit.connectors.tiktok.returnedTooManyVideos`
- `jskit.connectors.tiktok.scopes.userInfoBasic.label`
- `jskit.connectors.tiktok.scopes.userInfoProfile.label`
- `jskit.connectors.tiktok.scopes.userInfoStats.label`
- `jskit.connectors.tiktok.scopes.videoList.label`
- `jskit.connectors.twilio.apiKeyReferenceLabel`
- `jskit.connectors.twilio.chooseSenderNumberMessagingService`
- `jskit.connectors.twilio.description`
- `jskit.connectors.twilio.fields.accountSid.hint`
- `jskit.connectors.twilio.fields.accountSid.label`
- `jskit.connectors.twilio.fields.accountSid.placeholder`
- `jskit.connectors.twilio.fields.apiKeySid.hint`
- `jskit.connectors.twilio.fields.apiKeySid.label`
- `jskit.connectors.twilio.fields.apiKeySid.placeholder`
- `jskit.connectors.twilio.fields.authTokenRef.hint`
- `jskit.connectors.twilio.fields.authTokenRef.label`
- `jskit.connectors.twilio.fields.region.hint`
- `jskit.connectors.twilio.fields.region.items.au1.title`
- `jskit.connectors.twilio.fields.region.items.ie1.title`
- `jskit.connectors.twilio.fields.region.items.us1.title`
- `jskit.connectors.twilio.fields.region.label`
- `jskit.connectors.twilio.supplyEitherCallControlUrl`
- `jskit.connectors.twitch.connectAgainPermissionEvent`
- `jskit.connectors.twitch.connectAgainPermissionNeededOperation`
- `jskit.connectors.twitch.description`
- `jskit.connectors.twitch.enablingVacationRequiresTimezoneEnd`
- `jskit.connectors.twitch.operationInvalidDestination`
- `jskit.connectors.twitch.returnedInvalidUnexpectedEventsubMessage`
- `jskit.connectors.twitch.returnedInvalidUserTokenValidation`
- `jskit.connectors.twitch.returnedProfileDifferentUser`
- `jskit.connectors.twitch.rewardLimitAmountRequired`
- `jskit.connectors.twitch.scopes.analyticsReadExtensions.label`
- `jskit.connectors.twitch.scopes.analyticsReadGames.label`
- `jskit.connectors.twitch.scopes.bitsRead.label`
- `jskit.connectors.twitch.scopes.channelManageBroadcast.label`
- `jskit.connectors.twitch.scopes.channelManagePolls.label`
- `jskit.connectors.twitch.scopes.channelManagePredictions.label`
- `jskit.connectors.twitch.scopes.channelManageRedemptions.label`
- `jskit.connectors.twitch.scopes.channelManageSchedule.label`
- `jskit.connectors.twitch.scopes.channelReadEditors.label`
- `jskit.connectors.twitch.scopes.channelReadHypeTrain.label`
- `jskit.connectors.twitch.scopes.channelReadPolls.label`
- `jskit.connectors.twitch.scopes.channelReadPredictions.label`
- `jskit.connectors.twitch.scopes.channelReadRedemptions.label`
- `jskit.connectors.twitch.scopes.channelReadSubscriptions.label`
- `jskit.connectors.twitch.scopes.channelReadVips.label`
- `jskit.connectors.twitch.scopes.clipsEdit.label`
- `jskit.connectors.twitch.scopes.moderationRead.label`
- `jskit.connectors.twitch.scopes.moderatorReadChatters.label`
- `jskit.connectors.twitch.scopes.moderatorReadFollowers.label`
- `jskit.connectors.twitch.scopes.userReadEmail.label`
- `jskit.connectors.twitch.scopes.userReadFollows.label`
- `jskit.connectors.twitch.scopes.userReadSubscriptions.label`
- `jskit.connectors.twitch.scopes.userWriteChat.label`
- `jskit.connectors.twitch.supplyBothReportDatesEnd`
- `jskit.connectors.twitch.supplyLeastBroadcastChange`
- `jskit.connectors.twitch.supplyLeastRewardChange`
- `jskit.connectors.twitch.supplyLeastScheduleChange`
- `jskit.connectors.twitch.supplyWinningOutcomeResolvingPrediction`
- `jskit.connectors.twitch.tokenBelongsDifferentApplication`
- `jskit.connectors.twitch.tokenRequestDenied`
- `jskit.connectors.wave.accountChangedReloadApplyingEdit`
- `jskit.connectors.wave.accountingRecordNotAvailableSelected`
- `jskit.connectors.wave.approveDocumentCheckEmailEligibility`
- `jskit.connectors.wave.chooseAccountingFieldsUpdate`
- `jskit.connectors.wave.chooseLeastCustomerFieldUpdate`
- `jskit.connectors.wave.chooseLeastDocumentFieldUpdate`
- `jskit.connectors.wave.chooseLeastProductFieldUpdate`
- `jskit.connectors.wave.couldNotCompleteQuery`
- `jskit.connectors.wave.customerNotAvailable`
- `jskit.connectors.wave.customerNotAvailableCheckAccess`
- `jskit.connectors.wave.deniedTokenAccessCheckBusiness`
- `jskit.connectors.wave.description`
- `jskit.connectors.wave.documentNotAvailableSelectedBusiness`
- `jskit.connectors.wave.productAccountTaxNotAvailable`
- `jskit.connectors.wave.rejectedAccountingChangeCheckValues`
- `jskit.connectors.wave.rejectedCustomerDetailsCheckSelected`
- `jskit.connectors.wave.rejectedDocumentOperationCheckDetails`
- `jskit.connectors.wave.rejectedProductDetailsCheckAccounts`
- `jskit.connectors.wave.rejectedTransactionReviewBalanceAccounts`
- `jskit.connectors.wave.returnedCustomerUnexpectedBusinessCheck`
- `jskit.connectors.wave.returnedEstimateAnotherBusiness`
- `jskit.connectors.wave.returnedUnexpectedAccountingRecord`
- `jskit.connectors.wave.returnedUnexpectedAccountingRecordCheck`
- `jskit.connectors.wave.returnedUnexpectedBusiness`
- `jskit.connectors.wave.returnedUnexpectedCustomerCheckOutcome`
- `jskit.connectors.wave.returnedUnexpectedDocumentCheckOutcome`
- `jskit.connectors.wave.returnedUnexpectedEstimate`
- `jskit.connectors.wave.returnedUnexpectedInvoice`
- `jskit.connectors.wave.returnedUnexpectedProductCheckOutcome`
- `jskit.connectors.wave.scopes.account.label`
- `jskit.connectors.wave.scopes.accountRead.label`
- `jskit.connectors.wave.scopes.accountWrite.label`
- `jskit.connectors.wave.scopes.business.label`
- `jskit.connectors.wave.scopes.businessRead.label`
- `jskit.connectors.wave.scopes.businessWrite.label`
- `jskit.connectors.wave.scopes.checkout.label`
- `jskit.connectors.wave.scopes.checkoutRead.label`
- `jskit.connectors.wave.scopes.customer.label`
- `jskit.connectors.wave.scopes.customerRead.label`
- `jskit.connectors.wave.scopes.customerWrite.label`
- `jskit.connectors.wave.scopes.estimate.label`
- `jskit.connectors.wave.scopes.estimateRead.label`
- `jskit.connectors.wave.scopes.estimateSend.label`
- `jskit.connectors.wave.scopes.estimateWrite.label`
- `jskit.connectors.wave.scopes.invoice.label`
- `jskit.connectors.wave.scopes.invoiceRead.label`
- `jskit.connectors.wave.scopes.invoiceSend.label`
- `jskit.connectors.wave.scopes.invoiceWrite.label`
- `jskit.connectors.wave.scopes.product.label`
- `jskit.connectors.wave.scopes.productRead.label`
- `jskit.connectors.wave.scopes.productWrite.label`
- `jskit.connectors.wave.scopes.salesTax.label`
- `jskit.connectors.wave.scopes.salesTaxRead.label`
- `jskit.connectors.wave.scopes.salesTaxWrite.label`
- `jskit.connectors.wave.scopes.transaction.label`
- `jskit.connectors.wave.scopes.transactionWrite.label`
- `jskit.connectors.wave.scopes.user.label`
- `jskit.connectors.wave.scopes.userRead.label`
- `jskit.connectors.wave.scopes.vendor.label`
- `jskit.connectors.wave.scopes.vendorRead.label`
- `jskit.connectors.wave.scopes.vendorWrite.label`
- `jskit.connectors.wave.transactionAccountCustomerTaxNot`
- `jskit.connectors.wave.useMost100DistinctRelated`
- `jskit.connectors.wix.appointmentSupplyServiceScheduleIds`
- `jskit.connectors.wix.businessScheduleLimits`
- `jskit.connectors.wix.chooseBusinessLocationId`
- `jskit.connectors.wix.chooseServiceFieldUpdate`
- `jskit.connectors.wix.chooseServiceTimeZoneIncreasing`
- `jskit.connectors.wix.chooseValidSiteId`
- `jskit.connectors.wix.classCourseSessionDurationsBelong`
- `jskit.connectors.wix.classSupplySelectedEventidSlot`
- `jskit.connectors.wix.configureSiteIdFirst`
- `jskit.connectors.wix.depositRequiresAmountOnlinePayment`
- `jskit.connectors.wix.describeCustomPaymentUp50`
- `jskit.connectors.wix.description`
- `jskit.connectors.wix.didNotReturnUpdatedFulfillment`
- `jskit.connectors.wix.doNotSendGeneratedService`
- `jskit.connectors.wix.enableParticipantNotificationSendCancellation`
- `jskit.connectors.wix.enableParticipantNotificationSupplyingMessage`
- `jskit.connectors.wix.fields.accountId.hint`
- `jskit.connectors.wix.fields.accountId.label`
- `jskit.connectors.wix.fields.selectableSiteIds.hint`
- `jskit.connectors.wix.fields.selectableSiteIds.label`
- `jskit.connectors.wix.fields.selectableSiteIds.placeholder`
- `jskit.connectors.wix.fields.siteId.hint`
- `jskit.connectors.wix.fields.siteId.label`
- `jskit.connectors.wix.manualApprovalCannotUsePricing`
- `jskit.connectors.wix.onlineDepositPaymentsRequireFixed`
- `jskit.connectors.wix.provideAppointmentSessionDurationsMinutes`
- `jskit.connectors.wix.provideContactDetailsCreationRequires`
- `jskit.connectors.wix.provideDestinationMovingFutureSessions`
- `jskit.connectors.wix.provideExplicitOnlineBookingSettings`
- `jskit.connectors.wix.provideLocationAddress`
- `jskit.connectors.wix.providePositiveDecimalPriceString`
- `jskit.connectors.wix.provideProductNameVisibilityBase`
- `jskit.connectors.wix.provideProductNameVisibilityChange`
- `jskit.connectors.wix.provideSelectedServiceSettingsInstead`
- `jskit.connectors.wix.provideServiceTypeNameUp`
- `jskit.connectors.wix.returnedAvailabilityDifferentServiceTime`
- `jskit.connectors.wix.returnedClassSlotDifferentService`
- `jskit.connectors.wix.returnedDifferentBookingCheckOperation`
- `jskit.connectors.wix.returnedDifferentBookingServiceCheck`
- `jskit.connectors.wix.returnedDifferentBusinessLocation`
- `jskit.connectors.wix.returnedDifferentCmsCollection`
- `jskit.connectors.wix.returnedDifferentCmsItemCollection`
- `jskit.connectors.wix.returnedDifferentContactCheckOperation`
- `jskit.connectors.wix.returnedDifferentEventSlotTime`
- `jskit.connectors.wix.returnedDifferentFormSummary`
- `jskit.connectors.wix.returnedDifferentOrder`
- `jskit.connectors.wix.returnedDifferentProduct`
- `jskit.connectors.wix.returnedFulfillmentsDifferentOrder`
- `jskit.connectors.wix.returnedItemsDifferentCmsCollection`
- `jskit.connectors.wix.returnedUnexpectedBookingRequestedId`
- `jskit.connectors.wix.returnedVariantsDifferentService`
- `jskit.connectors.wix.selectDurationAddOnsSupplying`
- `jskit.connectors.wix.selectLeastStaffResourceId`
- `jskit.connectors.wix.selectPersonOnlinePaymentIncluding`
- `jskit.connectors.wix.setAppointmentCapacity1Class`
- `jskit.connectors.wix.siteNotEnabledProjectSelectable`
- `jskit.connectors.wix.supplyDetailsMatchingServiceLocation`
- `jskit.connectors.wix.supplyFulfillmentPropertiesWrite`
- `jskit.connectors.wix.supplyTrackingNumberProviderCustom`
- `jskit.connectors.wix.useAppointmentDatesResourceLocation`
- `jskit.connectors.wix.useCursorLimitNextAvailability`
- `jskit.connectors.wix.useCursorLimitNextOrder`
- `jskit.connectors.wix.useFixedVariedCustomNo`
- `jskit.connectors.wix.useMost1000ParticipantsDistinct`
- `jskit.connectors.wix.useParticipantChoicesFixedParticipant`
- `jskit.connectors.wiz.accessSourceScanDenied`
- `jskit.connectors.wiz.auth0ScanningRequiresVerifiedCompatible`
- `jskit.connectors.wiz.authenticationHint`
- `jskit.connectors.wiz.authenticationLabels.oauth2`
- `jskit.connectors.wiz.authorisedSourceDirectoryUnavailable`
- `jskit.connectors.wiz.cliCouldNotStarted`
- `jskit.connectors.wiz.clientSecretReferenceInvalid`
- `jskit.connectors.wiz.clientSecretReferenceUnavailable`
- `jskit.connectors.wiz.couldNotCompleteScanCheck`
- `jskit.connectors.wiz.description`
- `jskit.connectors.wiz.didNotProduceReadableReport`
- `jskit.connectors.wiz.fields.byPolicyHits.hint`
- `jskit.connectors.wiz.fields.byPolicyHits.items.aUDIT.title`
- `jskit.connectors.wiz.fields.byPolicyHits.items.bLOCK.title`
- `jskit.connectors.wiz.fields.byPolicyHits.items.dISABLED.title`
- `jskit.connectors.wiz.fields.byPolicyHits.label`
- `jskit.connectors.wiz.fields.policies.hint`
- `jskit.connectors.wiz.fields.policies.label`
- `jskit.connectors.wiz.fields.policies.placeholder`
- `jskit.connectors.wiz.fields.tokenUrl.hint`
- `jskit.connectors.wiz.fields.tokenUrl.items.httpsAuthAppWizIoOauthToken.title`
- `jskit.connectors.wiz.fields.tokenUrl.items.httpsAuthWizIoOauthToken.title`
- `jskit.connectors.wiz.fields.tokenUrl.label`
- `jskit.connectors.wiz.hostMustSupplyAbsoluteSource`
- `jskit.connectors.wiz.integrationNotConfigured`
- `jskit.connectors.wiz.rejectedServiceAccountCredentials`
- `jskit.connectors.wiz.returnedUnsupportedInconsistentScanReport`
- `jskit.connectors.wiz.scanCancelled`
- `jskit.connectors.wiz.scanExceededTimeLimit`
- `jskit.connectors.woocommerce.apiKeyReferenceHint`
- `jskit.connectors.woocommerce.apiKeyReferenceLabel`
- `jskit.connectors.woocommerce.categoryCannotOwnParent`
- `jskit.connectors.woocommerce.categoryDeletionPermanentRequiresForce`
- `jskit.connectors.woocommerce.chooseDifferentReassignmentUser`
- `jskit.connectors.woocommerce.chooseExplicitRefundRestockFlags`
- `jskit.connectors.woocommerce.chooseExplicitlyWhetherPermanentlyDelete`
- `jskit.connectors.woocommerce.choosePeriodCompleteAscendingDate`
- `jskit.connectors.woocommerce.description`
- `jskit.connectors.woocommerce.fields.consumerKey.hint`
- `jskit.connectors.woocommerce.fields.consumerKey.label`
- `jskit.connectors.woocommerce.fields.siteUrl.label`
- `jskit.connectors.woocommerce.invalidWebhookSignatureInputs`
- `jskit.connectors.woocommerce.percentageDiscountsCannotExceed100`
- `jskit.connectors.woocommerce.productPricesMustDecimalStrings`
- `jskit.connectors.woocommerce.resourceDoesNotSupportTrash`
- `jskit.connectors.woocommerce.restockingRequiresSelectedOrderLines`
- `jskit.connectors.woocommerce.returnedDifferentCategory`
- `jskit.connectors.woocommerce.returnedDifferentRefund`
- `jskit.connectors.woocommerce.returnedDifferentVariation`
- `jskit.connectors.woocommerce.supplyCategoryChanges`
- `jskit.connectors.woocommerce.supplyCouponChanges`
- `jskit.connectors.woocommerce.supplyCustomerChangesNonEmpty`
- `jskit.connectors.woocommerce.supplyOrderChanges`
- `jskit.connectors.woocommerce.supplyProductChanges`
- `jskit.connectors.woocommerce.supplyVariationChanges`
- `jskit.connectors.woocommerce.variationPricesMustDecimalStrings`
- `jskit.connectors.wordpress.fields.siteUrl.hint`
- `jskit.connectors.wordpressCom.description`
- `jskit.connectors.wordpressCom.scopes.batch.label`
- `jskit.connectors.wordpressCom.scopes.comments.label`
- `jskit.connectors.wordpressCom.scopes.media.label`
- `jskit.connectors.wordpressCom.scopes.posts.label`
- `jskit.connectors.wordpressCom.scopes.sites.label`
- `jskit.connectors.wordpressCom.scopes.stats.label`
- `jskit.connectors.wordpressCom.scopes.taxonomy.label`
- `jskit.connectors.wordpressCom.scopes.users.label`
- `jskit.connectors.wordpressCom.verifiedTokenBelongsDifferentApplication`
- `jskit.connectors.wordpressSelfHosted.apiKeyReferenceHint`
- `jskit.connectors.wordpressSelfHosted.apiKeyReferenceLabel`
- `jskit.connectors.wordpressSelfHosted.description`
- `jskit.connectors.wordpressSelfHosted.fields.siteUrl.label`
- `jskit.connectors.wordpressSelfHosted.fields.username.hint`
- `jskit.connectors.wordpressSelfHosted.fields.username.label`
- `jskit.connectors.workday.datesOrder`
- `jskit.connectors.workday.description`
- `jskit.connectors.workday.fields.authorizationEndpoint.hint`
- `jskit.connectors.workday.fields.authorizationEndpoint.label`
- `jskit.connectors.workday.fields.restApiEndpoint.hint`
- `jskit.connectors.workday.fields.restApiEndpoint.label`
- `jskit.connectors.workday.fields.tokenEndpoint.hint`
- `jskit.connectors.workday.fields.tokenEndpoint.label`
- `jskit.connectors.workday.permissionsHint`
- `jskit.connectors.workday.supplyReportPromptOnceJoin`
- `jskit.connectors.workday.useSmallerReportPromptRequest`
- `jskit.connectors.xTwitter.apiKeyReferenceHint`
- `jskit.connectors.xTwitter.apiKeyReferenceLabel`
- `jskit.connectors.xTwitter.checkApplicationApiCreditsBilling`
- `jskit.connectors.xTwitter.couldNotReturnCompleteRequested`
- `jskit.connectors.xTwitter.description`
- `jskit.connectors.xTwitter.passUserIdString`
- `jskit.connectors.xTwitter.resourceNotFoundNotAvailable`
- `jskit.connectors.xTwitter.useAppTokenWithoutSpaces`
- `jskit.connectors.xTwitter.verificationFields.username.hint`
- `jskit.connectors.xTwitter.verificationFields.username.label`
- `jskit.connectors.xero.attachmentResponsesLimited3Mib`
- `jskit.connectors.xero.budgetDatesOrder`
- `jskit.connectors.xero.description`
- `jskit.connectors.xero.discountRatesApplySalesInvoices`
- `jskit.connectors.xero.organisationNotConnectedAccount`
- `jskit.connectors.xero.reportDatesOrder`
- `jskit.connectors.xero.returnedDifferentOrganisation`
- `jskit.connectors.xero.returnedInvalidAttachmentResponse`
- `jskit.connectors.xero.returnedInvalidConnections`
- `jskit.connectors.xero.scopes.accountingAttachments.label`
- `jskit.connectors.xero.scopes.accountingAttachmentsRead.label`
- `jskit.connectors.xero.scopes.accountingBanktransactions.label`
- `jskit.connectors.xero.scopes.accountingBanktransactionsRead.label`
- `jskit.connectors.xero.scopes.accountingBudgetsRead.label`
- `jskit.connectors.xero.scopes.accountingContacts.label`
- `jskit.connectors.xero.scopes.accountingContactsRead.label`
- `jskit.connectors.xero.scopes.accountingInvoices.label`
- `jskit.connectors.xero.scopes.accountingInvoicesRead.label`
- `jskit.connectors.xero.scopes.accountingManualjournals.label`
- `jskit.connectors.xero.scopes.accountingManualjournalsRead.label`
- `jskit.connectors.xero.scopes.accountingPayments.label`
- `jskit.connectors.xero.scopes.accountingPaymentsRead.label`
- `jskit.connectors.xero.scopes.accountingReportsAgedRead.label`
- `jskit.connectors.xero.scopes.accountingReportsBalancesheetRead.label`
- `jskit.connectors.xero.scopes.accountingReportsBanksummaryRead.label`
- `jskit.connectors.xero.scopes.accountingReportsBudgetsummaryRead.label`
- `jskit.connectors.xero.scopes.accountingReportsExecutivesummaryRead.label`
- `jskit.connectors.xero.scopes.accountingReportsProfitandlossRead.label`
- `jskit.connectors.xero.scopes.accountingReportsTaxreportsRead.label`
- `jskit.connectors.xero.scopes.accountingReportsTrialbalanceRead.label`
- `jskit.connectors.xero.scopes.accountingSettings.label`
- `jskit.connectors.xero.scopes.accountingSettingsRead.label`
- `jskit.connectors.xero.scopes.offlineAccess.label`
- `jskit.connectors.xero.supplyBankTransactionFieldChange`
- `jskit.connectors.xero.supplyCanonicalBase64NonemptyAttachment`
- `jskit.connectors.xero.supplyContactFieldChange`
- `jskit.connectors.xero.supplyInvoiceFieldChange`
- `jskit.connectors.xero.supplyJournalFieldChange`
- `jskit.connectors.zoho.regions.au.title`
- `jskit.connectors.zoho.regions.ca.title`
- `jskit.connectors.zoho.regions.cn.title`
- `jskit.connectors.zoho.regions.eu.title`
- `jskit.connectors.zoho.regions.in.title`
- `jskit.connectors.zoho.regions.jp.title`
- `jskit.connectors.zoho.regions.sa.title`
- `jskit.connectors.zoho.regions.us.title`
- `jskit.connectors.zoho.returnedTokenDifferentDataCenter`
- `jskit.connectors.zohoBooks.chooseOrganisationIdOrganizationsList`
- `jskit.connectors.zohoBooks.configuredOrganisationNotActiveAccessible`
- `jskit.connectors.zohoBooks.description`
- `jskit.connectors.zohoBooks.fields.organizationId.hint`
- `jskit.connectors.zohoBooks.fields.organizationId.label`
- `jskit.connectors.zohoBooks.fields.region.hint`
- `jskit.connectors.zohoBooks.fields.region.label`
- `jskit.connectors.zohoBooks.integrationConfiguredDifferentOrganisation`
- `jskit.connectors.zohoBooks.resourceNotAvailable`
- `jskit.connectors.zohoBooks.returnedAmbiguousPagination`
- `jskit.connectors.zohoBooks.returnedInvalidOrganisations`
- `jskit.connectors.zohoBooks.scopes.billsAll.label`
- `jskit.connectors.zohoBooks.scopes.contactsAll.label`
- `jskit.connectors.zohoBooks.scopes.creditnotesAll.label`
- `jskit.connectors.zohoBooks.scopes.customerpaymentsAll.label`
- `jskit.connectors.zohoBooks.scopes.estimatesAll.label`
- `jskit.connectors.zohoBooks.scopes.expensesAll.label`
- `jskit.connectors.zohoBooks.scopes.invoicesAll.label`
- `jskit.connectors.zohoBooks.scopes.projectsAll.label`
- `jskit.connectors.zohoBooks.scopes.purchaseordersAll.label`
- `jskit.connectors.zohoBooks.scopes.salesordersAll.label`
- `jskit.connectors.zohoBooks.scopes.zohoBooksContactsREAD.label`
- `jskit.connectors.zohoBooks.scopes.zohoBooksInvoicesREAD.label`
- `jskit.connectors.zohoBooks.scopes.zohoBooksSettingsREAD.label`
- `jskit.connectors.zohoCrm.connectAgainPermissionsNeededOperation`
- `jskit.connectors.zohoCrm.description`
- `jskit.connectors.zohoCrm.fields.environment.hint`
- `jskit.connectors.zohoCrm.fields.environment.items.developer.title`
- `jskit.connectors.zohoCrm.fields.environment.items.production.title`
- `jskit.connectors.zohoCrm.fields.environment.items.sandbox.title`
- `jskit.connectors.zohoCrm.fields.environment.label`
- `jskit.connectors.zohoCrm.fields.region.hint`
- `jskit.connectors.zohoCrm.fields.region.label`
- `jskit.connectors.zohoCrm.resourceNotAvailable`
- `jskit.connectors.zohoCrm.scopes.zohoCRMModulesALL.label`
- `jskit.connectors.zohoCrm.scopes.zohoCRMModulesAccountsALL.label`
- `jskit.connectors.zohoCrm.scopes.zohoCRMModulesAccountsREAD.label`
- `jskit.connectors.zohoCrm.scopes.zohoCRMModulesContactsALL.label`
- `jskit.connectors.zohoCrm.scopes.zohoCRMModulesContactsREAD.label`
- `jskit.connectors.zohoCrm.scopes.zohoCRMModulesDealsALL.label`
- `jskit.connectors.zohoCrm.scopes.zohoCRMModulesDealsREAD.label`
- `jskit.connectors.zohoCrm.scopes.zohoCRMModulesLeadsALL.label`
- `jskit.connectors.zohoCrm.scopes.zohoCRMModulesLeadsREAD.label`
- `jskit.connectors.zohoCrm.scopes.zohoCRMModulesREAD.label`
- `jskit.connectors.zohoCrm.scopes.zohoCRMUsersALL.label`
- `jskit.connectors.zohoCrm.scopes.zohoCRMUsersREAD.label`
- `jskit.connectors.zohoCrm.useEitherPageNumberPage`

</details>

### Codes (373)

Error, field-error and message codes this package sends, with their English. Undotted codes kept their existing values and render from `jskit.errors.<code>`.

| Code | English |
| --- | --- |
| `connectors.ai.accessConnectionDenied` | Access to this AI connection was denied. |
| `connectors.ai.authorizedAccountApiKeyUnavailable` | The authorized AI account's API key is unavailable. |
| `connectors.ai.connectionNotConfigured` | This AI connection is not configured. |
| `connectors.ai.individualAccountsRequireUserOwned` | Individual AI accounts require a user-owned reference, not a shared environment variable. |
| `connectors.amazonRedshift.didNotReturnStatementIdentifier` | Redshift did not return a statement identifier. |
| `connectors.amazonRedshift.returnedUnexpectedStatement` | Redshift returned an unexpected statement. |
| `connectors.amazonRedshift.statementBelongsDifferentTarget` | This statement belongs to a different Redshift target. |
| `connectors.amazonRedshift.statementNoFinishedResultSet` | This statement has no finished result set. |
| `connectors.amazonRedshift.useSqlParameterNameOnce` | Use each SQL parameter name only once. |
| `connectors.apify.useFrameworkNativeClientStream` | Use the framework's native Apify client to stream records larger than 8 MiB. |
| `connectors.apolloIo.enterRecordRequiredIdentifyingFields` | Enter the record's required identifying fields or changes. |
| `connectors.asana.includeDueSettingClearingStart` | Include due_on when setting or clearing start_on. |
| `connectors.asana.startDateMustPrecedeProject` | The start date must precede the project due date, or be no later than the task due date. |
| `connectors.ashby.couldNotCompleteOperation` | Ashby could not complete the operation. |
| `connectors.ashby.supplyLeastCandidateProfileChange` | Supply at least one candidate profile change. |
| `connectors.attention.endTimeMustFollowStart` | End time must follow start time. |
| `connectors.aws.checkRegionResourceOperationSettings` | Check the AWS region, resource and operation settings. |
| `connectors.aws.deniedOperationCheckIamResource` | AWS denied this operation. Check IAM, resource and database permissions. |
| `connectors.aws.provideAccessKeyIdSecret` | Provide the AWS access key ID, secret access key and any required session token bindings. |
| `connectors.aws.regionDoesNotMatchOperation` | The AWS region does not match the operation destination. |
| `connectors.aws.renewCredentialBindingsConnectAgain` | Renew the AWS credential bindings and connect again. |
| `connectors.aws.requestFailedReturnedUnreadableResponse` | The AWS request failed or returned an unreadable response. |
| `connectors.aws.requestLimitReached` | The AWS request limit was reached. |
| `connectors.aws.resourceNotFound` | The AWS resource was not found. |
| `connectors.aws.sdkSelectedUnexpectedDestination` | The AWS SDK selected an unexpected destination. |
| `connectors.awsAthena.queryBelongsDifferentWorkgroup` | This query belongs to a different workgroup. |
| `connectors.awsAthena.returnedDifferentWorkgroup` | Athena returned a different workgroup. |
| `connectors.awsAthena.returnedUnexpectedQuery` | Athena returned an unexpected query. |
| `connectors.awsS3.returnedUnexpectedBucketPageSize` | S3 returned an unexpected bucket or page size. |
| `connectors.brevo.chooseTemplateProvideSubjectEmail` | Choose a template or provide a subject and email content. |
| `connectors.brevo.smsContentOrTemplate` | Choose SMS content or a template, not both. |
| `connectors.calendly.chooseEventOwner` | Choose the user, organization or group whose events to read. |
| `connectors.calendly.choosePositiveRangeMost31` | Choose a positive range of at most 31 days. |
| `connectors.databricks.returnedUnexpectedJobResponse` | Databricks returned an unexpected job response. |
| `connectors.dbtSemanticLayer.completedWithoutJsonResultTable` | dbt completed without a JSON result table. |
| `connectors.dbtSemanticLayer.couldNotCompleteRequestedOperation` | dbt could not complete the requested operation. Check the environment and service token permissions. |
| `connectors.dbtSemanticLayer.queryFailedInspectStatusDo` | dbt query failed. Inspect its status in dbt; do not automatically submit it again. |
| `connectors.dbtSemanticLayer.returnedInvalidJsonResultPage` | dbt returned an invalid JSON result page. |
| `connectors.dbtSemanticLayer.returnedInvalidJsonTable` | dbt returned an invalid JSON table. |
| `connectors.dbtSemanticLayer.returnedInvalidOversizedJsonResult` | dbt returned an invalid or oversized JSON result page. |
| `connectors.dbtSemanticLayer.returnedUnexpectedMetadataPage` | dbt returned an unexpected metadata page. |
| `connectors.dbtSemanticLayer.useServiceTokenWithoutSpaces` | Use a dbt service token without spaces or control characters. |
| `connectors.elevenlabs.audioSamplesMustTotalMost` | Audio samples must total at most 16 MiB. |
| `connectors.elevenlabs.didNotReturnAudio` | ElevenLabs did not return audio. |
| `connectors.elevenlabs.returnedEmptyAudio` | ElevenLabs returned empty audio. |
| `connectors.elevenlabs.useNativeStreamingAudioAbove` | Use native streaming for audio above 16 MiB. |
| `connectors.firebaseCloudMessaging.couldNotAuthorizeServiceAccount` | Google could not authorize the service account. Check the credential and project permissions. |
| `connectors.firebaseCloudMessaging.recipientNoLongerRegisteredRemove` | This Firebase recipient is no longer registered. Remove its association and wait for client registration again. |
| `connectors.firebaseCloudMessaging.rejectedMessageTargetDoNot` | Firebase rejected the message or target. Do not delete a registration unless the payload is known to be valid. |
| `connectors.firebaseCloudMessaging.returnedInvalidMessageJson` | Firebase returned invalid message JSON. |
| `connectors.firebaseCloudMessaging.returnedUnexpectedMessageReceipt` | Firebase returned an unexpected message receipt. |
| `connectors.firebaseCloudMessaging.returnedUnexpectedTokenRedirect` | Google returned an unexpected token redirect. |
| `connectors.firebaseCloudMessaging.useValidServiceAccountJson` | Use a valid Firebase service-account JSON credential for the default Google API domain. |
| `connectors.firecrawl.useReturnedNextPageUrl` | Use the returned next-page URL for this crawl. |
| `connectors.gatewayapi.invalidWebhookEvent` | Invalid GatewayAPI webhook event. |
| `connectors.gmail.supplyLabelsAddRemove` | Supply labels to add or remove. |
| `connectors.gong.endDateMustFollowStart` | The end date must follow the start date. |
| `connectors.gong.supplyCallIdsOrderedTimestamp` | Supply call IDs or an ordered timestamp range. |
| `connectors.gong.supplyIdsStringsPreserveAll` | Supply Gong IDs as strings to preserve all digits. |
| `connectors.google.batchRequestsInvalid` | Supply 1–100 native {product} request objects, one operation per object, within 1 MiB. |
| `connectors.googleAds.apiCapacityExhaustedCheckCloud` | Google Ads API capacity is exhausted. Check the Cloud project and account quotas. |
| `connectors.googleAds.checkApiAccessApprovalCloud` | Check Google Ads API access approval for the Cloud project that owns this OAuth client. |
| `connectors.googleAds.connectAgainRequiredPermission` | Connect Google Ads again with its required permission. |
| `connectors.googleAds.rejectedOperationCheckCampaignFields` | Google Ads rejected the operation. Check campaign fields, policy requirements and account permissions. |
| `connectors.googleAds.resourceUnavailable` | This Google Ads resource is unavailable. |
| `connectors.googleAdsSearch.campaignChangedInspectApproveAgain` | The campaign changed. Inspect and approve it again. |
| `connectors.googleAdsSearch.campaignExceedsBoundedSearchReview` | This campaign exceeds the bounded Search review. Manage it in Google Ads. |
| `connectors.googleAdsSearch.chooseActiveClientAccount` | Choose an active client account. |
| `connectors.googleAdsSearch.chooseActiveClientAccountMatch` | Choose an active client account and match its currency. |
| `connectors.googleAdsSearch.chooseEnabledWebsiteConversionAction` | Choose an enabled website conversion action. |
| `connectors.googleAdsSearch.chooseIntegration` | Choose a Google Ads integration. |
| `connectors.googleAdsSearch.confirmInstalledConversionTrackingBilling` | Confirm installed conversion tracking and billing/advertiser readiness before launch. |
| `connectors.googleAdsSearch.didNotReturnSelectedAccount` | Google did not return the selected account. |
| `connectors.googleAdsSearch.enterLocationNameUsingLetters` | Enter a location name using letters, numbers, spaces, dots or hyphens. |
| `connectors.googleAdsSearch.pausedCampaignCanLaunchedHere` | Only a paused campaign can be launched here. |
| `connectors.googleAdsSearch.returnedInvalidCampaignGoal` | Google returned an invalid campaign goal. |
| `connectors.googleAdsSearch.reviewNonPoliticalSearchCampaign` | Review a non-political Search campaign with an enabled custom conversion goal. |
| `connectors.googleAdsSearch.screenLaunchesSearchCampaignsManual` | This screen launches only Search campaigns with manual CPC, ads and keywords. Manage other campaigns in Google Ads. |
| `connectors.googleAdsSearch.searchPlanChangedReviewAgain` | The Search plan changed. Review it again before creation. |
| `connectors.googleAdsSearch.selectAccessibleSearchCampaign` | Select an accessible Search campaign. |
| `connectors.googleDrive.base64Invalid` | Use standard padded base64 file data. |
| `connectors.googleDrive.metadataChangeRequired` | Supply a name, description or trashed value. |
| `connectors.googleDrive.mimeTypeInvalid` | Use a MIME type without header parameters. |
| `connectors.googleDrive.parentIdNewFilesOnly` | parentId applies to new files; moving files requires native addParents/removeParents wiring. |
| `connectors.googleDrive.uploadTooLarge` | Uploads above 5 MB require the framework's native resumable client. |
| `connectors.googleDrive.useFrameworkNativeDriveClient` | Use the framework's native Drive client for downloads or exports above 8 MiB. |
| `connectors.googleMapsPlatform.checkServerKeyBillingUsage` | Check the Google Maps server key, billing and usage cap. |
| `connectors.googleMapsPlatform.couldNotAcceptGeocodingRequest` | Google Maps could not accept this geocoding request. |
| `connectors.googleMapsPlatform.couldNotProcessRequestTry` | Google Maps could not process the request. Try again. |
| `connectors.googleMapsPlatform.deniedAccessCheckEnabledApi` | Google Maps denied access. Check the enabled API and key restrictions. |
| `connectors.googleMapsPlatform.requestQuotaReached` | The Google Maps request quota was reached. |
| `connectors.googleSearchConsole.datesOrder` | startDate must not follow endDate. |
| `connectors.googleSheets.rangesInvalid` | Supply 1–100 ranges within 1 MiB. |
| `connectors.googleSheets.valuesMatrixInvalid` | Supply a matrix of at most 10,000 cells and 1 MiB, containing strings, finite numbers, booleans or null. |
| `connectors.granola.noteUnavailable` | The Granola note is unavailable, inaccessible or still being processed. |
| `connectors.granola.readTranscriptPagesTranscriptsList` | Read the transcript in pages with transcripts.list. |
| `connectors.granola.returnedDataDoesNotMatch` | Granola returned data that does not match this request. |
| `connectors.granola.useGrnApiKeyWithout` | Use the Granola grn_ API key without whitespace or control characters. |
| `connectors.hubspot.contactIdentityRequired` | Supply email, firstname or lastname. |
| `connectors.hubspot.dealNameStageRequired` | Supply dealname and the internal dealstage ID. |
| `connectors.inngest.configureValidEventKeyReconnect` | Configure a valid Inngest Event Key and reconnect. |
| `connectors.inngest.deniedEvent` | Inngest denied this event. |
| `connectors.inngest.eventKeyBindingMissingInvalid` | The Inngest Event Key binding is missing or invalid. |
| `connectors.inngest.eventLimitReached` | Inngest's event limit was reached. |
| `connectors.klipy.rejectedOperation` | KLIPY rejected the operation. |
| `connectors.lightspeed.lowerVersionMustBelowUpper` | The lower version must be below the upper version. |
| `connectors.lightspeed.returnedInvalidTokenGrantDifferent` | Lightspeed returned an invalid token grant or a different store. |
| `connectors.lightspeed.useOrderedInventoryVersionBounds` | Use ordered inventory version bounds and a product ID when requesting variants. |
| `connectors.linkedin.connectOpenidProfilePermissions` | Connect LinkedIn with OpenID and profile permissions. |
| `connectors.linkedin.didNotConfirmPostCreation` | LinkedIn did not confirm post creation. |
| `connectors.linkedin.returnedInvalidMemberIdentity` | LinkedIn returned an invalid member identity. |
| `connectors.mapbox.configureValidTokenConnectAgain` | Configure a valid Mapbox token and connect again. |
| `connectors.mcp.registrationFailed` | {provider} client registration failed. Check the provider before creating another client. |
| `connectors.mcp.registrationInterrupted` | Registration was interrupted. Check the provider before creating another client. |
| `connectors.mcp.transportRequestedUnexpectedDestination` | The MCP transport requested an unexpected destination. |
| `connectors.microsoft.chooseDocumentFile` | Choose a {product} file. |
| `connectors.microsoft.returnedInvalidFileList` | Microsoft returned an invalid file list. |
| `connectors.microsoft.returnedInvalidFileMetadata` | Microsoft returned invalid file metadata. |
| `connectors.microsoftFabric.couldNotCompleteGraphqlDocument` | Fabric could not complete the GraphQL document. Check its schema and permissions before retrying. |
| `connectors.microsoftFabric.requiresNewSignConsent` | Microsoft requires a new sign-in or consent. |
| `connectors.microsoftOnedrive.useStandardPaddedBase64Up` | Use standard padded base64 up to 5 MB; larger files need a native upload session. |
| `connectors.microsoftOnenote.useNativeOnenoteClientPages` | Use the native OneNote client for pages above 1 MiB. |
| `connectors.microsoftOutlook.endMustFollowStart` | End must follow start. |
| `connectors.n8n.discoverOauthSettingsExactMcp` | Discover OAuth settings for this exact n8n MCP URL before connecting. |
| `connectors.n8n.oauthDiscoveryFailedCheckMcp` | n8n OAuth discovery failed. Check the MCP URL, advertised authority and supported server version. |
| `connectors.n8n.oauthDiscoveryInterrupted` | n8n OAuth discovery was interrupted. |
| `connectors.n8n.selectPermissionsAdvertisedMcpServer` | Select only permissions advertised by this n8n MCP server. |
| `connectors.oura.startNotAfterEnd` | Start must be before or equal to end. |
| `connectors.paddle.chooseLeastNotificationSettingChange` | Choose at least one notification setting to change. |
| `connectors.pipedrive.companyAddressChangedConnectAccount` | The Pipedrive company address changed. Connect this account again. |
| `connectors.pipedrive.returnedInvalidCompanyApiAddress` | Pipedrive returned an invalid company API address. |
| `connectors.pipedrive.setCompanyDomainApiToken` | Set the Pipedrive Company domain for API-token CRM operations. |
| `connectors.pipedrive.supplyChangedFieldsNewLead` | Supply changed fields; a new lead also needs a person or organization. |
| `connectors.posthog.couldNotEvaluateAllRequested` | PostHog could not evaluate all requested flags. |
| `connectors.posthog.featureFlagQuotaReached` | PostHog's feature flag quota has been reached. |
| `connectors.posthog.usePublicProjectTokenStarting` | Use the public PostHog project token starting with phc_. |
| `connectors.salesforce.describedDifferentObject` | Salesforce described a different object. |
| `connectors.salesforce.organisationApiRequestLimitReached` | The Salesforce organisation's API request limit was reached. |
| `connectors.salesforce.rejectedQueryObjectCheckApi` | Salesforce rejected the query or object. Check its API names and the user's permissions. |
| `connectors.salesforce.returnedInvalidGrantDifferentOrganisation` | Salesforce returned an invalid grant or a different organisation. |
| `connectors.salesforce.startQueryAgainResultCursor` | Start the Salesforce query again; its result cursor is no longer valid. |
| `connectors.semrush.apiAccessDisabledAccount` | Semrush API access is disabled for this account. |
| `connectors.semrush.apiCapacityExhaustedCheckAccount` | Semrush API capacity is exhausted. Check the account's subscription and available units. |
| `connectors.semrush.checkV3ApiDatabaseReport` | Check Semrush V3 API, database and report entitlement. |
| `connectors.semrush.checkV3ApiUnitsReport` | Check Semrush V3 API units and report limits. |
| `connectors.semrush.chooseMonth201201Through` | Choose a month from 2012-01 through the current month. |
| `connectors.semrush.configureSeparateV3ApiKey` | Configure the separate Semrush V3 API key reference for keyword reports. |
| `connectors.semrush.configureSeparateV3ApiKeyReferenceDomainReports` | Configure the separate Semrush V3 API key reference for domain reports. |
| `connectors.semrush.configureV3KeyCampaignDiscovery` | Configure the Semrush V3 key for campaign discovery. |
| `connectors.semrush.configureV3KeyPositionTracking` | Configure the Semrush V3 key for position tracking. |
| `connectors.semrush.couldNotCompleteRequest` | Semrush could not complete this request. |
| `connectors.semrush.couldNotReturnV3Report` | Semrush could not return the V3 report. |
| `connectors.semrush.projectNotFoundNotAccessible` | The Semrush project was not found or is not accessible. |
| `connectors.semrush.provideV3ApiKeyThrough` | Provide the Semrush V3 API key through its private Env reference. |
| `connectors.semrush.provideValidV3ApiKey` | Provide a valid Semrush V3 API key. |
| `connectors.semrush.rejectedV3ReportCheckInputs` | Semrush rejected the V3 report. Check its inputs and account access. |
| `connectors.semrush.replaceSeparateV3KeyEnv` | Replace the separate Semrush V3 key in Env. |
| `connectors.semrush.replaceV4KeyConnectAgain` | Replace the Semrush V4 key and connect again. |
| `connectors.semrush.requestedPageExceedsProviderResult` | The requested Semrush page exceeds the provider's result window. |
| `connectors.semrush.returnedIncompleteCsv` | Semrush returned incomplete CSV. |
| `connectors.semrush.returnedInvalidTrackingJson` | Semrush returned invalid tracking JSON. |
| `connectors.semrush.returnedMalformedCsv` | Semrush returned malformed CSV. |
| `connectors.semrush.returnedOversizedV3Report` | Semrush returned an oversized V3 report. |
| `connectors.semrush.returnedUnexpectedV3ReportColumns` | Semrush returned unexpected V3 report columns or rows. |
| `connectors.semrush.trackingStartDateMustNot` | The tracking start date must not follow its end date. |
| `connectors.semrush.useV4ApiKeyWithout` | Use the Semrush V4 API key without spaces or control characters. |
| `connectors.shared.apiKeyFormat` | Use the {provider} API key without spaces, control characters or colons. |
| `connectors.shared.differentRecord` | {provider} returned a different record. |
| `connectors.shared.invalidCallback` | Invalid {provider} callback. |
| `connectors.shared.invalidPermissionGrant` | {provider} returned an invalid permission grant. |
| `connectors.shared.invalidResponse` | {provider} returned an invalid response. |
| `connectors.shared.invalidTokenGrant` | {provider} returned an invalid token grant. |
| `connectors.shared.invalidTokenResponse` | {provider} returned an invalid token response. |
| `connectors.shared.invalidWebhookSignature` | Invalid {provider} webhook signature. |
| `connectors.shared.operationDenied` | {provider} denied this operation. |
| `connectors.shared.reconnectAccount` | Connect this {provider} account again. |
| `connectors.shared.requestLimitReached` | {provider}'s request limit was reached. |
| `connectors.shared.resourceUnavailable` | This {provider} resource is not available. |
| `connectors.shared.supplyCanonicalBase64NonemptyFile` | Supply canonical base64 for a nonempty file of at most 5 MiB. |
| `connectors.shared.supplyLeastChange` | Supply at least one change. |
| `connectors.shared.tooManyRecords` | {provider} returned more records than requested. |
| `connectors.shared.unexpectedPage` | {provider} returned an unexpected page. |
| `connectors.shared.unexpectedResponse` | {provider} returned an unexpected response. |
| `connectors.shopify.rejectedProductChangeCheckProduct` | Shopify rejected the product change. Check the product values and permissions before retrying. |
| `connectors.shopify.returnedMoreProductsRequested` | Shopify returned more products than requested. |
| `connectors.shopify.selectLeastProductDetailUpdate` | Select at least one product detail to update. |
| `connectors.slack.checkClientRegistrationCallback` | Check the Slack client registration and callback. |
| `connectors.slack.couldNotAuthorizeRequest` | Slack could not authorize this request. |
| `connectors.slack.requestFailedTryAgain` | The Slack request failed. Try again. |
| `connectors.slack.returnedTokenWrongIdentityInvalid` | Slack returned a token for the wrong identity or an invalid permission grant. |
| `connectors.snowflake.rejectedStatementInspectQueryHistory` | Snowflake rejected the statement. Inspect query history with the authorized role. |
| `connectors.snowflake.responseExceeds16MibReduce` | Snowflake response exceeds 16 MiB. Reduce the query result or use a native streaming client. |
| `connectors.snowflake.returnedInvalidStatementResponse` | Snowflake returned an invalid statement response. |
| `connectors.snowflake.returnedUnexpectedDatabasePage` | Snowflake returned an unexpected database page. |
| `connectors.tally.chooseNameStatusBlockChange` | Choose a name, status or block change. |
| `connectors.telegram.configureBotTokenReferencedEnvironment` | Configure a Telegram bot token in the referenced environment variable. |
| `connectors.tiktok.connectBasicProfilePermission` | Connect TikTok with basic profile permission. |
| `connectors.tiktok.connectPermissionRequiredOperation` | Connect TikTok with the permission required for this operation. |
| `connectors.tiktok.couldNotAuthorizeConnection` | TikTok could not authorize this connection. |
| `connectors.tiktok.couldNotCompleteRequest` | TikTok could not complete the request. |
| `connectors.tiktok.returnedDuplicatePermissions` | TikTok returned duplicate permissions. |
| `connectors.tiktok.returnedTooManyVideos` | TikTok returned too many videos. |
| `connectors.twilio.chooseSenderNumberMessagingService` | Choose one sender number or Messaging Service SID. |
| `connectors.twilio.supplyEitherCallControlUrl` | Supply either a call-control URL or inline TwiML. |
| `connectors.twitch.connectAgainPermissionEvent` | Connect Twitch again with permission for this event. |
| `connectors.twitch.connectAgainPermissionNeededOperation` | Connect Twitch again with the permission needed for this operation. |
| `connectors.twitch.enablingVacationRequiresTimezoneEnd` | Enabling vacation requires a timezone and an end after the start. |
| `connectors.twitch.operationInvalidDestination` | This Twitch operation has an invalid destination. |
| `connectors.twitch.returnedInvalidUnexpectedEventsubMessage` | Twitch returned an invalid or unexpected EventSub message. |
| `connectors.twitch.returnedInvalidUserTokenValidation` | Twitch returned an invalid user-token validation. |
| `connectors.twitch.returnedProfileDifferentUser` | Twitch returned a profile for a different user. |
| `connectors.twitch.rewardLimitAmountRequired` | Supply {field} when enabling this reward limit. |
| `connectors.twitch.supplyBothReportDatesEnd` | Supply both report dates, with the end on or after the start. |
| `connectors.twitch.supplyLeastBroadcastChange` | Supply at least one broadcast change. |
| `connectors.twitch.supplyLeastRewardChange` | Supply at least one reward change. |
| `connectors.twitch.supplyLeastScheduleChange` | Supply at least one schedule change. |
| `connectors.twitch.supplyWinningOutcomeResolvingPrediction` | Supply a winning outcome only when resolving the prediction. |
| `connectors.twitch.tokenBelongsDifferentApplication` | The Twitch token belongs to a different application. |
| `connectors.twitch.tokenRequestDenied` | Twitch denied the token request. |
| `connectors.wave.accountChangedReloadApplyingEdit` | The account changed. Reload it before applying your edit. |
| `connectors.wave.accountingRecordNotAvailableSelected` | This accounting record is not available in the selected business. Check read access. |
| `connectors.wave.approveDocumentCheckEmailEligibility` | Approve the document and check Wave email eligibility before sending. |
| `connectors.wave.chooseAccountingFieldsUpdate` | Choose accounting fields to update. |
| `connectors.wave.chooseLeastCustomerFieldUpdate` | Choose at least one customer field to update. |
| `connectors.wave.chooseLeastDocumentFieldUpdate` | Choose at least one document field to update. |
| `connectors.wave.chooseLeastProductFieldUpdate` | Choose at least one product field to update. |
| `connectors.wave.couldNotCompleteQuery` | Wave could not complete this query. |
| `connectors.wave.customerNotAvailable` | This customer is not available in the selected business. |
| `connectors.wave.customerNotAvailableCheckAccess` | This customer is not available in the selected business. Check read access. |
| `connectors.wave.deniedTokenAccessCheckBusiness` | Wave denied token access. Check the business subscription and permissions. |
| `connectors.wave.documentNotAvailableSelectedBusiness` | This document is not available in the selected business. Check read access. |
| `connectors.wave.productAccountTaxNotAvailable` | This product, account or tax is not available in the selected business. Check read access. |
| `connectors.wave.rejectedAccountingChangeCheckValues` | Wave rejected the accounting change. Check the values and current record. |
| `connectors.wave.rejectedCustomerDetailsCheckSelected` | Wave rejected the customer details. Check the selected business and customer fields. |
| `connectors.wave.rejectedDocumentOperationCheckDetails` | Wave rejected the document operation. Check its details and current state. |
| `connectors.wave.rejectedProductDetailsCheckAccounts` | Wave rejected the product details. Check accounts, taxes and price. |
| `connectors.wave.rejectedTransactionReviewBalanceAccounts` | Wave rejected the transaction. Review its balance, accounts and details before submitting again. |
| `connectors.wave.returnedCustomerUnexpectedBusinessCheck` | Wave returned a customer from an unexpected business. Check the outcome before retrying. |
| `connectors.wave.returnedEstimateAnotherBusiness` | Wave returned an estimate from another business. |
| `connectors.wave.returnedUnexpectedAccountingRecord` | Wave returned an unexpected accounting record. |
| `connectors.wave.returnedUnexpectedAccountingRecordCheck` | Wave returned an unexpected accounting record. Check the outcome before retrying. |
| `connectors.wave.returnedUnexpectedBusiness` | Wave returned an unexpected business. |
| `connectors.wave.returnedUnexpectedCustomerCheckOutcome` | Wave returned an unexpected customer. Check the outcome before retrying. |
| `connectors.wave.returnedUnexpectedDocumentCheckOutcome` | Wave returned an unexpected document. Check the outcome before retrying. |
| `connectors.wave.returnedUnexpectedEstimate` | Wave returned an unexpected estimate. |
| `connectors.wave.returnedUnexpectedInvoice` | Wave returned an unexpected invoice. |
| `connectors.wave.returnedUnexpectedProductCheckOutcome` | Wave returned an unexpected product. Check the outcome before retrying. |
| `connectors.wave.transactionAccountCustomerTaxNot` | A transaction account, customer or tax is not available in the selected business. Check read access. |
| `connectors.wave.useMost100DistinctRelated` | Use at most 100 distinct related records per transaction. |
| `connectors.wix.appointmentSupplyServiceScheduleIds` | For an appointment, supply its service/schedule IDs, increasing local slot dates and IANA timezone. Courses cannot be rescheduled. |
| `connectors.wix.businessScheduleLimits` | Use native businessSchedule periods and specialHourPeriod arrays with at most 100 entries each. |
| `connectors.wix.chooseBusinessLocationId` | Choose the business location ID. |
| `connectors.wix.chooseServiceFieldUpdate` | Choose a service field to update. |
| `connectors.wix.chooseServiceTimeZoneIncreasing` | Choose the service, time zone and an increasing local date range. |
| `connectors.wix.chooseValidSiteId` | Choose a valid Wix Site ID. |
| `connectors.wix.classCourseSessionDurationsBelong` | Class/course session durations belong to their sessions, not service availability constraints. |
| `connectors.wix.classSupplySelectedEventidSlot` | For a class, supply only the selected eventId in slot. |
| `connectors.wix.configureSiteIdFirst` | Configure the Wix Site ID first. |
| `connectors.wix.depositRequiresAmountOnlinePayment` | A deposit requires its amount, online payment and no in-person payment. |
| `connectors.wix.describeCustomPaymentUp50` | Describe the custom payment in up to 50 characters. |
| `connectors.wix.didNotReturnUpdatedFulfillment` | Wix did not return the updated fulfillment. Inspect the order before retrying. |
| `connectors.wix.doNotSendGeneratedService` | Do not send generated service identity fields or existing add-on groups when creating a service. |
| `connectors.wix.enableParticipantNotificationSendCancellation` | Enable participant notification to send a cancellation message. |
| `connectors.wix.enableParticipantNotificationSupplyingMessage` | Enable participant notification before supplying a message. |
| `connectors.wix.manualApprovalCannotUsePricing` | Manual approval cannot use pricing plans; online payment requires online booking. |
| `connectors.wix.onlineDepositPaymentsRequireFixed` | Online and deposit payments require fixed or varied pricing. |
| `connectors.wix.provideAppointmentSessionDurationsMinutes` | Provide appointment session durations in minutes. |
| `connectors.wix.provideContactDetailsCreationRequires` | Provide contact details; creation requires a name, email or phone. |
| `connectors.wix.provideDestinationMovingFutureSessions` | Provide a destination only when moving future sessions. |
| `connectors.wix.provideExplicitOnlineBookingSettings` | Provide explicit online-booking settings. |
| `connectors.wix.provideLocationAddress` | Provide the location address. |
| `connectors.wix.providePositiveDecimalPriceString` | Provide a positive decimal price string and three-letter currency code. |
| `connectors.wix.provideProductNameVisibilityBase` | Provide a product name, visibility or base-price change. |
| `connectors.wix.provideProductNameVisibilityChange` | Provide a product name or visibility change. |
| `connectors.wix.provideSelectedServiceSettingsInstead` | Provide the selected service settings instead of an empty object. |
| `connectors.wix.provideServiceTypeNameUp` | Provide a service type and name of up to 400 characters. |
| `connectors.wix.returnedAvailabilityDifferentServiceTime` | Wix returned availability for a different service, time or time zone. |
| `connectors.wix.returnedClassSlotDifferentService` | Wix returned a class slot for a different service. |
| `connectors.wix.returnedDifferentBookingCheckOperation` | Wix returned a different booking. Check the operation outcome before retrying. |
| `connectors.wix.returnedDifferentBookingServiceCheck` | Wix returned a different booking service. Check the outcome before retrying. |
| `connectors.wix.returnedDifferentBusinessLocation` | Wix returned a different business location. |
| `connectors.wix.returnedDifferentCmsCollection` | Wix returned a different CMS collection. |
| `connectors.wix.returnedDifferentCmsItemCollection` | Wix returned a different CMS item or collection. Check write outcomes before retrying. |
| `connectors.wix.returnedDifferentContactCheckOperation` | Wix returned a different contact. Check the operation outcome before retrying. |
| `connectors.wix.returnedDifferentEventSlotTime` | Wix returned a different event slot or time zone. |
| `connectors.wix.returnedDifferentFormSummary` | Wix returned a different form summary. |
| `connectors.wix.returnedDifferentOrder` | Wix returned a different order. |
| `connectors.wix.returnedDifferentProduct` | Wix returned a different product. |
| `connectors.wix.returnedFulfillmentsDifferentOrder` | Wix returned fulfillments for a different order. |
| `connectors.wix.returnedItemsDifferentCmsCollection` | Wix returned items from a different CMS collection. |
| `connectors.wix.returnedUnexpectedBookingRequestedId` | Wix returned an unexpected booking for the requested ID. |
| `connectors.wix.returnedVariantsDifferentService` | Wix returned variants for a different service. |
| `connectors.wix.selectDurationAddOnsSupplying` | Select a duration or add-ons before supplying customer choices. |
| `connectors.wix.selectLeastStaffResourceId` | Select at least one staff resource ID for the appointment service. |
| `connectors.wix.selectPersonOnlinePaymentIncluding` | Select in-person or online payment, including for a free service. |
| `connectors.wix.setAppointmentCapacity1Class` | Set appointment capacity to 1, or class/course capacity from 1 to 1000. |
| `connectors.wix.siteNotEnabledProjectSelectable` | This site is not enabled in the project's Selectable Site IDs. |
| `connectors.wix.supplyDetailsMatchingServiceLocation` | Supply the details matching each service location type. |
| `connectors.wix.supplyFulfillmentPropertiesWrite` | Supply the fulfillment properties to write. |
| `connectors.wix.supplyTrackingNumberProviderCustom` | Supply tracking number and provider; custom carriers also require a tracking URL. |
| `connectors.wix.useAppointmentDatesResourceLocation` | Use appointment dates/resource/location, a class event ID, or a course schedule ID, matching the selected service type. |
| `connectors.wix.useCursorLimitNextAvailability` | Use only cursor and limit for the next availability page. |
| `connectors.wix.useCursorLimitNextOrder` | Use only cursor and limit for the next order page. |
| `connectors.wix.useFixedVariedCustomNo` | Use FIXED, VARIED, CUSTOM or NO_FEE service payment settings. |
| `connectors.wix.useMost1000ParticipantsDistinct` | Use at most 1000 participants, distinct options per group and exactly one custom or duration value per choice. |
| `connectors.wix.useParticipantChoicesFixedParticipant` | Use participant choices or a fixed participant total, not both. |
| `connectors.wiz.accessSourceScanDenied` | Access to this source scan was denied. |
| `connectors.wiz.auth0ScanningRequiresVerifiedCompatible` | Auth0 scanning requires a verified compatible Wiz runner. |
| `connectors.wiz.authorisedSourceDirectoryUnavailable` | The authorised source directory is unavailable. |
| `connectors.wiz.cliCouldNotStarted` | The Wiz CLI could not be started. |
| `connectors.wiz.clientSecretReferenceInvalid` | The Wiz client-secret reference is invalid. |
| `connectors.wiz.clientSecretReferenceUnavailable` | The Wiz client-secret reference is unavailable. |
| `connectors.wiz.couldNotCompleteScanCheck` | Wiz could not complete the scan. Check the runner, policies and tenant access. |
| `connectors.wiz.didNotProduceReadableReport` | Wiz did not produce a readable report within the configured size limit. |
| `connectors.wiz.hostMustSupplyAbsoluteSource` | The host must supply an absolute source directory and revision. |
| `connectors.wiz.integrationNotConfigured` | This Wiz integration is not configured. |
| `connectors.wiz.rejectedServiceAccountCredentials` | Wiz rejected the service-account credentials. |
| `connectors.wiz.returnedUnsupportedInconsistentScanReport` | Wiz returned an unsupported or inconsistent scan report. |
| `connectors.wiz.scanCancelled` | The Wiz scan was cancelled. |
| `connectors.wiz.scanExceededTimeLimit` | The Wiz scan exceeded its time limit. |
| `connectors.woocommerce.categoryCannotOwnParent` | A category cannot be its own parent. |
| `connectors.woocommerce.categoryDeletionPermanentRequiresForce` | Category deletion is permanent and requires force=true. |
| `connectors.woocommerce.chooseDifferentReassignmentUser` | Choose a different reassignment user. |
| `connectors.woocommerce.chooseExplicitRefundRestockFlags` | Choose explicit refund/restock flags and decimal-string amounts. |
| `connectors.woocommerce.chooseExplicitlyWhetherPermanentlyDelete` | Choose explicitly whether to permanently delete. |
| `connectors.woocommerce.choosePeriodCompleteAscendingDate` | Choose a period or a complete ascending date range. |
| `connectors.woocommerce.invalidWebhookSignatureInputs` | Invalid WooCommerce webhook signature inputs. |
| `connectors.woocommerce.percentageDiscountsCannotExceed100` | Percentage discounts cannot exceed 100. |
| `connectors.woocommerce.productPricesMustDecimalStrings` | Product prices must be decimal strings. |
| `connectors.woocommerce.resourceDoesNotSupportTrash` | This resource does not support trash; permanent deletion requires force=true. |
| `connectors.woocommerce.restockingRequiresSelectedOrderLines` | Restocking requires selected order lines and positive quantities. |
| `connectors.woocommerce.returnedDifferentCategory` | WooCommerce returned a different category. |
| `connectors.woocommerce.returnedDifferentRefund` | WooCommerce returned a different refund. |
| `connectors.woocommerce.returnedDifferentVariation` | WooCommerce returned a different variation. |
| `connectors.woocommerce.supplyCategoryChanges` | Supply category changes. |
| `connectors.woocommerce.supplyCouponChanges` | Supply coupon changes. |
| `connectors.woocommerce.supplyCustomerChangesNonEmpty` | Supply customer changes and non-empty address objects. |
| `connectors.woocommerce.supplyOrderChanges` | Supply order changes. |
| `connectors.woocommerce.supplyProductChanges` | Supply product changes. |
| `connectors.woocommerce.supplyVariationChanges` | Supply variation changes. |
| `connectors.woocommerce.variationPricesMustDecimalStrings` | Variation prices must be decimal strings. |
| `connectors.wordpressCom.verifiedTokenBelongsDifferentApplication` | The verified token belongs to a different application. |
| `connectors.workday.datesOrder` | The start date must not follow the end date. |
| `connectors.workday.supplyReportPromptOnceJoin` | Supply each report prompt once; join multi-instance WIDs with !. |
| `connectors.workday.useSmallerReportPromptRequest` | Use a smaller report prompt request. |
| `connectors.xTwitter.checkApplicationApiCreditsBilling` | Check this X application's API credits and billing access. |
| `connectors.xTwitter.couldNotReturnCompleteRequested` | X could not return the complete requested data. |
| `connectors.xTwitter.passUserIdString` | Pass the X user ID as a string. |
| `connectors.xTwitter.resourceNotFoundNotAvailable` | The X resource was not found or is not available. |
| `connectors.xTwitter.useAppTokenWithoutSpaces` | Use the X app-only token without spaces, control characters or a Bearer prefix. |
| `connectors.xero.attachmentResponsesLimited3Mib` | Xero attachment responses are limited to 3 MiB. |
| `connectors.xero.budgetDatesOrder` | The budget start date must not follow its end date. |
| `connectors.xero.discountRatesApplySalesInvoices` | Discount rates apply only to sales invoices. |
| `connectors.xero.organisationNotConnectedAccount` | This Xero organisation is not connected to this account. |
| `connectors.xero.reportDatesOrder` | The report start date must not follow its end date. |
| `connectors.xero.returnedDifferentOrganisation` | Xero returned a different organisation. |
| `connectors.xero.returnedInvalidAttachmentResponse` | Xero returned an invalid attachment response. |
| `connectors.xero.returnedInvalidConnections` | Xero returned invalid connections. |
| `connectors.xero.supplyBankTransactionFieldChange` | Supply a bank transaction field to change. |
| `connectors.xero.supplyCanonicalBase64NonemptyAttachment` | Supply canonical base64 for a nonempty attachment of at most 3 MiB. |
| `connectors.xero.supplyContactFieldChange` | Supply a contact field to change. |
| `connectors.xero.supplyInvoiceFieldChange` | Supply an invoice field to change. |
| `connectors.xero.supplyJournalFieldChange` | Supply a journal field to change. |
| `connectors.zoho.returnedTokenDifferentDataCenter` | Zoho returned a token for a different data center or environment. |
| `connectors.zohoBooks.chooseOrganisationIdOrganizationsList` | Choose an organisation ID from organizations.list or configure one for this integration. |
| `connectors.zohoBooks.configuredOrganisationNotActiveAccessible` | The configured Books organisation is not active and accessible to this account. |
| `connectors.zohoBooks.integrationConfiguredDifferentOrganisation` | This integration is configured for a different organisation. |
| `connectors.zohoBooks.resourceNotAvailable` | This Books resource is not available. |
| `connectors.zohoBooks.returnedAmbiguousPagination` | Zoho Books returned ambiguous pagination. |
| `connectors.zohoBooks.returnedInvalidOrganisations` | Zoho Books returned invalid organisations. |
| `connectors.zohoCrm.connectAgainPermissionsNeededOperation` | Connect again with the CRM permissions needed for this operation. |
| `connectors.zohoCrm.resourceNotAvailable` | This CRM resource is not available. |
| `connectors.zohoCrm.useEitherPageNumberPage` | Use either a page number or a page token. |
