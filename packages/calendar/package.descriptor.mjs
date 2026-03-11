export default Object.freeze({
  packageVersion: 1,
  packageId: "@jskit-ai/calendar",
  version: "0.1.0",
  description: "Workspace appointment calendar module with FullCalendar week view and contact-linked events.",
  dependsOn: [
    "@jskit-ai/auth-core",
    "@jskit-ai/crud",
    "@jskit-ai/database-runtime",
    "@jskit-ai/http-runtime",
    "@jskit-ai/users-web"
  ],
  capabilities: {
    provides: ["calendar.completeCalendar"],
    requires: ["runtime.actions", "runtime.database", "auth.policy", "users.web"]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/CalendarServiceProvider.js",
          export: "CalendarServiceProvider"
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
          summary: "Exports CalendarServiceProvider and complete calendar server feature."
        },
        {
          subpath: "./shared",
          summary: "Exports shared complete calendar resource validators."
        },
        {
          subpath: "./client/completeCalendar/*",
          summary: "Exports complete calendar Vue client elements."
        }
      ],
      containerTokens: {
        server: ["calendar.completeCalendar.repository", "calendar.completeCalendar.service"],
        client: []
      }
    },
    server: {
      routes: [
        { method: "GET", path: "/api/w/:workspaceSlug/workspace/calendar/events", summary: "List calendar events for the selected week." },
        { method: "GET", path: "/api/w/:workspaceSlug/workspace/calendar/events/:eventId", summary: "View a calendar event." },
        { method: "POST", path: "/api/w/:workspaceSlug/workspace/calendar/events", summary: "Create a calendar event." },
        { method: "PATCH", path: "/api/w/:workspaceSlug/workspace/calendar/events/:eventId", summary: "Update a calendar event." },
        { method: "DELETE", path: "/api/w/:workspaceSlug/workspace/calendar/events/:eventId", summary: "Delete a calendar event." }
      ]
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "@fullcalendar/core": "^6.1.17",
        "@fullcalendar/interaction": "^6.1.17",
        "@fullcalendar/timegrid": "^6.1.17",
        "@fullcalendar/vue3": "^6.1.17",
        "@jskit-ai/auth-core": "0.1.0",
        "@jskit-ai/crud": "0.1.0",
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
        from: "templates/migrations/calendar_events_initial.cjs",
        toDir: "migrations",
        slug: "calendar_events_initial",
        extension: ".cjs",
        reason: "Install calendar events schema migration.",
        category: "calendar",
        id: "calendar-events-initial-schema"
      },
      {
        from: "templates/src/pages/admin/calendar/index.vue",
        to: "src/pages/admin/calendar/index.vue",
        reason: "Install admin calendar week page scaffold.",
        category: "calendar",
        id: "calendar-page-admin-calendar-index"
      },
      {
        from: "templates/src/pages/admin/calendar/events/[eventId]/index.vue",
        to: "src/pages/admin/calendar/events/[eventId]/index.vue",
        reason: "Install admin calendar event view page scaffold.",
        category: "calendar",
        id: "calendar-page-admin-calendar-event-view"
      }
    ],
    text: [
      {
        op: "append-text",
        file: "src/placement.js",
        position: "bottom",
        skipIfContains: "id: \"calendar.complete.menu\"",
        value:
          "\naddPlacement({\n  id: \"calendar.complete.menu\",\n  slot: \"app.primary-menu\",\n  surface: \"admin\",\n  order: 160,\n  componentToken: \"users.web.shell.surface-aware-menu-link-item\",\n  props: {\n    label: \"Calendar\",\n    surface: \"admin\",\n    workspaceSuffix: \"/calendar\",\n    nonWorkspaceSuffix: \"/calendar\"\n  },\n  when: ({ auth }) => Boolean(auth?.authenticated)\n});\n",
        reason: "Append admin Calendar menu placement into app-owned placement registry.",
        category: "calendar",
        id: "calendar-placement-menu"
      }
    ]
  }
});
