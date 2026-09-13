import { test, expect } from "@playwright/test";

for (const width of [390, 820, 1440]) {
  test(`Snowflake setting changes select required scopes without restoring optional choices at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await page.goto("/");
    await page.getByRole("button", { name: "Edit Snowflake", exact: true }).click();
    const role = page.getByRole("textbox", { name: "Role", exact: true });
    const permissions = page.getByRole("button", { name: "Permissions", exact: true });
    const save = page.getByRole("button", { name: "Export configuration", exact: true });
    await save.click(); const original = JSON.parse(await page.getByTestId("export").textContent());
    await role.fill("VIBE64_READER"); await permissions.click();
    const named = page.getByRole("checkbox", { name: "Use role VIBE64_READER (required)", exact: true });
    await expect(named).toBeChecked(); await expect(named).toBeDisabled();
    const offline = page.getByRole("checkbox", { name: "Keep access between visits", exact: true });
    await offline.uncheck(); await role.fill("Inventory & stock");
    await expect(named).toHaveCount(0); await expect(offline).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Use role Inventory & stock (required)", exact: true })).toBeChecked();
    await save.click(); const namedFile = JSON.parse(await page.getByTestId("export").textContent());
    expect(namedFile.integrations.snowflake.scopes).toEqual(["session:role-encoded:Inventory%20%26%20stock"]);
    expect(namedFile.integrations.snowflake.extensions).toEqual({ keep: "account" });
    expect(namedFile.integrations.calendar).toEqual(original.integrations.calendar);
    await page.getByRole("button", { name: "Leave configuration" }).click(); await page.getByRole("button", { name: "Return to configuration" }).click();
    await expect(role).toHaveValue("Inventory & stock");
    await page.getByLabel("Lock form").check(); await expect(role).toBeDisabled(); await page.getByLabel("Lock form").uncheck();
    await role.fill(""); await save.click(); const defaults = JSON.parse(await page.getByTestId("export").textContent());
    expect(defaults.integrations.snowflake.scopes).toEqual(["refresh_token"]); expect(defaults.integrations.snowflake.settings.role).toBeUndefined();
    if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
    const requiredOffline = page.getByRole("checkbox", { name: "Keep access between visits (required)", exact: true });
    await expect(requiredOffline).toBeChecked(); await expect(requiredOffline).toBeDisabled();
    await page.getByLabel("Import configuration JSON").fill(JSON.stringify(namedFile)); await page.getByRole("button", { name: "Import configuration", exact: true }).click();
    await expect(role).toHaveValue("Inventory & stock"); await expect(offline).not.toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`Databricks OAuth flow changes keep file fields, permissions and account identity consistent at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: "Edit Databricks", exact: true }).click();
    const flow = page.getByRole("combobox", { name: "OAuth flow", exact: true });
    const account = page.getByRole("combobox", { name: "Account used by the application", exact: true });
    const callback = page.getByRole("textbox", { name: "Callback URL reference", exact: true });
    const client = page.getByRole("textbox", { name: "Client ID", exact: true });
    const save = page.getByRole("button", { name: "Export configuration", exact: true });
    const permissions = page.getByRole("button", { name: "Permissions", exact: true });
    await expect(flow).toHaveValue("User consent"); await expect(account).toHaveValue("Each app user's own account");
    await expect(callback).toHaveValue("env:DATABRICKS_CALLBACK");
    await save.click(); const initial = JSON.parse(await page.getByTestId("export").textContent());
    await page.getByText("User consent", { exact: true }).click();
    await page.getByRole("option", { name: "Service account", exact: true }).click();
    await expect(callback).toHaveCount(0); await expect(account).toHaveValue("One shared account");
    await page.getByText("One shared account", { exact: true }).click();
    await expect(page.getByRole("option", { name: "Each app user's own account", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await client.fill("service-client");
    await permissions.click();
    const jobs = page.getByRole("checkbox", { name: "Jobs API access for the service account", exact: true });
    await jobs.check();
    await expect(page.getByRole("checkbox", { name: "Keep user access between visits", exact: true })).toHaveCount(0);
    await save.click(); const machine = JSON.parse(await page.getByTestId("export").textContent());
    expect(machine.registrations.databricks).toEqual({ source: "own", clientId: "service-client", clientSecretRef: "env:DATABRICKS_SECRET",
      grantType: "client_credentials", tokenEndpointAuthMethod: "client_secret_basic" });
    expect(machine.integrations.databricks.scopes).toEqual(["all-apis", "jobs"]);
    expect(machine.integrations.databricks.accountMode).toBe("shared");
    expect(machine.integrations.databricks.extensions).toEqual({ keep: "workspace" });
    expect(machine.integrations.calendar).toEqual(initial.integrations.calendar);
    expect(machine.registrations.google).toEqual(initial.registrations.google);
    await page.getByLabel("Lock form").check(); await expect(flow).toBeDisabled(); await expect(jobs).toBeDisabled();
    await page.getByLabel("Lock form").uncheck();
    await page.getByRole("button", { name: "Leave configuration" }).click();
    await page.getByRole("button", { name: "Return to configuration" }).click();
    await expect(flow).toHaveValue("Service account"); await expect(callback).toHaveCount(0);
    await page.getByText("Service account", { exact: true }).click();
    await page.getByRole("option", { name: "User consent", exact: true }).click();
    await expect(callback).toHaveValue("");
    await save.click();
    await expect(page.locator(".v-input").filter({ has: callback }).getByText("This value is required.", { exact: true })).toBeVisible();
    await callback.fill("env:USER_CALLBACK"); await client.fill("user-client");
    if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
    await expect(jobs).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Keep user access between visits", exact: true }).check();
    await save.click(); const user = JSON.parse(await page.getByTestId("export").textContent());
    expect(user.registrations.databricks.tokenEndpointAuthMethod).toBe("client_secret_post");
    expect(user.integrations.databricks.scopes).toEqual(["all-apis", "offline_access"]);
    const invalid = structuredClone(machine); invalid.integrations.databricks.accountMode = "per-user";
    await page.getByLabel("Import configuration JSON").fill(JSON.stringify(invalid));
    await page.getByRole("button", { name: "Import configuration", exact: true }).click();
    await expect(page.getByText("A service account cannot connect as each app user.", { exact: true })).toBeVisible();
    await expect(flow).toHaveValue("User consent");
    await page.getByLabel("Import configuration JSON").fill(JSON.stringify(machine));
    await page.getByRole("button", { name: "Import configuration", exact: true }).click();
    await expect(flow).toHaveValue("Service account"); await expect(callback).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`Redshift deployment changes share CLI validation and remove inactive fields at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: "Edit Redshift", exact: true }).click();
    const mode = page.getByRole("combobox", { name: "Deployment type", exact: true });
    const workgroup = page.getByRole("textbox", { name: "Workgroup name", exact: true });
    const cluster = page.getByRole("textbox", { name: "Cluster identifier", exact: true });
    const database = page.getByRole("textbox", { name: "Database", exact: true });
    const user = page.getByRole("textbox", { name: "Database user (optional)", exact: true });
    const save = page.getByRole("button", { name: "Export configuration", exact: true });
    await expect(mode).toHaveValue("Serverless");
    await expect(workgroup).toHaveValue("analytics"); await expect(cluster).toHaveCount(0); await expect(user).toHaveCount(0);
    await save.click();
    await expect(page.getByTestId("export")).toContainText('"workgroup": "analytics"');
    const original = JSON.parse(await page.getByTestId("export").textContent());
    await page.getByText("Serverless", { exact: true }).click();
    await page.getByRole("option", { name: "Provisioned cluster", exact: true }).click();
    await expect(workgroup).toHaveCount(0); await expect(cluster).toHaveValue(""); await expect(database).toHaveValue("dev");
    await save.click();
    await expect(page.getByTestId("export")).toHaveText(JSON.stringify(original, null, 2));
    await cluster.fill("analytics-cluster"); await user.fill("report_reader"); await save.click();
    await expect(page.getByTestId("export")).toContainText('"databaseUser": "report_reader"');
    const provisioned = JSON.parse(await page.getByTestId("export").textContent());
    expect(provisioned.integrations.redshift.settings).toEqual({ deploymentType: "provisioned", region: "us-east-1", database: "dev", accessKeyIdRef: "env:AWS_ACCESS_KEY_ID", clusterIdentifier: "analytics-cluster", databaseUser: "report_reader" });
    expect(provisioned.integrations.redshift.extensions).toEqual({ keep: "redshift" });
    expect(provisioned.integrations.calendar).toEqual(original.integrations.calendar);
    await page.getByRole("button", { name: "Leave configuration", exact: true }).click();
    await page.getByRole("button", { name: "Return to configuration", exact: true }).click();
    await expect(mode).toHaveValue("Provisioned cluster"); await expect(cluster).toHaveValue("analytics-cluster");
    await page.getByLabel("Lock form").check(); await expect(mode).toBeDisabled(); await page.getByLabel("Lock form").uncheck();
    await page.getByText("Provisioned cluster", { exact: true }).click();
    await page.getByRole("option", { name: "Serverless", exact: true }).click();
    await expect(cluster).toHaveCount(0); await expect(user).toHaveCount(0); await expect(workgroup).toHaveValue("");
    await workgroup.fill("restored-group"); await expect(workgroup).toHaveValue("restored-group"); await save.click();
    await expect(page.getByTestId("export")).toContainText('"workgroup": "restored-group"');
    const restored = JSON.parse(await page.getByTestId("export").textContent());
    expect(restored.integrations.redshift.settings).toEqual({ deploymentType: "serverless", region: "us-east-1", database: "dev", accessKeyIdRef: "env:AWS_ACCESS_KEY_ID", workgroup: "restored-group" });
    const mixed = structuredClone(restored); mixed.integrations.redshift.settings.clusterIdentifier = "mixed";
    await page.getByLabel("Import configuration JSON").fill(JSON.stringify(mixed));
    await page.getByRole("button", { name: "Import configuration", exact: true }).click();
    await expect(workgroup).toHaveValue("restored-group"); await expect(cluster).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".v-progress-circular")).toHaveCount(0);
  });
  test(`Slack actor changes retain applicable permissions and reject invalid imports at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: "Edit Slack", exact: true }).click();
    const actor = page.getByRole("combobox", { name: "Act in Slack as", exact: true });
    const permissions = page.getByRole("button", { name: "Permissions", exact: true });
    const save = page.getByRole("button", { name: "Export configuration", exact: true });
    const read = page.getByRole("checkbox", { name: "View basic information about public channels in a workspace", exact: true });
    const profile = page.getByRole("checkbox", { name: "Edit a user's profile information and status", exact: true });
    const join = page.getByRole("checkbox", { name: "Join public channels in a workspace", exact: true });
    if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
    await expect(page.locator(".v-expansion-panel-text").getByRole("checkbox")).toHaveCount(52);
    await expect(read).toBeChecked();
    await profile.check();
    await page.getByText("Connected user", { exact: true }).click();
    await page.getByRole("option", { name: "Installed bot", exact: true }).click();
    await expect(page.locator(".v-expansion-panel-text").getByRole("checkbox")).toHaveCount(49);
    await expect(profile).toHaveCount(0);
    await expect(read).toBeChecked();
    await join.check();
    await save.click();
    const bot = JSON.parse(await page.getByTestId("export").textContent());
    expect(bot.integrations.slack.scopes).toEqual(["channels:read", "channels:join"]);
    expect(bot.integrations.slack.settings).toEqual({ actor: "bot" });
    expect(bot.integrations.slack.extensions).toEqual({ keep: "workspace" });
    await page.getByLabel("Lock form").check();
    await expect(actor).toBeDisabled();
    await expect(join).toBeDisabled();
    await page.getByLabel("Lock form").uncheck();
    await page.getByRole("button", { name: "Leave configuration" }).click();
    await page.getByRole("button", { name: "Return to configuration" }).click();
    await expect(actor).toHaveValue("Installed bot");
    await page.getByText("Installed bot", { exact: true }).click();
    await page.getByRole("option", { name: "Connected user", exact: true }).click();
    await save.click();
    const user = JSON.parse(await page.getByTestId("export").textContent());
    expect(user.integrations.slack.scopes).toEqual(["channels:read"]);
    expect(user.integrations.calendar).toEqual(bot.integrations.calendar);
    const invalid = structuredClone(bot);
    invalid.integrations.slack.scopes.push("users.profile:write");
    await page.getByLabel("Import configuration JSON").fill(JSON.stringify(invalid));
    await page.getByRole("button", { name: "Import configuration", exact: true }).click();
    if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
    await expect(page.getByText("A selected permission is not supported by this provider configuration.", { exact: true })).toBeVisible();
    await expect(actor).toHaveValue("Connected user");
    await page.getByLabel("Import configuration JSON").fill(JSON.stringify(bot));
    await page.getByRole("button", { name: "Import configuration", exact: true }).click();
    await expect(actor).toHaveValue("Installed bot");
    if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
    await expect(join).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`ClickHouse authentication modes preserve portable configuration at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: "Edit ClickHouse", exact: true }).click();
    const password = page.getByRole("textbox", { name: "Password reference (optional)", exact: true });
    const username = page.getByRole("textbox", { name: "Username (optional)", exact: true });
    const endpoint = page.getByRole("textbox", { name: "HTTP Interface URL", exact: true });
    const authentication = page.getByRole("combobox", { name: "Authentication", exact: true });
    const save = page.getByRole("button", { name: "Export configuration", exact: true });
    await expect(username).toHaveValue("reader");
    await password.fill("raw-password");
    await save.click();
    await expect(page.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
    await password.fill("");
    await save.click();
    const value = JSON.parse(await page.getByTestId("export").textContent());
    expect(value.integrations.warehouse.authentication).toEqual({ method: "api-key" });
    await page.getByText("Username and password", { exact: true }).click();
    await page.getByRole("option", { name: "No credentials", exact: true }).click();
    await expect(password).toHaveCount(0);
    await expect(username).toHaveCount(0);
    await save.click();
    const anonymous = JSON.parse(await page.getByTestId("export").textContent());
    expect(anonymous.integrations.warehouse.authentication).toEqual({ method: "none" });
    expect(anonymous.integrations.warehouse.settings).toEqual({ httpUrl: "https://warehouse.example:8443/query/" });
    expect(anonymous.integrations.warehouse.extensions).toEqual({ keep: "database" });
    expect(anonymous.integrations.calendar).toEqual(value.integrations.calendar);
    await page.getByLabel("Lock form").check();
    await expect(authentication).toBeDisabled();
    await expect(endpoint).toBeDisabled();
    await page.getByLabel("Lock form").uncheck();
    await page.getByRole("button", { name: "Leave configuration" }).click();
    await page.getByRole("button", { name: "Return to configuration" }).click();
    await expect(page.getByText("No credentials", { exact: true })).toBeVisible();
    await expect(endpoint).toHaveValue("https://warehouse.example:8443/query/");
    await page.getByText("No credentials", { exact: true }).click();
    await page.getByRole("option", { name: "Username and password", exact: true }).click();
    await expect(username).toHaveValue("");
    await expect(password).toHaveValue("");
    value.integrations.warehouse.authentication.secretRef = "env:CLI_PASSWORD";
    value.integrations.warehouse.settings.username = "cli-reader";
    await page.getByLabel("Import configuration JSON").fill(JSON.stringify(value));
    await page.getByRole("button", { name: "Import configuration", exact: true }).click();
    await expect(username).toHaveValue("cli-reader");
    await expect(password).toHaveValue("env:CLI_PASSWORD");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`configuration remains portable and usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.getByLabel("Display name").fill("My calendar");
    await page.getByLabel("Client ID", { exact: true }).fill("updated-client");
    await page.getByRole("button", { name: "Permissions", exact: true }).click();
    await page.getByLabel("Read events", { exact: true }).uncheck();
    await page.getByRole("button", { name: "Export configuration", exact: true }).click();
    await expect(page.getByTestId("export")).toContainText("updated-client");
    const value = JSON.parse(await page.getByTestId("export").textContent());
    expect(value.integrations.calendar.displayName).toBe("My calendar");
    expect(value.integrations.calendar.extensions.businessRule).toBe("keep-me");
    expect(value.integrations.calendar.scopes).toHaveLength(1);

    await page.getByRole("button", { name: "Leave configuration" }).click();
    await page.getByRole("button", { name: "Return to configuration" }).click();
    await expect(page.getByLabel("Display name")).toHaveValue("My calendar");

    const obsolete = structuredClone(value);
    obsolete.registrations.google.source = "managed";
    obsolete.registrations.google.clientId = "must-not-be-imported";
    await page.getByLabel("Import configuration JSON").fill(JSON.stringify(obsolete));
    await page.getByRole("button", { name: "Import configuration", exact: true }).click();
    await expect(page.getByLabel("Client ID", { exact: true })).toHaveValue("updated-client");
    await expect(page.getByLabel("Managed registration", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Export configuration", exact: true }).click();
    expect(JSON.parse(await page.getByTestId("export").textContent()).registrations.google.source).toBe("own");

    value.registrations.google.clientId = "written-from-cli";
    await page.getByLabel("Import configuration JSON").fill(JSON.stringify(value));
    await page.getByRole("button", { name: "Import configuration", exact: true }).click();
    await expect(page.getByLabel("Client ID", { exact: true })).toHaveValue("written-from-cli");

    await page.getByLabel("Display name").fill("");
    await page.getByRole("button", { name: "Export configuration", exact: true }).click();
    expect(JSON.parse(await page.getByTestId("export").textContent()).integrations.calendar).not.toHaveProperty("displayName");
    await page.getByLabel("Lock form").check();
    await expect(page.getByLabel("Client ID", { exact: true })).toBeDisabled();
    await page.getByLabel("Lock form").uncheck();

    await page.getByLabel("Client secret reference").fill("an-actual-secret-is-not-a-reference");
    await page.getByRole("button", { name: "Export configuration", exact: true }).click();
    await expect(page.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
    await page.getByLabel("Client secret reference").fill("env:GOOGLE_SECRET");
    await page.getByLabel("Callback URL reference").fill("https://callback.example.test/oauth");
    await page.getByRole("button", { name: "Export configuration", exact: true }).click();
    await expect(page.locator(".v-input").filter({ has: page.getByLabel("Callback URL reference") }).getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
    await page.getByLabel("Callback URL reference").fill("env:CALLBACK");
    await page.getByRole("button", { name: "Edit Mailgun", exact: true }).click();
    await expect(page.getByText("United States (api.mailgun.net)", { exact: true })).toBeVisible();
    const region = page.getByRole("combobox", { name: "API region", exact: true });
    await page.getByText("United States (api.mailgun.net)", { exact: true }).click();
    await page.getByRole("option", { name: "European Union (api.eu.mailgun.net)", exact: true }).click();
    await page.getByRole("button", { name: "Export configuration", exact: true }).click();
    const regional = JSON.parse(await page.getByTestId("export").textContent());
    expect(regional.integrations.mail.settings).toEqual({ region: "eu" });
    expect(regional.integrations.mail.extensions).toEqual({ label: "preserve" });
    await page.getByLabel("Lock form").check();
    await expect(region).toBeDisabled();
    await page.getByLabel("Lock form").uncheck();
    await page.getByRole("button", { name: "Leave configuration" }).click();
    await page.getByRole("button", { name: "Return to configuration" }).click();
    await expect(page.getByText("European Union (api.eu.mailgun.net)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit Algolia", exact: true }).click();
    const applicationId = page.getByRole("textbox", { name: "Application ID", exact: true });
    const publicKey = page.getByRole("textbox", { name: "Public API key reference (optional)", exact: true });
    await expect(applicationId).toHaveValue("ORIGINALAPP");
    await applicationId.fill("app.invalid");
    await page.getByRole("button", { name: "Export configuration", exact: true }).click();
    await expect(page.getByText("Enter the application ID using letters and digits.", { exact: true })).toBeVisible();
    await applicationId.fill("");
    await page.getByRole("button", { name: "Export configuration", exact: true }).click();
    await expect(page.locator(".v-input--error")).toHaveCount(1);
    await applicationId.fill("UPDATEDAPP");
    await publicKey.fill("raw-search-key");
    await page.getByRole("button", { name: "Export configuration", exact: true }).click();
    await expect(page.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
    await publicKey.fill("env:ALGOLIA_SEARCH_KEY");
    await page.getByRole("button", { name: "Export configuration", exact: true }).click();
    const search = JSON.parse(await page.getByTestId("export").textContent());
    expect(search.integrations.search.settings).toEqual({ applicationId: "UPDATEDAPP", publicApiKeyRef: "env:ALGOLIA_SEARCH_KEY" });
    expect(search.integrations.search.authentication.secretRef).toBe("env:ALGOLIA_BACKEND_KEY");
    expect(search.integrations.search.extensions).toEqual({ keep: true });
    await page.getByLabel("Lock form").check();
    await expect(applicationId).toBeDisabled();
    await expect(publicKey).toBeDisabled();
    await page.getByLabel("Lock form").uncheck();
    await page.getByRole("button", { name: "Leave configuration" }).click();
    await page.getByRole("button", { name: "Return to configuration" }).click();
    await expect(publicKey).toHaveValue("env:ALGOLIA_SEARCH_KEY");
    await publicKey.fill("");
    await page.getByRole("button", { name: "Export configuration", exact: true }).click();
    expect(JSON.parse(await page.getByTestId("export").textContent()).integrations.search.settings).toEqual({ applicationId: "UPDATEDAPP" });
    search.integrations.search.settings.applicationId = "CLIAPP";
    await page.getByLabel("Import configuration JSON").fill(JSON.stringify(search));
    await page.getByRole("button", { name: "Import configuration", exact: true }).click();
    await expect(applicationId).toHaveValue("CLIAPP");
    await expect(publicKey).toHaveValue("env:ALGOLIA_SEARCH_KEY");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const smallButtons = await page.getByRole("button").evaluateAll((buttons) => buttons.filter((button) => {
      const box = button.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && (box.width < 48 || box.height < 48);
    }).map((button) => button.textContent));
    expect(smallButtons).toEqual([]);
  });
}


test("Contentful delivery fields preserve UI and CLI configuration", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Edit Contentful", exact: true }).click();
  const space = page.getByRole("textbox", { name: "Space ID", exact: true });
  const environment = page.getByRole("textbox", { name: "Environment ID", exact: true });
  const token = page.getByRole("textbox", { name: "Content Delivery API token reference", exact: true });
  const save = page.getByRole("button", { name: "Export configuration", exact: true });
  await expect(space).toHaveValue("original-space");
  await expect(environment).toHaveValue("master");
  await space.fill("");
  await save.click();
  await expect(page.locator(".v-input--error")).toHaveCount(1);
  await space.fill("published-space");
  await environment.fill("release-2");
  await token.fill("raw-token");
  await save.click();
  await expect(page.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
  await token.fill("env:CONTENTFUL_ROTATED_TOKEN");
  await page.getByText("United States", { exact: true }).click();
  await page.getByRole("option", { name: "Europe", exact: true }).click();
  await save.click();
  const exported = JSON.parse(await page.getByTestId("export").textContent());
  expect(exported.integrations.content.settings).toEqual({ spaceId: "published-space", environmentId: "release-2", region: "eu" });
  expect(exported.integrations.content.authentication.secretRef).toBe("env:CONTENTFUL_ROTATED_TOKEN");
  await page.getByRole("button", { name: "Leave configuration" }).click();
  await page.getByRole("button", { name: "Return to configuration" }).click();
  await expect(space).toHaveValue("published-space");
  await expect(environment).toHaveValue("release-2");
  await expect(token).toHaveValue("env:CONTENTFUL_ROTATED_TOKEN");
  exported.integrations.content.settings.spaceId = "cli-space";
  await page.getByLabel("Import configuration JSON").fill(JSON.stringify(exported));
  await page.getByRole("button", { name: "Import configuration", exact: true }).click();
  await expect(space).toHaveValue("cli-space");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test("Analytics public setting round-trips without credentials", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Edit Analytics", exact: true }).click();
  const measurement = page.getByRole("textbox", { name: "Measurement ID", exact: true });
  const save = page.getByRole("button", { name: "Export configuration", exact: true });
  await expect(measurement).toHaveValue("G-ORIGINAL1");
  await expect(page.getByText("Public: this value will be visible in your published application. Copy it from your GA4 web stream.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /secret|callback|client id|API key/i })).toHaveCount(0);
  await measurement.fill("");
  await save.click();
  await expect(page.locator(".v-input--error")).toHaveCount(1);
  await measurement.fill("UA-123-1");
  await save.click();
  await expect(page.locator(".v-input--error")).toHaveCount(1);
  await measurement.fill("G-WEBSITE123");
  await save.click();
  const exported = JSON.parse(await page.getByTestId("export").textContent());
  expect(exported.integrations.analytics).toMatchObject({
    provider: "google-analytics", accountMode: "shared", scopes: [],
    authentication: { method: "none" }, settings: { measurementId: "G-WEBSITE123" }
  });
  expect(exported.integrations.analytics.authentication).toEqual({ method: "none" });
  await page.getByRole("button", { name: "Leave configuration" }).click();
  await page.getByRole("button", { name: "Return to configuration" }).click();
  await expect(measurement).toHaveValue("G-WEBSITE123");
  exported.integrations.analytics.settings.measurementId = "G-CLI123";
  await page.getByLabel("Import configuration JSON").fill(JSON.stringify(exported));
  await page.getByRole("button", { name: "Import configuration", exact: true }).click();
  await expect(measurement).toHaveValue("G-CLI123");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test("Drive captured permissions retain required file access and optional choices", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit Drive", exact: true }).click();
  const required = page.getByRole("checkbox", { name: "Manage files selected for this application", exact: true });
  if (!await required.isVisible()) await page.getByRole("button", { name: "Permissions", exact: true }).click();
  await expect(required).toBeChecked();
  await expect(required).toBeDisabled();
  for (const name of ["Read and download files", "Manage application data", "Manage this application’s Drive folder data"]) {
    const checkbox = page.getByRole("checkbox", { name, exact: true });
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
  }
  await page.getByRole("button", { name: "Export configuration", exact: true }).click();
  expect(JSON.parse(await page.getByTestId("export").textContent()).integrations.drive.scopes)
    .toEqual(["https://www.googleapis.com/auth/drive.file"]);
  await page.getByRole("button", { name: "Leave configuration" }).click();
  await page.getByRole("button", { name: "Return to configuration" }).click();
  if (!await required.isVisible()) await page.getByRole("button", { name: "Permissions", exact: true }).click();
  await expect(required).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Read and download files", exact: true })).not.toBeChecked();
});

test("Gmail captured permissions allow optional sending permissions to be removed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit Gmail", exact: true }).click();
  const required = page.getByRole("checkbox", { name: "Read messages", exact: true });
  if (!await required.isVisible()) await page.getByRole("button", { name: "Permissions", exact: true }).click();
  await expect(required).toBeChecked();
  await expect(required).toBeDisabled();
  for (const name of ["Send messages", "Manage drafts and send messages", "Read and modify messages"]) {
    const checkbox = page.getByRole("checkbox", { name, exact: true });
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
  }
  await page.getByRole("button", { name: "Export configuration", exact: true }).click();
  expect(JSON.parse(await page.getByTestId("export").textContent()).integrations.gmail.scopes)
    .toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  await page.getByRole("button", { name: "Leave configuration" }).click();
  await page.getByRole("button", { name: "Return to configuration" }).click();
  if (!await required.isVisible()) await page.getByRole("button", { name: "Permissions", exact: true }).click();
  await expect(required).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Send messages", exact: true })).not.toBeChecked();
});


test("BigQuery query project validates and round-trips through CLI configuration", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Edit BigQuery", exact: true }).click();
  const project = page.getByRole("textbox", { name: "Google Cloud project ID", exact: true });
  const save = page.getByRole("button", { name: "Export configuration", exact: true });
  await expect(project).toHaveValue("query-project");
  for (const value of ["", "123456789", "https://example.com"]) {
    await project.fill(value);
    await save.click();
    await expect(page.locator(".v-input--error")).toHaveCount(1);
  }
  await project.fill("billing-project");
  await save.click();
  const exported = JSON.parse(await page.getByTestId("export").textContent());
  expect(exported.integrations.bigquery).toMatchObject({
    settings: { projectId: "billing-project" },
    authentication: { method: "oauth2", registrationRef: "google" },
    scopes: ["https://www.googleapis.com/auth/bigquery"]
  });
  await page.getByRole("button", { name: "Leave configuration" }).click();
  await page.getByRole("button", { name: "Return to configuration" }).click();
  await expect(project).toHaveValue("billing-project");
  exported.integrations.bigquery.settings.projectId = "cli-project";
  await page.getByLabel("Import configuration JSON").fill(JSON.stringify(exported));
  await page.getByRole("button", { name: "Import configuration", exact: true }).click();
  await expect(project).toHaveValue("cli-project");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
