import { defineConfig } from "vitepress";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = repoName ? `/${repoName}/` : "/";

export default defineConfig({
  title: "JSKIT",
  description: "Fresh documentation for the JSKIT framework.",
  base,
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    siteTitle: "JSKIT",
    nav: [
      { text: "AI Ready", link: "/ai-ready" },
      { text: "Vibe Guide", link: "/vibe-guide" },
      { text: "Guide", link: "/guide/" },
      { text: "Patterns", link: "/patterns/" },
      { text: "GitHub", link: "https://github.com/mobily-enterprises/jskit-ai" }
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Overview",
          items: [{ text: "Guide Index", link: "/guide/" }]
        },
        {
          text: "App Setup",
          items: [
            { text: "Quickstart", link: "/guide/app-setup/quickstart" },
            { text: "Application Foundations", link: "/guide/app-setup/initial-scaffolding" },
            { text: "Upgrade JSKIT", link: "/guide/app-setup/upgrading-jskit" },
            { text: "Migrate an Existing Application", link: "/guide/app-setup/existing-application-migration" },
            { text: "A More Interesting Shell", link: "/guide/app-setup/a-more-interesting-shell" },
            { text: "Authentication", link: "/guide/app-setup/authentication" },
            { text: "Database Layer", link: "/guide/app-setup/database-layer" },
            { text: "Users", link: "/guide/app-setup/users" },
            { text: "Multi-homing", link: "/guide/app-setup/multi-homing" },
            { text: "Console", link: "/guide/app-setup/console" }
          ]
        },
        {
          text: "App Extras",
          items: [
            { text: "Mobile Capacitor", link: "/guide/app-extras/mobile-capacitor" },
            { text: "Realtime", link: "/guide/app-extras/realtime" },
            { text: "Assistant", link: "/guide/app-extras/assistant" }
          ]
        },
        {
          text: "Framework Reference",
          items: [
            { text: "Application Operations", link: "/guide/framework/application-operations" },
            { text: "CRUD Operations", link: "/guide/framework/crud-operations" },
            { text: "UI Operations", link: "/guide/framework/ui-operations" },
            { text: "Material 3", link: "/guide/framework/material-3" },
            { text: "Source Patterns", link: "/patterns/" }
          ]
        }
      ],
      "/patterns/": [
        {
          text: "Source Patterns",
          items: [{ text: "Pattern Index", link: "/patterns/" }]
        }
      ]
    },
    search: {
      provider: "local"
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/mobily-enterprises/jskit-ai" }
    ],
    footer: {
      message: "JSKIT documentation",
      copyright: "Copyright 2026 Mobily Enterprises"
    }
  }
});
