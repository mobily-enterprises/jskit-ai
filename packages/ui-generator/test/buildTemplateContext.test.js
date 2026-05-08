import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { buildUiPageTemplateContext } from "../src/server/buildTemplateContext.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "ui-generator-"));
  try {
    return await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

async function writeFileInApp(appRoot, relativePath, source) {
  const absoluteFile = path.join(appRoot, relativePath);
  await mkdir(path.dirname(absoluteFile), { recursive: true });
  await writeFile(absoluteFile, source, "utf8");
}

async function writeConfig(appRoot, source) {
  await writeFileInApp(appRoot, "config/public.js", source);
}

async function writeShellLayout(appRoot, source = "") {
  await writeFileInApp(
    appRoot,
    "src/components/ShellLayout.vue",
    source ||
      `<template>
  <div>
    <ShellOutlet target="shell-layout:top-right" />
    <ShellOutlet
      target="shell-layout:primary-menu"
      default
    />
  </div>
</template>
`
  );
  await writePlacementTopology(appRoot);
}

function renderTopologyVariant(outlet, { linkRenderer = "" } = {}) {
  const rendererLines = linkRenderer
    ? `,
      renderers: {
        link: "${linkRenderer}"
      }`
    : "";
  return `{
      outlet: "${outlet}"${rendererLines}
    }`;
}

function renderTopologyEntry({
  id = "",
  owner = "",
  surfaces = ["*"],
  defaultPlacement = false,
  outlet = "",
  linkRenderer = ""
} = {}) {
  const ownerLine = owner ? `    owner: "${owner}",\n` : "";
  const defaultLine = defaultPlacement ? "    default: true,\n" : "";
  return `  {
    id: "${id}",
${ownerLine}    surfaces: ${JSON.stringify(surfaces)},
${defaultLine}    variants: {
      compact: ${renderTopologyVariant(outlet, { linkRenderer })},
      medium: ${renderTopologyVariant(outlet, { linkRenderer })},
      expanded: ${renderTopologyVariant(outlet, { linkRenderer })}
    }
  }`;
}

async function writePlacementTopology(appRoot, entries = []) {
  const defaultEntries = [
    renderTopologyEntry({
      id: "shell.primary-nav",
      surfaces: ["*"],
      defaultPlacement: true,
      outlet: "shell-layout:primary-menu",
      linkRenderer: "local.main.ui.surface-aware-menu-link-item"
    }),
    renderTopologyEntry({
      id: "shell.status",
      surfaces: ["*"],
      outlet: "shell-layout:top-right",
      linkRenderer: "local.main.ui.surface-aware-menu-link-item"
    })
  ];
  await writeFileInApp(
    appRoot,
    "src/placementTopology.js",
    `export default {
  placements: [
${[...defaultEntries, ...entries].join(",\n")}
  ]
};
`
  );
}

test("buildUiPageTemplateContext resolves link placement from default app ShellOutlet target", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/reports/index.vue",
      options: {}
    });
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_TARGET__, "shell.primary-nav");
    assert.equal(context.__JSKIT_UI_LINK_OWNER_LINE__, "");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "");
    assert.equal(context.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/reports");
    assert.equal(context.__JSKIT_UI_LINK_NON_WORKSPACE_SUFFIX__, "/reports");
    assert.equal(context.__JSKIT_UI_LINK_WHEN_LINE__, "");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "");
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_ID__, "ui-generator.page.admin.reports.link");
  });
});

test("buildUiPageTemplateContext derives an auth guard from an authenticated surface policy", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceAccessPolicies: {
    authenticated: {
      requireAuth: true
    }
  },
  surfaceDefinitions: {
    app: { id: "app", pagesRoot: "app", enabled: true, accessPolicyId: "authenticated" }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "app/reports/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_WHEN_LINE__, "    when: ({ auth }) => auth?.authenticated === true\n");
  });
});

test("buildUiPageTemplateContext supports explicit link placement override", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/reports/index.vue",
      options: {
        "link-placement": "shell.status"
      }
    });
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_TARGET__, "shell.status");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "");
  });
});

