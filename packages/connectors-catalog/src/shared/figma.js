const figmaDefinition = Object.freeze({
  id: "figma", name: "Figma", description: "Discover and call Figma's remote design tools through the assistant owner's account.",
  accountModes: ["assistant"], authenticationMethods: ["oauth2"],
  scopes: [{ value: "mcp:connect", label: "Use Figma MCP tools", recommended: true }],
  setup: {
    url: "https://developers.figma.com/docs/figma-mcp-server/",
    clientRegistrationEndpoint: "https://api.figma.com/v1/oauth/mcp/register",
    steps: [
      "Open Figma's MCP guide and follow the new-client waitlist link. Figma currently requires approval for clients outside its catalogue.",
      "After approval, confirm the suggested callback is the exact route your application will serve. Use the OAuth client registration section below to copy the endpoint and request body into your HTTP client. Send one POST with Content-Type application/json. CLI users can call registerFigmaClient; do not repeat registration for every connection.",
      "Copy client_id from the successful response into Client ID and save configuration. Use Set credential in Env to store client_secret under the displayed Client secret reference. Use Set callback in Env to save the exact registered callback. Keep the registration response private.",
      "Save, begin authorization, sign into Figma and review its consent screen. A personal access token cannot replace this MCP OAuth registration.",
      "The host must authorize each tool and its arguments. The MCP permission can expose write tools; listing a tool does not authorize an edit.",
      "Use a Figma file/frame link to identify the allowed file and node. The assistant host consumes returned design text/images and chooses its framework; connecting alone does not generate screens. Vibe64 coding-assistant attachment is deferred.",
      "Remote MCP is the supported mode for both installed and hosted Vibe64. Desktop MCP must run beside the consuming desktop client; a VPS localhost address points to the VPS, not your laptop. Do not enter a desktop localhost URL as the hosted remote endpoint.",
      "Disconnect removes the local grant; it does not undo design edits or revoke all provider access. This uses Figma's remote server. Desktop MCP, app-user login and automatic assistant attachment are separate capabilities."
    ]
  }
});

export { figmaDefinition };
