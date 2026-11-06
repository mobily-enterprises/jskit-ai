import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { compileScript, parse } from "@vue/compiler-sfc";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";

const elementUrl = new URL("../src/client/conversation/AssistantConversationElement.vue", import.meta.url).href;
const textUrl = new URL("../src/client/i18n.js", import.meta.url).href;

async function importElement() {
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url === textUrl) {
        return { format: "module", shortCircuit: true, source: "export function useJskitText() { return { t: (key) => key }; }" };
      }
      if (!url.endsWith(".vue")) return nextLoad(url, context);
      if (url !== elementUrl) return { format: "module", shortCircuit: true, source: "export default { render: () => null };" };
      const { descriptor } = parse(readFileSync(new URL(url), "utf8"));
      return {
        format: "module", shortCircuit: true,
        source: compileScript(descriptor, { id: "assistant-avatar-thumbnail", inlineTemplate: true }).content
      };
    }
  });
  try {
    return (await import(elementUrl)).default;
  } finally {
    hooks.deregister();
  }
}

async function renderShowAvatarButton(element, slots) {
  const app = createSSRApp({ render: () => h(element, { adapter: { conversation: { turns: [] } }, avatarSize: "hidden" }, slots) });
  app.component("VBtn", defineComponent({ setup: (_props, { slots: content }) => () => h("button", content.default?.()) }));
  app.component("VIcon", defineComponent({ props: { icon: { type: String, default: "" } }, setup: (props) => () => h("i", { "data-icon": props.icon }) }));
  const html = await renderToString(app);
  const buttons = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)].filter(([, attributes]) => attributes.includes('aria-label="jskit.assistant.chat.showAvatar"'));
  assert.equal(buttons.length, 1, "One Show avatar button while the avatar is hidden");
  const [, attributes, content] = buttons[0];
  assert.match(attributes, /title="jskit.assistant.chat.showAvatar"/u);
  assert.match(attributes, /width="44"/u);
  return content;
}

test("the hidden avatar's Show button shows the avatar-thumbnail slot, or the account icon without one", async () => {
  const element = await importElement();
  const avatar = () => h("span", { class: "fixture-face" });

  const thumbnail = await renderShowAvatarButton(element, {
    avatar,
    "avatar-thumbnail": ({ size, height }) => h("span", { class: "fixture-thumbnail", "data-size": size, "data-height": String(height) })
  });
  assert.match(thumbnail, /class="assistant-conversation__avatar-size-disc"/u);
  assert.match(thumbnail, /<span class="fixture-thumbnail" data-size="hidden" data-height="0"><\/span>/u);
  assert.doesNotMatch(thumbnail, /data-icon=/u);

  const fallback = await renderShowAvatarButton(element, { avatar });
  assert.match(fallback, /<i data-icon="\$accountCircle"[^>]*><\/i>/u);
  assert.doesNotMatch(fallback, /fixture-thumbnail/u);
});

test("the avatar's Show and Minimise buttons set no fixed height, so material-web gives them the 48dp touch target", () => {
  const source = readFileSync(new URL(elementUrl), "utf8");
  const buttons = [...source.matchAll(/<v-btn\b[^>]*>/gu)].map(([tag]) => tag).filter((tag) => tag.includes("assistant-conversation__avatar-size"));
  assert.equal(buttons.length, 2);
  for (const tag of buttons) assert.doesNotMatch(tag, /(?:^|\s):?(?:min-)?height=/u);
  assert.doesNotMatch(source, /\.assistant-conversation__avatar-size\s*\{[^}]*height/u);
});
