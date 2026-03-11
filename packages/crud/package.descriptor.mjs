export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/crud",
  version: "0.1.0",
  description: "Admin contacts CRUD module with server routes, actions, persistence, and client pages.",
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/users-web"
  ],
  capabilities: {
    provides: ["crud.contacts"],
    requires: ["runtime.actions", "runtime.database", "auth.policy", "users.web"]
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
          summary: "Exports shared contacts CRUD contracts and schemas."
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
        { method: "GET", path: "/api/contacts", summary: "List contacts." },
        { method: "GET", path: "/api/contacts/:contactId", summary: "View a contact." },
        { method: "POST", path: "/api/contacts", summary: "Create a contact." },
        { method: "PATCH", path: "/api/contacts/:contactId", summary: "Update a contact." },
        { method: "DELETE", path: "/api/contacts/:contactId", summary: "Delete a contact." }
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
        slug: "crud_contacts_initial",
        extension: ".cjs",
        reason: "Install contacts CRUD schema migration.",
        category: "crud",
        id: "crud-contacts-initial-schema"
      },
      {
        from: "templates/src/pages/admin/contacts/index.vue",
        to: "src/pages/admin/contacts/index.vue",
        reason: "Install admin contacts list page scaffold.",
        category: "crud",
        id: "crud-page-admin-contacts-index"
      },
      {
        from: "templates/src/pages/admin/contacts/new.vue",
        to: "src/pages/admin/contacts/new.vue",
        reason: "Install admin contacts create page scaffold.",
        category: "crud",
        id: "crud-page-admin-contacts-new"
      },
      {
        from: "templates/src/pages/admin/contacts/[contactId]/index.vue",
        to: "src/pages/admin/contacts/[contactId]/index.vue",
        reason: "Install admin contacts detail page scaffold.",
        category: "crud",
        id: "crud-page-admin-contacts-view"
      },
      {
        from: "templates/src/pages/admin/contacts/[contactId]/edit.vue",
        to: "src/pages/admin/contacts/[contactId]/edit.vue",
        reason: "Install admin contacts edit page scaffold.",
        category: "crud",
        id: "crud-page-admin-contacts-edit"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"crud.contacts.menu\"",
        value:
          "\naddPlacement({\n  id: \"crud.contacts.menu\",\n  slot: \"app.primary-menu\",\n  surface: \"admin\",\n  order: 150,\n  componentToken: \"users.web.shell.surface-aware-menu-link-item\",\n  props: {\n    label: \"Contacts\",\n    surface: \"admin\",\n    workspaceSuffix: \"/contacts\",\n    nonWorkspaceSuffix: \"/contacts\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append admin Contacts menu placement into app-owned placement registry.",
        category: "crud",
        id: "crud-placement-contacts-menu"
      }
    ]
  }
});
