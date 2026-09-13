const ouraDefinition = Object.freeze({
  id: "oura", name: "Oura", description: "Connect an individual's Oura account to read sleep, readiness, activity, heart-rate and permitted profile data.",
  accountModes: ["per-user"], authenticationMethods: ["oauth2"],
  scopes: [
    { value: "daily", label: "Read daily sleep, activity and readiness summaries", required: true },
    { value: "heartrate", label: "Read heart-rate samples" },
    { value: "personal", label: "Read personal profile information" },
    { value: "email", label: "Read the account email address" }
  ],
  setup: {
    url: "https://support.ouraring.com/hc/en-us/articles/4415266939155-The-Oura-API",
    steps: [
      "Use dailySleep.list, sleep.list, dailyReadiness.list and dailyActivity.list with start_date/end_date, and heartRate.list with start_datetime/end_datetime including timezone. Follow next_token explicitly. LIMITATIONS: no live synchronization, health dashboard, workout/tag/session/SpO2 operations or automatic coding-chat attachment. For example, your app can show a user’s sleep/readiness and heart-rate history; it must build the chart and refresh schedule itself.",
      "For a new registration, open https://developer.ouraring.com and sign in with the Oura account that will own this application. Create an API application there. To edit an existing registration, Oura still provides My Applications at https://cloud.ouraring.com/oauth/applications. Personal access tokens are retired; use OAuth.",
      "Provide the application name and website describing your integration. Add the exact Suggested callback URL from this screen to the registration's allowed redirect URIs, including scheme and path. Your application's backend must serve that callback. The hosting URL suggested here is the starting point; update the provider and Env together if your app moves to a custom domain.",
      "Copy the assigned Client ID here. Keep env:OURA_CLIENT_SECRET and env:OURA_CALLBACK_URL as references and Save configuration. Use Set credential in Env to store the Client Secret as OURA_CLIENT_SECRET, and Set callback in Env to store the registered URL as OURA_CALLBACK_URL. Keep the actual secret out of configuration JSON and chat.",
      "Keep daily permission selected: verification reads daily sleep summaries. Select heartrate only for heart-rate samples; personal or email only if your application needs those profile fields. Each app user connects their own account and may decline individual permissions; declining daily prevents this connection from being verified. This grants Oura data access, not application login.",
      "In Vibe64, choose Prepare app user connection request to prepare the application wiring. Once implemented, each user opens the application's own account screen, connects Oura and approves access. Oura documents a ten-user limit before application approval; request review from the application's page for wider use. Gen3 and later users need an active Oura Membership for API data. If verification is forbidden, check membership and granted permissions; an empty sleep list can mean there is no synced data yet.",
      "In the application, reconnect starts consent again and disconnect removes that user's local grant; manage the application's authorization in Oura separately. The application owns stored grants and single-use refresh tokens, including after leaving Vibe64. Preserve its private connection store when moving hosts."
    ]
  }
});
export { ouraDefinition };
