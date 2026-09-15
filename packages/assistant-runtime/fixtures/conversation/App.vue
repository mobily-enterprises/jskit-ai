<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTheme } from "vuetify";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import AssistantSurfaceClientElement from "../../src/client/components/AssistantSurfaceClientElement.vue";
const route = useRoute();
const router = useRouter();
const theme = useTheme();
const { context, mergeContext } = useWebPlacementContext();
const mounted = ref(true);
const second = ref(false);
const compact = ref(false);
const surface = ref("admin");
const workspace = computed(() => route.query.workspace || "alpha");
function switchWorkspace() { router.push({ query: { workspace: workspace.value === "alpha" ? "beta" : "alpha" } }); }
</script>
<template>
  <v-app>
    <v-main>
      <div class="fixture">
        <nav aria-label="Fixture controls">
          <button @click="switchWorkspace">Switch workspace</button>
          <button @click="mergeContext({ user: { id: context.user.id === '1' ? '2' : '1' } })">Switch user</button>
          <button @click="surface = surface === 'admin' ? 'console' : 'admin'">Switch surface</button>
          <button @click="mounted = !mounted">Toggle view</button>
          <button @click="second = !second">Second instance</button>
          <button @click="compact = !compact">Resize pane</button>
          <button @click="theme.change(theme.global.name.value === 'dark' ? 'light' : 'dark')">Toggle theme</button>
        </nav>
        <div class="fixture__panes" :class="{ 'fixture__panes--compact': compact }">
          <AssistantSurfaceClientElement v-if="mounted" :surface-id="surface" :layout="compact ? 'compact' : 'page'" assistant-label="Fixture assistant" />
          <AssistantSurfaceClientElement v-if="second" surface-id="console" assistant-label="Second assistant" />
        </div>
      </div>
    </v-main>
  </v-app>
</template>
<style>
html, body, #app { height: 100%; margin: 0; }
.fixture { height: 100dvh; display: flex; flex-direction: column; min-height: 0; }
.fixture nav { display: flex; flex-wrap: wrap; gap: .5rem; flex: 0 0 auto; }
.fixture nav button { padding: .25rem; }
.fixture__panes { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
.fixture__panes > * { flex: 1 1 0; min-width: 0; }
.fixture__panes--compact { width: min(360px, 100%); }
</style>
