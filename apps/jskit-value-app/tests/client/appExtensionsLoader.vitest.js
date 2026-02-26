import { describe, expect, it } from "vitest";
import { loadClientAppExtensions } from "../../src/app/loadExtensions.client.js";

describe("client app extension loader", () => {
  it("sorts entries and composes merged contributions", () => {
    const bundle = loadClientAppExtensions({
      modules: {
        "./extensions.d/20-second.client.js": {
          default: {
            id: "second",
            order: 20,
            navigation: [{ id: "settings", surface: "admin" }]
          }
        },
        "./extensions.d/10-first.client.js": {
          default: {
            id: "first",
            order: 10,
            routeFragments: [{ id: "projects", surface: "admin" }],
            moduleContributions: [{ moduleId: "projects", client: { router: { admin: { includeWorkspaceSettings: true } } } }]
          }
        }
      }
    });

    expect(bundle.entries.map((entry) => entry.id)).toEqual(["first", "second"]);
    expect(bundle.routeFragments).toEqual([{ id: "projects", surface: "admin" }]);
    expect(bundle.navigation).toEqual([{ id: "settings", surface: "admin" }]);
    expect(bundle.moduleContributions).toHaveLength(1);
  });

  it("rejects duplicate extension ids", () => {
    expect(() =>
      loadClientAppExtensions({
        modules: {
          "./extensions.d/10-one.client.js": { default: { id: "duplicate" } },
          "./extensions.d/20-two.client.js": { default: { id: "duplicate" } }
        }
      })
    ).toThrow(/client extension id "duplicate" is duplicated/);
  });

  it("rejects unknown keys", () => {
    expect(() =>
      loadClientAppExtensions({
        modules: {
          "./extensions.d/10-invalid.client.js": {
            default: {
              id: "invalid",
              unsupported: true
            }
          }
        }
      })
    ).toThrow(/unsupported key "unsupported"/);
  });

  it("rejects duplicate route fragments on the same surface", () => {
    expect(() =>
      loadClientAppExtensions({
        modules: {
          "./extensions.d/10-one.client.js": {
            default: {
              id: "one",
              routeFragments: [{ id: "projects", surface: "admin" }]
            }
          },
          "./extensions.d/20-two.client.js": {
            default: {
              id: "two",
              routeFragments: [{ id: "projects", surface: "admin" }]
            }
          }
        }
      })
    ).toThrow(/route fragment id "admin:projects" is duplicated/);
  });
});
