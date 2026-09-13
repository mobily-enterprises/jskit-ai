const atlassianDefinition = Object.freeze({
  id: "atlassian", name: "Atlassian", description: "Use Jira, Confluence and other Atlassian tools through the assistant owner's Rovo MCP connection.",
  accountModes: ["assistant"], authenticationMethods: ["oauth2"],
  scopes: [
    { value: "read:me", label: "Read your profile", recommended: true },
    { value: "read:account", label: "Read your account", recommended: true },
    { value: "offline_access", label: "Refresh access without repeating sign-in", recommended: true },
    { value: "email", label: "Read your email address" },
    { value: "read:jira:agent-interface", label: "Read Jira content", recommended: true },
    { value: "write:jira:agent-interface", label: "Create and edit Jira content" },
    { value: "search:jira:agent-interface", label: "Search Jira", recommended: true },
    { value: "delete:jira:agent-interface", label: "Delete Jira content" },
    { value: "manage:jira:agent-interface", label: "Manage Jira" },
    { value: "read:confluence:agent-interface", label: "Read Confluence content", recommended: true },
    { value: "write:confluence:agent-interface", label: "Create and edit Confluence content" },
    { value: "search:confluence:agent-interface", label: "Search Confluence", recommended: true },
    { value: "search:rovo:agent-interface", label: "Search with Rovo" },
    { value: "search:code:agent-interface", label: "Search code" },
    { value: "read:all:twg", label: "Read Teamwork Graph content" },
    { value: "write:all:twg", label: "Write Teamwork Graph content" },
    ...["goals", "projects", "bitbucket", "loom", "talent", "teams", "artifacts", "focus"].flatMap((product) => {
      const name = product[0].toUpperCase() + product.slice(1);
      return [
        { value: `read:${product}:agent-interface`, label: `Read ${name} content` },
        { value: `write:${product}:agent-interface`, label: `Create and edit ${name} content` }
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
