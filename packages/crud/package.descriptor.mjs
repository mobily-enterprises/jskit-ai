export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/crud",
  version: "0.1.0",
  installationMode: "clone-only",
  description: "Admin CRUD module with server routes, actions, persistence, and client pages.",
  options: {
    namespace: {
      required: true,
      inputType: "text",
      defaultValue: "",
      promptLabel: "CRUD namespace",
      promptHint: "Required slug (example: customers, appointments, vendors)."
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
    "@jskit-ai/crud-core",
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
          summary: "Scaffold package runtime provider (no-op) plus reference CRUD server modules."
        },
        {
          subpath: "./shared",
          summary: "Exports shared CRUD resource and module config helpers."
        },
        {
          subpath: "./client/*",
          summary: "Exports CRUD Vue client elements."
        }
      ],
      containerTokens: {
        server: ["crud.<namespace>.repository", "crud.<namespace>.service"],
        client: []
      }
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@jskit-ai/auth-core": "0.1.0",
        "@jskit-ai/crud-core": "0.1.0",
        "@jskit-ai/database-runtime": "0.1.0",
        "@jskit-ai/http-runtime": "0.1.0",
        "@jskit-ai/kernel": "0.1.0",
        "@jskit-ai/shell-web": "0.1.0",
        "@jskit-ai/users-core": "0.1.0",
        "@jskit-ai/users-web": "0.1.0",
        "@local/${option:namespace|kebab}": "file:packages/${option:namespace|kebab}",
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
        slug: "crud_initial_${option:namespace|snake}",
        extension: ".cjs",
        reason: "Install CRUD schema migration.",
        category: "crud",
        id: "crud-initial-schema-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/package.json",
        to: "packages/${option:namespace|kebab}/package.json",
        reason: "Install app-local CRUD package manifest.",
        category: "crud",
        id: "crud-local-package-json-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/package.descriptor.mjs",
        to: "packages/${option:namespace|kebab}/package.descriptor.mjs",
        reason: "Install app-local CRUD package descriptor.",
        category: "crud",
        id: "crud-local-package-descriptor-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/client/index.js",
        to: "packages/${option:namespace|kebab}/src/client/index.js",
        reason: "Install app-local CRUD client package exports.",
        category: "crud",
        id: "crud-local-package-client-index-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/server/index.js",
        to: "packages/${option:namespace|kebab}/src/server/index.js",
        reason: "Install app-local CRUD server exports.",
        category: "crud",
        id: "crud-local-package-server-index-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/server/CrudServiceProvider.js",
        to: "packages/${option:namespace|kebab}/src/server/${option:namespace|pascal}ServiceProvider.js",
        reason: "Install app-local CRUD server provider.",
        category: "crud",
        id: "crud-local-package-server-provider-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/server/actions.js",
        to: "packages/${option:namespace|kebab}/src/server/actions.js",
        reason: "Install app-local CRUD action definitions.",
        category: "crud",
        id: "crud-local-package-server-actions-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/server/actionIds.js",
        to: "packages/${option:namespace|kebab}/src/server/actionIds.js",
        reason: "Install app-local CRUD action IDs.",
        category: "crud",
        id: "crud-local-package-server-action-ids-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/server/registerRoutes.js",
        to: "packages/${option:namespace|kebab}/src/server/registerRoutes.js",
        reason: "Install app-local CRUD route registration.",
        category: "crud",
        id: "crud-local-package-server-routes-${option:namespace|snake}"
      },
      {
        from: "src/server/repository.js",
        to: "packages/${option:namespace|kebab}/src/server/repository.js",
        reason: "Install app-local CRUD repository.",
        category: "crud",
        id: "crud-local-package-server-repository-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/server/service.js",
        to: "packages/${option:namespace|kebab}/src/server/service.js",
        reason: "Install app-local CRUD service.",
        category: "crud",
        id: "crud-local-package-server-service-${option:namespace|snake}"
      },
      {
        from: "templates/src/local-package/shared/index.js",
        to: "packages/${option:namespace|kebab}/src/shared/index.js",
        reason: "Install app-local CRUD shared exports.",
        category: "crud",
        id: "crud-local-package-shared-index-${option:namespace|snake}"
      },
      {
        from: "src/shared/crud/crudResource.js",
        to: "packages/${option:namespace|kebab}/src/shared/crudResource.js",
        reason: "Install app-local CRUD resource.",
        category: "crud",
        id: "crud-local-package-shared-resource-${option:namespace|snake}"
      },
      {
        from: "templates/src/elements/clientSupport.js",
        to: "packages/${option:namespace|kebab}/src/client/clientSupport.js",
        reason: "Install app-local CRUD client support helpers.",
        category: "crud",
        id: "crud-local-package-client-support-${option:namespace|snake}"
      },
      {
        from: "templates/src/elements/ListElement.vue",
        to: "packages/${option:namespace|kebab}/src/client/List${option:namespace|plural|pascal}Element.vue",
        reason: "Install app-local CRUD list element.",
        category: "crud",
        id: "crud-local-package-client-list-${option:namespace|snake}"
      },
      {
        from: "templates/src/elements/ViewElement.vue",
        to: "packages/${option:namespace|kebab}/src/client/View${option:namespace|singular|pascal}Element.vue",
        reason: "Install app-local CRUD view element.",
        category: "crud",
        id: "crud-local-package-client-view-${option:namespace|snake}"
      },
      {
        from: "templates/src/elements/CreateElement.vue",
        to: "packages/${option:namespace|kebab}/src/client/Create${option:namespace|singular|pascal}Element.vue",
        reason: "Install app-local CRUD create element.",
        category: "crud",
        id: "crud-local-package-client-create-${option:namespace|snake}"
      },
      {
        from: "templates/src/elements/EditElement.vue",
        to: "packages/${option:namespace|kebab}/src/client/Edit${option:namespace|singular|pascal}Element.vue",
        reason: "Install app-local CRUD edit element.",
        category: "crud",
        id: "crud-local-package-client-edit-${option:namespace|snake}"
      },
      {
        from: "templates/src/pages/admin/crud/index.vue",
        to: "src/pages/admin/${option:directory-prefix|pathprefix}${option:namespace|kebab}/index.vue",
        reason: "Install admin CRUD list page scaffold.",
        category: "crud",
        id: "crud-page-admin-crud-index"
      },
      {
        from: "templates/src/pages/admin/crud/new.vue",
        to: "src/pages/admin/${option:directory-prefix|pathprefix}${option:namespace|kebab}/new.vue",
        reason: "Install admin CRUD create page scaffold.",
        category: "crud",
        id: "crud-page-admin-crud-new"
      },
      {
        from: "templates/src/pages/admin/crud/[recordId]/index.vue",
        to: "src/pages/admin/${option:directory-prefix|pathprefix}${option:namespace|kebab}/[recordId]/index.vue",
        reason: "Install admin CRUD detail page scaffold.",
        category: "crud",
        id: "crud-page-admin-crud-view"
      },
      {
        from: "templates/src/pages/admin/crud/[recordId]/edit.vue",
        to: "src/pages/admin/${option:directory-prefix|pathprefix}${option:namespace|kebab}/[recordId]/edit.vue",
        reason: "Install admin CRUD edit page scaffold.",
        category: "crud",
        id: "crud-page-admin-crud-edit"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "jskit:crud.menu:${option:namespace|kebab}:${option:directory-prefix|path}",
        value:
          "\n// jskit:crud.menu:${option:namespace|kebab}:${option:directory-prefix|path}\n{\n  const crudNamespace = \"${option:namespace|kebab}\";\n  const crudDirectoryPrefix = \"${option:directory-prefix|path}\";\n  const crudRoutePath = crudDirectoryPrefix\n    ? \"/\" + crudDirectoryPrefix + \"/\" + crudNamespace\n    : \"/\" + crudNamespace;\n\n  addPlacement({\n    id: \"crud.\" + crudNamespace + \".menu\",\n    slot: \"app.primary-menu\",\n    surface: \"admin\",\n    order: 150,\n    componentToken: \"users.web.shell.surface-aware-menu-link-item\",\n    props: {\n      label: \"${option:namespace|plural|pascal}\",\n      surface: \"admin\",\n      workspaceSuffix: crudRoutePath,\n      nonWorkspaceSuffix: crudRoutePath\n    },\n    when: ({ auth }) => Boolean(auth?.authenticated)\n  });\n}\n",
        reason: "Append admin Crud menu placement into app-owned placement registry.",
        category: "crud",
        id: "crud-placement-menu"
      }
    ]
  }
});
