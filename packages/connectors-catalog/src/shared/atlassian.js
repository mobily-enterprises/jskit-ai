const atlassianDefinition = Object.freeze({
  id: "atlassian", name: "Atlassian", description: "jskit.connectors.atlassian.description",
  accountModes: ["assistant"], authenticationMethods: ["oauth2"],
  scopes: [
    { value: "read:me", label: "jskit.connectors.atlassian.scopes.readMe.label", recommended: true },
    { value: "read:account", label: "jskit.connectors.atlassian.scopes.readAccount.label", recommended: true },
    { value: "offline_access", label: "jskit.connectors.atlassian.scopes.offlineAccess.label", recommended: true },
    { value: "email", label: "jskit.connectors.atlassian.scopes.email.label" },
    { value: "read:jira:agent-interface", label: "jskit.connectors.atlassian.scopes.readJiraAgentInterface.label", recommended: true },
    { value: "write:jira:agent-interface", label: "jskit.connectors.atlassian.scopes.writeJiraAgentInterface.label" },
    { value: "search:jira:agent-interface", label: "jskit.connectors.atlassian.scopes.searchJiraAgentInterface.label", recommended: true },
    { value: "delete:jira:agent-interface", label: "jskit.connectors.atlassian.scopes.deleteJiraAgentInterface.label" },
    { value: "manage:jira:agent-interface", label: "jskit.connectors.atlassian.scopes.manageJiraAgentInterface.label" },
    { value: "read:confluence:agent-interface", label: "jskit.connectors.atlassian.scopes.readConfluenceAgentInterface.label", recommended: true },
    { value: "write:confluence:agent-interface", label: "jskit.connectors.atlassian.scopes.writeConfluenceAgentInterface.label" },
    { value: "search:confluence:agent-interface", label: "jskit.connectors.atlassian.scopes.searchConfluenceAgentInterface.label", recommended: true },
    { value: "search:rovo:agent-interface", label: "jskit.connectors.atlassian.scopes.searchRovoAgentInterface.label" },
    { value: "search:code:agent-interface", label: "jskit.connectors.atlassian.scopes.searchCodeAgentInterface.label" },
    { value: "read:all:twg", label: "jskit.connectors.atlassian.scopes.readAllTwg.label" },
    { value: "write:all:twg", label: "jskit.connectors.atlassian.scopes.writeAllTwg.label" },
    ...["goals", "projects", "bitbucket", "loom", "talent", "teams", "artifacts", "focus"].flatMap((product) => {
      const name = product[0].toUpperCase() + product.slice(1);
      return [
        { value: `read:${product}:agent-interface`, label: { key: "jskit.connectors.atlassian.scopes.readProduct.label", params: { product: name } } },
        { value: `write:${product}:agent-interface`, label: { key: "jskit.connectors.atlassian.scopes.writeProduct.label", params: { product: name } } }
      ];
    })
  ],
  setup: {
    clientRegistrationEndpoint: "https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3/dcr/register",
    url: "https://support.atlassian.com/atlassian-ai-gateway/docs/configure-oauth-2-1/",
    steps: [
      "Choose permissions and the Suggested callback URL, then select Register client and connect to create this application's Rovo MCP v2 client and save credentials in development Env. Manual registration is also available below. Use your assistant host's exact callback URL; old v1 clients and tokens do not carry over.",
      "For an existing or manually registered client, enter its Client ID. Store its Client Secret and callback URL through Env, then enter their references here.",
      "Choose only the products and permissions your assistant needs. Content writes, deletes and administration start disabled.",
      "Save and select Connect account, sign into Atlassian and review the product and site permissions on its consent screen.",
      "The runtime lists available tools without executing them. Your host must authorize the exact tool and arguments, including the destination site or project.",
      "This connects the assistant owner's account; it does not configure app-user login or attach tools automatically."
    ]
  }
});

export { atlassianDefinition };
