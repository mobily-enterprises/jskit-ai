import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryHistory, createRouter } from "vue-router";
import { redirectToChild } from "./pageRedirects.js";

test("redirectToChild resolves a child path and preserves incoming query and hash", () => {
  const redirect = redirectToChild("general");

  assert.deepEqual(redirect({
    path: "/home/settings/",
    query: {
      tab: "profile"
    },
    hash: "#advanced"
  }), {
    path: "/home/settings/general",
    query: {
      tab: "profile"
    },
    hash: "#advanced"
  });
});

test("redirectToChild uses child query and hash when the target declares them", () => {
  const redirect = redirectToChild("general?tab=security&filter=a&filter=b#advanced");

  assert.deepEqual(redirect({
    path: "/home/settings",
    query: {
      stale: "value"
    },
    hash: "#old"
  }), {
    path: "/home/settings/general",
    query: {
      tab: "security",
      filter: ["a", "b"]
    },
    hash: "#advanced"
  });
});

test("redirectToChild can live on a host route that also renders a component", async () => {
  const hostComponent = { name: "ContactHost" };
  const childComponent = { name: "CommentsPage" };

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/contacts/:contactId",
        component: hostComponent,
        redirect: redirectToChild("comments"),
        children: [
          {
            path: "comments",
            component: childComponent
          }
        ]
      }
    ]
  });

  await router.push("/contacts/1?tab=open#details");
  await router.isReady();

  assert.equal(router.currentRoute.value.fullPath, "/contacts/1/comments?tab=open#details");
  assert.equal(router.currentRoute.value.matched.length, 2);
  assert.equal(router.currentRoute.value.matched[0]?.components?.default, hostComponent);
  assert.equal(router.currentRoute.value.matched[1]?.components?.default, childComponent);
});
