<script setup>
import { computed } from "vue";
import { Link, Outlet, useRouterState } from "@tanstack/vue-router";
import { listShellEntriesBySlot, resolveSurfaceFromPathname } from "./filesystemHost.js";
import { evaluateShellGuard } from "./guardRuntime.js";

const currentPath = useRouterState({
  select: (state) => state.location.pathname
});

const currentSurface = computed(() => resolveSurfaceFromPathname(currentPath.value));
const shellEntries = computed(() => listShellEntriesBySlot(currentSurface.value));

function filterEntriesByGuard(entries) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const outcome = evaluateShellGuard({
      guard: entry?.guard,
      phase: "navigation",
      context: {
        pathname: currentPath.value,
        surface: currentSurface.value,
        slot: entry?.slot || ""
      }
    });

    return outcome.allow;
  });
}

const drawerEntries = computed(() => filterEntriesByGuard(shellEntries.value.drawer));
const topEntries = computed(() => filterEntriesByGuard(shellEntries.value.top));
const configEntries = computed(() => filterEntriesByGuard(shellEntries.value.config));

const surfaceLabel = computed(() => {
  const surface = String(currentSurface.value || "app");
  return surface.charAt(0).toUpperCase() + surface.slice(1);
});

function isActive(pathname) {
  const current = String(currentPath.value || "");
  const target = String(pathname || "");
  if (!target || target === "/") {
    return current === "/";
  }
  return current === target || current.startsWith(`${target}/`);
}
</script>

<template>
  <div class="shell-host">
    <header class="shell-topbar">
      <div class="surface-pill">{{ surfaceLabel }} surface</div>

      <nav class="top-nav" aria-label="Top navigation">
        <Link
          v-for="entry in topEntries"
          :key="entry.id"
          :to="entry.resolvedRoute"
          class="top-nav-link"
          :class="{ 'is-active': isActive(entry.resolvedRoute) }"
        >
          {{ entry.title }}
        </Link>
      </nav>

      <div class="top-menus">
        <details class="menu-popover">
          <summary>Settings</summary>
          <div class="menu-popover-content">
            <Link v-for="entry in configEntries" :key="entry.id" :to="entry.resolvedRoute" class="menu-link">
              {{ entry.title }}
            </Link>
            <span v-if="configEntries.length < 1" class="menu-empty">No config entries</span>
          </div>
        </details>

        <details class="menu-popover">
          <summary>User</summary>
          <div class="menu-popover-content">
            <span class="menu-empty">Profile</span>
            <span class="menu-empty">Sign out</span>
          </div>
        </details>
      </div>
    </header>

    <div class="shell-body">
      <aside class="shell-drawer" aria-label="Drawer navigation">
        <h2 class="drawer-title">Navigation</h2>
        <nav class="drawer-nav">
          <Link
            v-for="entry in drawerEntries"
            :key="entry.id"
            :to="entry.resolvedRoute"
            class="drawer-link"
            :class="{ 'is-active': isActive(entry.resolvedRoute) }"
          >
            {{ entry.title }}
          </Link>
        </nav>
      </aside>

      <main class="shell-content">
        <Outlet />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell-host {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #f5f7f9;
  color: #20252b;
  font-family: "Helvetica Neue", Arial, sans-serif;
}

.shell-topbar {
  height: 56px;
  border-bottom: 1px solid #d7dee7;
  background: #ffffff;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0 1rem;
}

.surface-pill {
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #5b6878;
  font-weight: 700;
}

.top-nav {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.top-nav-link {
  text-decoration: none;
  color: #445064;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0.34rem 0.62rem;
  font-size: 0.88rem;
}

.top-nav-link:hover {
  border-color: #d7dee7;
  background: #f7fafc;
}

.top-nav-link.is-active {
  background: #e8efff;
  color: #1948a6;
  border-color: #c8d8ff;
}

.top-menus {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.menu-popover {
  position: relative;
}

.menu-popover summary {
  list-style: none;
  cursor: pointer;
  border: 1px solid #d7dee7;
  border-radius: 8px;
  background: #ffffff;
  padding: 0.35rem 0.62rem;
  font-size: 0.84rem;
  color: #3f4a5b;
}

.menu-popover summary::-webkit-details-marker {
  display: none;
}

.menu-popover-content {
  position: absolute;
  right: 0;
  margin-top: 0.3rem;
  min-width: 190px;
  border: 1px solid #d7dee7;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 8px 28px rgba(23, 30, 42, 0.12);
  padding: 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  z-index: 10;
}

.menu-link {
  color: #2f3a4a;
  text-decoration: none;
  border-radius: 6px;
  padding: 0.42rem 0.5rem;
}

.menu-link:hover {
  background: #f4f7fb;
}

.menu-empty {
  color: #6e7a8d;
  font-size: 0.84rem;
  padding: 0.42rem 0.5rem;
}

.shell-body {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 240px 1fr;
}

.shell-drawer {
  border-right: 1px solid #d7dee7;
  background: #ffffff;
  padding: 1rem 0.75rem;
}

.drawer-title {
  margin: 0 0 0.6rem;
  padding: 0 0.4rem;
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #697589;
}

.drawer-nav {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.drawer-link {
  color: #3a4658;
  text-decoration: none;
  border-radius: 8px;
  padding: 0.45rem 0.5rem;
  border: 1px solid transparent;
}

.drawer-link:hover {
  border-color: #d7dee7;
  background: #f8fafc;
}

.drawer-link.is-active {
  background: #e8efff;
  color: #1948a6;
  border-color: #c8d8ff;
}

.shell-content {
  padding: 1.2rem;
  overflow: auto;
}

@media (max-width: 900px) {
  .shell-body {
    grid-template-columns: 1fr;
  }

  .shell-drawer {
    border-right: 0;
    border-bottom: 1px solid #d7dee7;
  }

  .shell-topbar {
    grid-template-columns: 1fr;
    height: auto;
    padding: 0.75rem;
    gap: 0.65rem;
  }
}
</style>