test("buildUiPageTemplateContext supports explicit package semantic link placement", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writePlacementTopology(appRoot, [
      renderTopologyEntry({
        id: "page.section-nav",
        owner: "catalog",
        surfaces: ["admin"],
        outlet: "catalog:sub-pages",
        linkRenderer: "local.main.ui.surface-aware-menu-link-item"
      }),
      renderTopologyEntry({
        id: "page.section-nav",
        owner: "catalog-products",
        surfaces: ["admin"],
        outlet: "catalog-products:sub-pages",
        linkRenderer: "local.main.ui.surface-aware-menu-link-item"
      })
    ]);
    await writeFileInApp(
      appRoot,
      ".jskit/lock.json",
      `${JSON.stringify(
        {
          lockVersion: 1,
          installedPackages: {
            "@example/users-web": {
              packageId: "@example/users-web",
              source: {
                type: "npm-installed-package",
                descriptorPath: "node_modules/@example/users-web/package.descriptor.mjs"
              }
            }
          }
        },
        null,
        2
      )}\n`
    );
    await writeFileInApp(
      appRoot,
      "node_modules/@example/users-web/package.descriptor.mjs",
      `export default {
  packageId: "@example/users-web",
  metadata: {
    ui: {
      placements: {
        topology: {
          placements: [
          {
            id: "admin.tools-menu",
            surfaces: ["admin"],
            variants: {
              compact: {
                outlet: "admin-cog:primary-menu",
                renderers: {
                  link: "local.main.ui.surface-aware-menu-link-item"
                }
              },
              medium: {
                outlet: "admin-cog:primary-menu",
                renderers: {
                  link: "local.main.ui.surface-aware-menu-link-item"
                }
              },
              expanded: {
                outlet: "admin-cog:primary-menu",
                renderers: {
                  link: "local.main.ui.surface-aware-menu-link-item"
                }
              }
            }
          }
        ]
        }
      }
    }
  }
};
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/reports/index.vue",
      options: {
        "link-placement": "admin.tools-menu"
      }
    });
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_TARGET__, "admin.tools-menu");
  });
});

test("buildUiPageTemplateContext suppresses inferred relative link-to for surface-aware settings menu links", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    home: { id: "home", pagesRoot: "home", enabled: true }
  }
};
`
    );
    await writePlacementTopology(appRoot, [
      renderTopologyEntry({
        id: "page.section-nav",
        owner: "home-settings",
        surfaces: ["home"],
        outlet: "home-settings:primary-menu",
        linkRenderer: "local.main.ui.surface-aware-menu-link-item"
      })
    ]);
    await writeFileInApp(
      appRoot,
      "src/pages/home/settings.vue",
      `<template>
  <section>
    <ShellOutlet target="home-settings:primary-menu" />
    <RouterView />
  </section>
</template>
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "home/settings/pollen-types/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_TARGET__, "page.section-nav");
    assert.equal(context.__JSKIT_UI_LINK_OWNER_LINE__, "    owner: \"home-settings\",\n");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "");
  });
});

test("buildUiPageTemplateContext supports explicit semantic placement and link-to", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/contacts/[contactId]/index/notes/index.vue",
      options: {
        "link-placement": "shell.status",
        "link-to": "./notes"
      }
    });
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_TARGET__, "shell.status");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "");
    assert.equal(context.__JSKIT_UI_LINK_ICON__, "mdi-view-list-outline");
    assert.equal(context.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/contacts/[contactId]/notes");
    assert.equal(context.__JSKIT_UI_LINK_NON_WORKSPACE_SUFFIX__, "/contacts/[contactId]/notes");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "      to: \"./notes\",\n");
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_ID__, "ui-generator.page.admin.contacts.contact-id.notes.link");
  });
});

test("buildUiPageTemplateContext derives native route suffixes for index-owned child pages", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/contacts/[contactId]/index/notes/index.vue",
      options: {}
    });
    assert.equal(context.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/contacts/[contactId]/notes");
    assert.equal(context.__JSKIT_UI_LINK_NON_WORKSPACE_SUFFIX__, "/contacts/[contactId]/notes");
    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_ID__, "ui-generator.page.admin.contacts.contact-id.notes.link");
  });
});

test("buildUiPageTemplateContext infers subpage link placement, tab token, and link-to from a file-route parent host", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writePlacementTopology(appRoot, [
      renderTopologyEntry({
        id: "page.section-nav",
        owner: "contact-view",
        surfaces: ["admin"],
        outlet: "contact-view:sub-pages",
        linkRenderer: "local.main.ui.surface-aware-menu-link-item"
      })
    ]);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/contacts/[contactId].vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="contact-view:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/contacts/[contactId]/notes/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_TARGET__, "page.section-nav");
    assert.equal(context.__JSKIT_UI_LINK_OWNER_LINE__, "    owner: \"contact-view\",\n");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "");
    assert.equal(context.__JSKIT_UI_LINK_ICON__, "mdi-view-list-outline");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "      to: \"./notes\",\n");
  });
});

test("buildUiPageTemplateContext inherits a file-route parent host for deeper descendants", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writePlacementTopology(appRoot, [
      renderTopologyEntry({
        id: "page.section-nav",
        owner: "contact-view",
        surfaces: ["admin"],
        outlet: "contact-view:sub-pages",
        linkRenderer: "local.main.ui.surface-aware-menu-link-item"
      })
    ]);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/contacts/[contactId].vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="contact-view:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/contacts/[contactId]/notes/history/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_TARGET__, "page.section-nav");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "      to: \"./notes/history\",\n");
  });
});

test("buildUiPageTemplateContext infers subpage link placement from an index-route parent host", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writePlacementTopology(appRoot, [
      renderTopologyEntry({
        id: "page.section-nav",
        owner: "catalog",
        surfaces: ["admin"],
        outlet: "catalog:sub-pages",
        linkRenderer: "local.main.ui.surface-aware-menu-link-item"
      })
    ]);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/catalog/index.vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="catalog:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/catalog/index/products/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_TARGET__, "page.section-nav");
    assert.equal(context.__JSKIT_UI_LINK_OWNER_LINE__, "    owner: \"catalog\",\n");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "");
    assert.equal(context.__JSKIT_UI_LINK_ICON__, "mdi-view-list-outline");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "      to: \"./products\",\n");
  });
});

test("buildUiPageTemplateContext finds the nearest index-route parent host", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writePlacementTopology(appRoot, [
      renderTopologyEntry({
        id: "page.section-nav",
        owner: "catalog",
        surfaces: ["admin"],
        outlet: "catalog:sub-pages",
        linkRenderer: "local.main.ui.surface-aware-menu-link-item"
      }),
      renderTopologyEntry({
        id: "page.section-nav",
        owner: "catalog-products",
        surfaces: ["admin"],
        outlet: "catalog-products:sub-pages",
        linkRenderer: "local.main.ui.surface-aware-menu-link-item"
      })
    ]);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/catalog/index.vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="catalog:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );
    await writeFileInApp(
      appRoot,
      "src/pages/admin/catalog/index/products/index.vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="catalog-products:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/catalog/index/products/index/variants/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_TARGET__, "page.section-nav");
    assert.equal(context.__JSKIT_UI_LINK_OWNER_LINE__, "    owner: \"catalog-products\",\n");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "      to: \"./variants\",\n");
  });
});

test("buildUiPageTemplateContext infers subpage link placement from an index route hosted record page", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);
    await writePlacementTopology(appRoot, [
      renderTopologyEntry({
        id: "page.section-nav",
        owner: "customer-view",
        surfaces: ["admin"],
        outlet: "customer-view:sub-pages",
        linkRenderer: "local.main.ui.surface-aware-menu-link-item"
      })
    ]);
    await writeFileInApp(
      appRoot,
      "src/pages/admin/customers/[customerId]/index.vue",
      `<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="customer-view:sub-pages" />
    </template>
    <RouterView />
  </SectionContainerShell>
</template>
`
    );

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/customers/[customerId]/index/pets/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_TARGET__, "page.section-nav");
    assert.equal(context.__JSKIT_UI_LINK_OWNER_LINE__, "    owner: \"customer-view\",\n");
    assert.equal(context.__JSKIT_UI_LINK_COMPONENT_TOKEN__, "");
    assert.equal(context.__JSKIT_UI_LINK_TO_PROP_LINE__, "      to: \"./pets\",\n");
    assert.equal(context.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/customers/[customerId]/pets");
  });
});

test("buildUiPageTemplateContext derives the same visible route from file and index page shapes", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const fileContext = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/catalog.vue",
      options: {}
    });
    const indexContext = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/catalog/index.vue",
      options: {}
    });

    assert.equal(fileContext.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/catalog");
    assert.equal(indexContext.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/catalog");
    assert.equal(fileContext.__JSKIT_UI_LINK_PLACEMENT_ID__, "ui-generator.page.admin.catalog.link");
    assert.equal(indexContext.__JSKIT_UI_LINK_PLACEMENT_ID__, "ui-generator.page.admin.catalog.link");
  });
});

test("buildUiPageTemplateContext rejects target files with a leading src segment", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    await assert.rejects(
      () =>
        buildUiPageTemplateContext({
          appRoot,
          targetFile: "src/components/ReportsPanel.vue",
          options: {}
        }),
      /must be relative to src\/pages\/ or start with src\/pages\/:/
    );
  });
});

test("buildUiPageTemplateContext accepts target files with a src/pages prefix", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "src/pages/admin/reports/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_ID__, "ui-generator.page.admin.reports.link");
    assert.equal(context.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/reports");
  });
});

test("buildUiPageTemplateContext fails when the target file matches no surface", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    await assert.rejects(
      () =>
        buildUiPageTemplateContext({
          appRoot,
          targetFile: "reports/index.vue",
          options: {}
        }),
      /must be relative to src\/pages\/ and resolve to a configured surface/
    );
  });
});

test("buildUiPageTemplateContext chooses the most specific matching surface pagesRoot", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    app: { id: "app", pagesRoot: "", enabled: true },
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    const context = await buildUiPageTemplateContext({
      appRoot,
      targetFile: "admin/reports/index.vue",
      options: {}
    });

    assert.equal(context.__JSKIT_UI_LINK_PLACEMENT_ID__, "ui-generator.page.admin.reports.link");
    assert.equal(context.__JSKIT_UI_LINK_WORKSPACE_SUFFIX__, "/reports");
    assert.equal(context.__JSKIT_UI_LINK_NON_WORKSPACE_SUFFIX__, "/reports");
  });
});

test("buildUiPageTemplateContext validates link placement format", async () => {
  await withTempApp(async (appRoot) => {
    await writeConfig(
      appRoot,
      `export const config = {
  surfaceDefinitions: {
    admin: { id: "admin", pagesRoot: "admin", enabled: true }
  }
};
`
    );
    await writeShellLayout(appRoot);

    await assert.rejects(
      () =>
        buildUiPageTemplateContext({
          appRoot,
          targetFile: "admin/reports/index.vue",
          options: {
            "link-placement": "invalid-placement"
          }
        }),
      /option "placement" must be a semantic target in "area.slot" format/
    );
  });
});
