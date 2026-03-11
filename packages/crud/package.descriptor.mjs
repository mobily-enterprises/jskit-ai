export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/crud",
  version: "0.1.0",
  description: "Admin contacts CRUD module with server routes, actions, persistence, and client pages.",
  options: {
    namespace: {
      required: false,
      inputType: "text",
      defaultValue: "",
      promptLabel: "CRUD namespace",
      promptHint: "Optional slug prefix (blank = contacts paths/tables)."
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
    provides: ["crud.contacts"],
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
          summary: "Exports CrudServiceProvider and the contacts CRUD server feature."
        },
        {
          subpath: "./shared",
          summary: "Exports shared contacts CRUD resources and module config helpers."
        },
        {
          subpath: "./client/contacts/*",
          summary: "Exports contacts CRUD Vue client elements."
        }
      ],
      containerTokens: {
        server: ["crud.contacts.repository", "crud.contacts.service"],
        client: []
      }
    },
    server: {
      routes: [
        { method: "GET", path: "/api/w/:workspaceSlug/workspace/contacts", summary: "List contacts (default workspace mode)." },
        { method: "GET", path: "/api/w/:workspaceSlug/workspace/contacts/:contactId", summary: "View a contact (default workspace mode)." },
        { method: "POST", path: "/api/w/:workspaceSlug/workspace/contacts", summary: "Create a contact (default workspace mode)." },
        { method: "PATCH", path: "/api/w/:workspaceSlug/workspace/contacts/:contactId", summary: "Update a contact (default workspace mode)." },
        { method: "DELETE", path: "/api/w/:workspaceSlug/workspace/contacts/:contactId", summary: "Delete a contact (default workspace mode)." }
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
        from: "templates/migrations/crud_contacts_initial.cjs",
        toDir: "migrations",
        slug: "crud_contacts_initial_${option:namespace}",
        extension: ".cjs",
        reason: "Install contacts CRUD schema migration.",
        category: "crud",
        id: "crud-contacts-initial-schema-${option:namespace}"
      },
      {
        from: "templates/src/pages/admin/contacts/index.vue",
        to: "src/pages/admin/w/[workspaceSlug]/${option:namespace}/contacts/index.vue",
        when: {
          option: "visibility",
          in: ["workspace", "workspace_user"]
        },
        reason: "Install admin workspace contacts list page scaffold.",
        category: "crud",
        id: "crud-page-admin-workspace-contacts-index"
      },
      {
        from: "templates/src/pages/admin/contacts/new.vue",
        to: "src/pages/admin/w/[workspaceSlug]/${option:namespace}/contacts/new.vue",
        when: {
          option: "visibility",
          in: ["workspace", "workspace_user"]
        },
        reason: "Install admin workspace contacts create page scaffold.",
        category: "crud",
        id: "crud-page-admin-workspace-contacts-new"
      },
      {
        from: "templates/src/pages/admin/contacts/[contactId]/index.vue",
        to: "src/pages/admin/w/[workspaceSlug]/${option:namespace}/contacts/[contactId]/index.vue",
        when: {
          option: "visibility",
          in: ["workspace", "workspace_user"]
        },
        reason: "Install admin workspace contacts detail page scaffold.",
        category: "crud",
        id: "crud-page-admin-workspace-contacts-view"
      },
      {
        from: "templates/src/pages/admin/contacts/[contactId]/edit.vue",
        to: "src/pages/admin/w/[workspaceSlug]/${option:namespace}/contacts/[contactId]/edit.vue",
        when: {
          option: "visibility",
          in: ["workspace", "workspace_user"]
        },
        reason: "Install admin workspace contacts edit page scaffold.",
        category: "crud",
        id: "crud-page-admin-workspace-contacts-edit"
      },
      {
        from: "templates/src/pages/admin/contacts/index.vue",
        to: "src/pages/admin/${option:namespace}/contacts/index.vue",
        when: {
          option: "visibility",
          in: ["public", "user"]
        },
        reason: "Install admin contacts list page scaffold.",
        category: "crud",
        id: "crud-page-admin-global-contacts-index"
      },
      {
        from: "templates/src/pages/admin/contacts/new.vue",
        to: "src/pages/admin/${option:namespace}/contacts/new.vue",
        when: {
          option: "visibility",
          in: ["public", "user"]
        },
        reason: "Install admin contacts create page scaffold.",
        category: "crud",
        id: "crud-page-admin-global-contacts-new"
      },
      {
        from: "templates/src/pages/admin/contacts/[contactId]/index.vue",
        to: "src/pages/admin/${option:namespace}/contacts/[contactId]/index.vue",
        when: {
          option: "visibility",
          in: ["public", "user"]
        },
        reason: "Install admin contacts detail page scaffold.",
        category: "crud",
        id: "crud-page-admin-global-contacts-view"
      },
      {
        from: "templates/src/pages/admin/contacts/[contactId]/edit.vue",
        to: "src/pages/admin/${option:namespace}/contacts/[contactId]/edit.vue",
        when: {
          option: "visibility",
          in: ["public", "user"]
        },
        reason: "Install admin contacts edit page scaffold.",
        category: "crud",
        id: "crud-page-admin-global-contacts-edit"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "config/public.js",
        position: "bottom",
        skipIfContains: "config.crud.contacts.visibility = \"${option:visibility}\";",
        value:
          "\nconfig.crud = config.crud || {};\nconfig.crud.contacts = config.crud.contacts || {};\nconfig.crud.contacts.namespace = \"${option:namespace}\";\nconfig.crud.contacts.visibility = \"${option:visibility}\";\n",
        reason: "Append contacts CRUD module configuration into app-owned public config.",
        category: "crud",
        id: "crud-public-config"
      },
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "jskit:crud.contacts.menu:${option:namespace}",
        value:
          "\n// jskit:crud.contacts.menu:${option:namespace}\nconst crudContactsNamespace = \"${option:namespace}\".trim().toLowerCase();\nconst crudContactsNamespacePath = crudContactsNamespace ? \"/\" + crudContactsNamespace : \"\";\nconst crudContactsPlacementId = crudContactsNamespace\n  ? \"crud.\" + crudContactsNamespace + \".contacts.menu\"\n  : \"crud.contacts.menu\";\n\naddPlacement({\n  id: crudContactsPlacementId,\n  slot: \"app.primary-menu\",\n  surface: \"admin\",\n  order: 150,\n  componentToken: \"users.web.shell.surface-aware-menu-link-item\",\n  props: {\n    label: \"Contacts\",\n    surface: \"admin\",\n    workspaceSuffix: crudContactsNamespacePath + \"/contacts\",\n    nonWorkspaceSuffix: crudContactsNamespacePath + \"/contacts\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append admin Contacts menu placement into app-owned placement registry.",
        category: "crud",
        id: "crud-placement-contacts-menu"
      }
    ]
  }
});
