import assert from "node:assert/strict";
import test from "node:test";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { setJskitI18n } from "@jskit-ai/kernel/client/i18n";
import { RealtimeConnectionIndicator } from "../src/client/components/RealtimeConnectionIndicator.js";

function renderIndicator() {
  return renderToString(createSSRApp({ render: () => h(RealtimeConnectionIndicator) }));
}

test("realtime indicator texts are English by default and follow the app's language", async () => {
  const english = await renderIndicator();
  assert.match(english, /title="Realtime is unavailable\. Live updates are disabled for this page\."/u);
  assert.match(english, />Realtime disconnected</u);

  setJskitI18n(createI18n({
    legacy: false,
    locale: "xx",
    messages: {
      xx: {
        jskit: {
          realtime: {
            indicator: {
              unavailableTooltip: "[xx] Temps réel indisponible.",
              disconnected: "[xx] Déconnecté"
            }
          }
        }
      }
    }
  }));
  try {
    const translated = await renderIndicator();
    assert.match(translated, /title="\[xx\] Temps réel indisponible\."/u);
    assert.match(translated, />\[xx\] Déconnecté</u);
  } finally {
    setJskitI18n(null);
  }
});
