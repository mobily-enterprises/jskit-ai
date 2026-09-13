const wordpressComDefinition = Object.freeze({
  id: "wordpress-com", name: "WordPress.com", description: "Connect a WordPress.com account to read its profile/sites and manage posts, pages and media.",
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
  scopes: [
    { value: "users", label: "View user information (required for verification)", recommended: true },
    { value: "sites", label: "View site information and options", recommended: true },
    { value: "posts", label: "View and manage posts", recommended: true },
    { value: "media", label: "Manage media assets" },
    { value: "comments", label: "View and manage comments" },
    { value: "stats", label: "View site statistics" },
    { value: "taxonomy", label: "Manage taxonomy terms" },
    { value: "batch", label: "Batch API requests" }
  ],
  setup: {
    url: "https://developer.wordpress.com/docs/api/oauth2/",
    steps: [
      "Sign into WordPress.com Developer Resources, open My Apps and choose Create New Application.",
      "Enter the application name, description and exact backend Redirect URL, then create it. Copy its Client ID here and store the Client Secret and callback URL in the referenced Env variables.",
      "Keep users permission for authenticated verification. Sites enables site listing; posts enables reading, drafting and publishing posts or pages. Your application must authorize each write.",
      "Save configuration, then start consent through the runtime. The provider's selected site and granted scopes control access; no global all-sites scope is requested.",
      "Select media and grant consent to upload or manage library assets. The site still enforces file types, storage and account permissions. Uploads can return per-file errors; the app must inspect them. Media deletion is permanent.",
      "Select comments for replies and moderation. Site rules may publish a new reply immediately. Editing requires an explicit moderation status; restoring a comment can make it public again. Your app must restrict moderator actions.",
      "Select stats for site reports and taxonomy to manage categories/tags. Reconnect after adding permissions. Site roles still apply; deleting or renaming a term can affect existing content. Your application owns its report and taxonomy screens.",
      "Batch combines selected reads from one site; select batch and each resource permission. A successful batch can contain individual permission errors. It does not group writes into a transaction.",
      "New content defaults to draft with publicizing off. Publishing, deletion and restoration are explicit app actions; deleting an already-trashed post can permanently remove it, and restoring can publish it again.",
      "This connects provider data. It does not create an application login or use self-hosted WordPress Application Passwords."
    ]
  }
});
export { wordpressComDefinition };
