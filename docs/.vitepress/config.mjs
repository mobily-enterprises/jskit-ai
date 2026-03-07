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
            { text: "001 Intro: Create An App", link: "/manual/001-Intro:_Create_An_App" },
            { text: "002 App And Provider Classes", link: "/manual/002-Kernel:_Server:_App_And_Provider_Classes" },
            { text: "003 Real Applications", link: "/manual/003-Kernel:_Server:_Real%20applications" },
            { text: "004 Advanced Topics", link: "/manual/004-Kernel:_Server:_Advanced_Topics" },
            { text: "005 Client Intro", link: "/manual/005-Kernel:_Client_Into" },
            { text: "006 Client API", link: "/manual/006-Kernel:_Client_API" },
            { text: "007 Client And Server API", link: "/manual/007-Kernel:_Client_And_Server_API" }
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
