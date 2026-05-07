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
            { text: "Initial Scaffolding", link: "/guide/app-setup/initial-scaffolding" },
            { text: "Working With The JSKIT CLI", link: "/guide/app-setup/working-with-the-jskit-cli" },
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
          text: "Generators",
          items: [
            { text: "Intro", link: "/guide/generators/intro" },
            { text: "UI Generators", link: "/guide/generators/ui-generators" },
            { text: "CRUD Generators", link: "/guide/generators/crud-generators" },
            { text: "Advanced CRUDs", link: "/guide/generators/advanced-cruds" }
          ]
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
