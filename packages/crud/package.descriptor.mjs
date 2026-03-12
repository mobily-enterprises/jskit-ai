export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/crud",
  version: "0.1.0",
  description: "Admin CRUD module with server routes, actions, persistence, and client pages.",
  options: {
    namespace: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "CRUD namespace",
      promptHint: "Optional slug prefix (blank = crud paths/tables)."
    },
    visibility: {
      required: true,
      inputType: "text",
      defaultValue: "workspace",
      promptLabel: "Route visibility",
      promptHint: "public | workspace | user | workspace_user"
    },
    "directory-prefix": {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "Page directory prefix",
      promptHint: "Optional path under src/pages/admin (example: crm or ops/team-a)."
    }
  },
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/shell-web",
    "@jskit-ai/users-core",
    "@jskit-ai/users-web"
  ],
  capabilities: {
    provides: ["crud"],
    requires: ["runtime.actions", "runtime.database", "auth.policy", "users.core", "users.web", "runtime.web-placement"]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/CrudServiceProvider.js",
          export: "CrudServiceProvider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server",
          summary: "Exports CrudServiceProvider and the CRUD server feature."
        },
        {
          subpath: "./shared",
          summary: "Exports shared CRUD resources and module config helpers."
        },
        {
          subpath: "./client/*",
          summary: "Exports CRUD Vue client elements."
        }
      ],
      containerTokens: {
        server: ["crud.repository", "crud.service"],
        client: []
      }
    },
    server: {
      routes: [
        { method: "GET", path: "/api/w/:workspaceSlug/workspace/crud", summary: "List records (default workspace mode)." },
        { method: "GET", path: "/api/w/:workspaceSlug/workspace/crud/:contactId", summary: "View a record (default workspace mode)." },
        { method: "POST", path: "/api/w/:workspaceSlug/workspace/crud", summary: "Create a record (default workspace mode)." },
        { method: "PATCH", path: "/api/w/:workspaceSlug/workspace/crud/:contactId", summary: "Update a record (default workspace mode)." },
        { method: "DELETE", path: "/api/w/:workspaceSlug/workspace/crud/:contactId", summary: "Delete a record (default workspace mode)." }
      ]
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/auth-core": "0.1.0",
        "@jskit-ai/database-runtime": "0.1.0",
        "@jskit-ai/http-runtime": "0.1.0",
        "@jskit-ai/kernel": "0.1.0",
        "@jskit-ai/shell-web": "0.1.0",
        "@jskit-ai/users-core": "0.1.0",
        "@jskit-ai/users-web": "0.1.0",
        "@local/${option:namespace|kebab|default(crud)}": "file:packages/${option:namespace|kebab|default(crud)}",
        "@tanstack/vue-query": "^5.90.5",
        "typebox": "^1.0.81",
        "vuetify": "^4.0.0"
      },
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [
      {
        op: "install-migration",
        from: "templates/migrations/crud_initial.cjs",
        toDir: "migrations",
        slug: "crud_initial_${option:namespace|snake|default(crud)}",
        extension: ".cjs",
        reason: "Install CRUD schema migration.",
        category: "crud",
        id: "crud-initial-schema-${option:namespace|snake|default(crud)}"
      },
      {
        from: "templates/src/local-package/package.json",
        to: "packages/${option:namespace|kebab|default(crud)}/package.json",
        reason: "Install app-local CRUD client package.",
        category: "crud",
        id: "crud-local-package-json-${option:namespace|snake|default(crud)}"
      },
      {
        from: "templates/src/local-package/client/index.js",
        to: "packages/${option:namespace|kebab|default(crud)}/src/client/index.js",
        reason: "Install app-local CRUD client package exports.",
        category: "crud",
        id: "crud-local-package-client-index-${option:namespace|snake|default(crud)}"
      },
      {
        from: "templates/src/elements/clientSupport.js",
        to: "packages/${option:namespace|kebab|default(crud)}/src/client/clientSupport.js",
        reason: "Install app-local CRUD client support helpers.",
        category: "crud",
        id: "crud-local-package-client-support-${option:namespace|snake|default(crud)}"
      },
      {
        from: "templates/src/elements/ListElement.vue",
        to: "packages/${option:namespace|kebab|default(crud)}/src/client/List${option:namespace|plural|pascal|default(CrudRecords)}Element.vue",
        reason: "Install app-local CRUD list element.",
        category: "crud",
        id: "crud-local-package-client-list-${option:namespace|snake|default(crud)}"
      },
      {
        from: "templates/src/elements/ViewElement.vue",
        to: "packages/${option:namespace|kebab|default(crud)}/src/client/View${option:namespace|singular|pascal|default(CrudRecord)}Element.vue",
        reason: "Install app-local CRUD view element.",
        category: "crud",
        id: "crud-local-package-client-view-${option:namespace|snake|default(crud)}"
      },
      {
        from: "templates/src/elements/CreateElement.vue",
        to: "packages/${option:namespace|kebab|default(crud)}/src/client/Create${option:namespace|singular|pascal|default(CrudRecord)}Element.vue",
        reason: "Install app-local CRUD create element.",
        category: "crud",
        id: "crud-local-package-client-create-${option:namespace|snake|default(crud)}"
      },
      {
        from: "templates/src/elements/EditElement.vue",
        to: "packages/${option:namespace|kebab|default(crud)}/src/client/Edit${option:namespace|singular|pascal|default(CrudRecord)}Element.vue",
        reason: "Install app-local CRUD edit element.",
        category: "crud",
        id: "crud-local-package-client-edit-${option:namespace|snake|default(crud)}"
      },
      {
        from: "templates/src/pages/admin/crud/index.vue",
        to: "src/pages/admin/${option:directory-prefix|pathprefix}${option:namespace|kebab|default(crud)}/index.vue",
        reason: "Install admin CRUD list page scaffold.",
        category: "crud",
        id: "crud-page-admin-crud-index"
      },
      {
        from: "templates/src/pages/admin/crud/new.vue",
        to: "src/pages/admin/${option:directory-prefix|pathprefix}${option:namespace|kebab|default(crud)}/new.vue",
        reason: "Install admin CRUD create page scaffold.",
        category: "crud",
        id: "crud-page-admin-crud-new"
      },
      {
        from: "templates/src/pages/admin/crud/[contactId]/index.vue",
        to: "src/pages/admin/${option:directory-prefix|pathprefix}${option:namespace|kebab|default(crud)}/[contactId]/index.vue",
        reason: "Install admin CRUD detail page scaffold.",
        category: "crud",
        id: "crud-page-admin-crud-view"
      },
      {
        from: "templates/src/pages/admin/crud/[contactId]/edit.vue",
        to: "src/pages/admin/${option:directory-prefix|pathprefix}${option:namespace|kebab|default(crud)}/[contactId]/edit.vue",
        reason: "Install admin CRUD edit page scaffold.",
        category: "crud",
        id: "crud-page-admin-crud-edit"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.crud.visibility = \"${option:visibility}\";",
        value:
          "\nconfig.crud = config.crud || {};\nconfig.crud.namespace = \"${option:namespace|kebab}\";\nconfig.crud.visibility = \"${option:visibility}\";\n",
        reason: "Append CRUD module configuration into app-owned public config.",
        category: "crud",
        id: "crud-public-config"
      },
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.crud.directoryPrefix =",
        value: "\nconfig.crud.directoryPrefix = \"${option:directory-prefix|path}\";\n",
        reason: "Append CRUD page directory prefix into app-owned public config.",
        category: "crud",
        id: "crud-public-config-directory-prefix"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "jskit:crud.menu:${option:namespace|kebab}",
        value:
          "\n// jskit:crud.menu:${option:namespace|kebab}\nconst crudNamespace = \"${option:namespace|kebab}\";\nconst crudDirectoryPrefix = \"${option:directory-prefix|path}\";\nconst crudBaseSegment = crudNamespace || \"crud\";\nconst crudRoutePath = crudDirectoryPrefix\n  ? \"/\" + crudDirectoryPrefix + \"/\" + crudBaseSegment\n  : \"/\" + crudBaseSegment;\nconst crudPlacementId = crudNamespace\n  ? \"crud.\" + crudNamespace + \".menu\"\n  : \"crud.menu\";\n\naddPlacement({\n  id: crudPlacementId,\n  slot: \"app.primary-menu\",\n  surface: \"admin\",\n  order: 150,\n  componentToken: \"users.web.shell.surface-aware-menu-link-item\",\n  props: {\n    label: \"${option:namespace|plural|pascal|default(CrudRecords)}\",\n    surface: \"admin\",\n    workspaceSuffix: crudRoutePath,\n    nonWorkspaceSuffix: crudRoutePath\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append admin Crud menu placement into app-owned placement registry.",
        category: "crud",
        id: "crud-placement-menu"
      }
    ]
  }
});
