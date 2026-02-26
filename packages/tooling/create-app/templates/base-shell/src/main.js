import { createApp, onMounted, ref } from "vue";

const App = {
  setup() {
    const health = ref("loading...");

    onMounted(async () => {
      try {
        const response = await fetch("/api/v1/health");
        const payload = await response.json();
        health.value = payload?.ok ? "ok" : "unhealthy";
      } catch {
        health.value = "unreachable";
      }
    });

    return {
      health
    };
  },
  template: `
    <main style="font-family: sans-serif; max-width: 48rem; margin: 3rem auto; padding: 0 1rem;">
      <h1>__APP_TITLE__</h1>
      <p>Minimal starter shell is running.</p>
      <p><strong>Health:</strong> {{ health }}</p>
    </main>
  `
};

createApp(App).mount("#app");
