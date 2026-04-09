import { defineConfig } from "vitepress";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = repoName ? `/${repoName}/` : "/";

export default defineConfig({
  title: "JSKIT",
  description: "Manual-first documentation for the JSKIT framework.",
  base,
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    siteTitle: "JSKIT",
    nav: [
      { text: "Manual", link: "/manual/" },
      { text: "Examples", link: "/examples/03.real-app/" },
      { text: "Contributing", link: "/CONTRIBUTING" },
      { text: "GitHub", link: "https://github.com/mobily-enterprises/jskit-ai" }
    ],
    sidebar: {
      "/manual/": [
        {
          text: "Manual",
          items: [
            { text: "Overview", link: "/manual/" },
            { text: "001 UI Generator", link: "/manual/001-UI_Generator" }
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
