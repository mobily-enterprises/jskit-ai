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
      { text: "Guide", link: "/guide/initial-scaffolding" },
      { text: "GitHub", link: "https://github.com/mobily-enterprises/jskit-ai" }
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Initial Scaffolding", link: "/guide/initial-scaffolding" },
            { text: "A More Interesting Shell", link: "/guide/a-more-interesting-shell" }
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
