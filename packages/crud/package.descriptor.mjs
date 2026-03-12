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
          subpath: "./client/contacts/*",
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
        slug: "crud_initial_${option:namespace}",
        extension: ".cjs",
        reason: "Install CRUD schema migration.",
        category: "crud",
        id: "crud-initial-schema-${option:namespace}"
      },
      {
        from: "templates/src/pages/admin/crud/index.vue",
        to: "src/pages/admin/w/[workspaceSlug]/${option:namespace}/crud/index.vue",
        when: {
          option: "visibility",
          in: ["workspace", "workspace_user"]
        },
        reason: "Install admin workspace CRUD list page scaffold.",
        category: "crud",
        id: "crud-page-admin-workspace-crud-index"
      },
      {
        from: "templates/src/pages/admin/crud/new.vue",
        to: "src/pages/admin/w/[workspaceSlug]/${option:namespace}/crud/new.vue",
        when: {
          option: "visibility",
          in: ["workspace", "workspace_user"]
        },
        reason: "Install admin workspace CRUD create page scaffold.",
        category: "crud",
        id: "crud-page-admin-workspace-crud-new"
      },
      {
        from: "templates/src/pages/admin/crud/[contactId]/index.vue",
        to: "src/pages/admin/w/[workspaceSlug]/${option:namespace}/crud/[contactId]/index.vue",
        when: {
          option: "visibility",
          in: ["workspace", "workspace_user"]
        },
        reason: "Install admin workspace CRUD detail page scaffold.",
        category: "crud",
        id: "crud-page-admin-workspace-crud-view"
      },
      {
        from: "templates/src/pages/admin/crud/[contactId]/edit.vue",
        to: "src/pages/admin/w/[workspaceSlug]/${option:namespace}/crud/[contactId]/edit.vue",
        when: {
          option: "visibility",
          in: ["workspace", "workspace_user"]
        },
        reason: "Install admin workspace CRUD edit page scaffold.",
        category: "crud",
        id: "crud-page-admin-workspace-crud-edit"
      },
      {
        from: "templates/src/pages/admin/crud/index.vue",
        to: "src/pages/admin/${option:namespace}/crud/index.vue",
        when: {
          option: "visibility",
          in: ["public", "user"]
        },
        reason: "Install admin CRUD list page scaffold.",
        category: "crud",
        id: "crud-page-admin-global-crud-index"
      },
      {
        from: "templates/src/pages/admin/crud/new.vue",
        to: "src/pages/admin/${option:namespace}/crud/new.vue",
        when: {
          option: "visibility",
          in: ["public", "user"]
        },
        reason: "Install admin CRUD create page scaffold.",
        category: "crud",
        id: "crud-page-admin-global-crud-new"
      },
      {
        from: "templates/src/pages/admin/crud/[contactId]/index.vue",
        to: "src/pages/admin/${option:namespace}/crud/[contactId]/index.vue",
        when: {
          option: "visibility",
          in: ["public", "user"]
        },
        reason: "Install admin CRUD detail page scaffold.",
        category: "crud",
        id: "crud-page-admin-global-crud-view"
      },
      {
        from: "templates/src/pages/admin/crud/[contactId]/edit.vue",
        to: "src/pages/admin/${option:namespace}/crud/[contactId]/edit.vue",
        when: {
          option: "visibility",
          in: ["public", "user"]
        },
        reason: "Install admin CRUD edit page scaffold.",
        category: "crud",
        id: "crud-page-admin-global-crud-edit"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.crud.visibility = \"${option:visibility}\";",
        value:
          "\nconfig.crud = config.crud || {};\nconfig.crud.namespace = \"${option:namespace}\";\nconfig.crud.visibility = \"${option:visibility}\";\n",
        reason: "Append CRUD module configuration into app-owned public config.",
        category: "crud",
        id: "crud-public-config"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "jskit:crud.menu:${option:namespace}",
        value:
          "\n// jskit:crud.menu:${option:namespace}\nconst crudNamespace = \"${option:namespace}\".trim().toLowerCase();\nconst crudNamespacePath = crudNamespace ? \"/\" + crudNamespace : \"\";\nconst crudPlacementId = crudNamespace\n  ? \"crud.\" + crudNamespace + \".menu\"\n  : \"crud.menu\";\n\naddPlacement({\n  id: crudPlacementId,\n  slot: \"app.primary-menu\",\n  surface: \"admin\",\n  order: 150,\n  componentToken: \"users.web.shell.surface-aware-menu-link-item\",\n  props: {\n    label: \"Crud\",\n    surface: \"admin\",\n    workspaceSuffix: crudNamespacePath + \"/crud\",\n    nonWorkspaceSuffix: crudNamespacePath + \"/crud\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append admin Crud menu placement into app-owned placement registry.",
        category: "crud",
        id: "crud-placement-menu"
      }
    ]
  }
});
