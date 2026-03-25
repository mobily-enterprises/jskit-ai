export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/ui-generator",
  version: "0.1.0",
  installationMode: "clone-only",
  description: "Generate app-local list/view UI scaffolds from resource validators.",
  options: {
    namespace: {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "UI namespace",
      promptHint: "Required slug (example: contacts-alt, customers-ui, tickets-view)."
    },
    surface: {
      required: true,
      inputType: "text",
      defaultFromConfig: "surfaceDefaultId",
      promptLabel: "Target surface",
      promptHint: "Defaults to config.public.surfaceDefaultId. Must match an enabled surface id."
    },
    "resource-file": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Resource file",
      promptHint: "Relative path from app root to the resource module."
    },
    "resource-export": {
      required: false,
      inputType: "text",
      defaultValue: "crudResource",
      promptLabel: "Resource export",
      promptHint: "Named export in the resource module (default: crudResource)."
    },
    operations: {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Operations",
      promptHint: "Required: list, view, or list,view (comma-separated, no spaces recommended)."
    },
    "api-path": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "API path",
      promptHint: "Base API path without trailing id (example: /crud/contacts)."
    },
    "route-path": {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Route path",
      promptHint: "List route path under the target surface (example: crm/contacts-alt)."
    },
    "id-param": {
      required: false,
      inputType: "text",
      defaultValue: "recordId",
      promptLabel: "Route id param",
      promptHint: "Route param used by view pages (default: recordId)."
    },
    "directory-prefix": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Page directory prefix",
      promptHint: "Optional subpath under the selected surface pages root (example: crm or ops/team-a)."
    }
  },
  dependsOn: [],
  capabilities: {
    provides: ["ui-generator"],
    requires: []
  },
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/buildTemplateContext",
          summary: "Builds deterministic template context values from resource list/view validators."
        }
      ],
      containerTokens: {
        server: [],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/users-web": "0.1.31"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        from: "templates/src/pages/admin/ui-generator/uiSupport.js",
        toSurface: "${option:surface|lower}",
        toSurfacePath: "${option:directory-prefix|pathprefix}${option:route-path|path}/uiSupport.js",
        reason: "Install generated UI shared support helpers.",
        category: "ui-generator",
        id: "ui-generator-shared-support-${option:namespace|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        }
      },
      {
        from: "templates/src/pages/admin/ui-generator/ListElement.vue",
        toSurface: "${option:surface|lower}",
        toSurfacePath: "${option:directory-prefix|pathprefix}${option:route-path|path}/List${option:namespace|plural|pascal}Element.vue",
        reason: "Install generated list element.",
        category: "ui-generator",
        id: "ui-generator-list-element-${option:namespace|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          option: "operations",
          in: ["list", "list,view", "view,list", "list, view", "view, list"]
        }
      },
      {
        from: "templates/src/pages/admin/ui-generator/ViewElement.vue",
        toSurface: "${option:surface|lower}",
        toSurfacePath: "${option:directory-prefix|pathprefix}${option:route-path|path}/View${option:namespace|singular|pascal}Element.vue",
        reason: "Install generated view element.",
        category: "ui-generator",
        id: "ui-generator-view-element-${option:namespace|snake}",
        templateContext: {
          entrypoint: "src/server/buildTemplateContext.js",
          export: "buildUiTemplateContext"
        },
        when: {
          option: "operations",
          in: ["view", "list,view", "view,list", "list, view", "view, list"]
        }
      },
      {
        from: "templates/src/pages/admin/ui-generator/index.vue",
        toSurface: "${option:surface|lower}",
        toSurfacePath: "${option:directory-prefix|pathprefix}${option:route-path|path}/index.vue",
        reason: "Install generated list page scaffold.",
        category: "ui-generator",
        id: "ui-generator-page-list-${option:namespace|snake}",
        when: {
          option: "operations",
          in: ["list", "list,view", "view,list", "list, view", "view, list"]
        }
      },
      {
        from: "templates/src/pages/admin/ui-generator/[recordId]/index.vue",
        toSurface: "${option:surface|lower}",
        toSurfacePath: "${option:directory-prefix|pathprefix}${option:route-path|path}/[${option:id-param|trim}]/index.vue",
        reason: "Install generated view page scaffold.",
        category: "ui-generator",
        id: "ui-generator-page-view-${option:namespace|snake}",
        when: {
          option: "operations",
          in: ["view", "list,view", "view,list", "list, view", "view, list"]
        }
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "jskit:ui-generator.menu:${option:namespace|kebab}:${option:directory-prefix|path}:${option:route-path|path}",
        value:
          "\n// jskit:ui-generator.menu:${option:namespace|kebab}:${option:directory-prefix|path}:${option:route-path|path}\n{\n  addPlacement({\n    id: \"ui-generator.${option:namespace|kebab}.menu\",\n    host: \"shell-layout\",\n    position: \"primary-menu\",\n    surfaces: [\"${option:surface|lower}\"],\n    order: 155,\n    componentToken: \"users.web.shell.surface-aware-menu-link-item\",\n    props: {\n      label: \"${option:namespace|plural|pascal}\",\n      surface: \"${option:surface|lower}\",\n      workspaceSuffix: \"/${option:directory-prefix|pathprefix}${option:route-path|path}\",\n      nonWorkspaceSuffix: \"/${option:directory-prefix|pathprefix}${option:route-path|path}\"\n    },\n    when: ({ auth }) => Boolean(auth?.authenticated)\n  });\n}\n",
        reason: "Append generated UI menu placement.",
        category: "ui-generator",
        id: "ui-generator-placement-menu",
        when: {
          option: "operations",
          in: ["list", "list,view", "view,list", "list, view", "view, list"]
        }
      }
    ]
  }
});
