<script setup>
import { computed, inject, mergeProps, onBeforeUnmount, onMounted, ref, useAttrs, useId } from "vue";
import { useShellWindowSizeClass } from "../composables/useShellWindowSizeClass.js";
import { useJskitText } from "../i18n.js";
import { NO_SHELL_PAGE_ACTIONS_REGISTRY, SHELL_PAGE_ACTIONS_REGISTRY_KEY } from "../support/pageActions.js";

// One page action in the top app bar. On compact windows a secondary action shows as an icon button named by its
// label; the page's primary action (`primary`, at most one) keeps its label as a filled button. In a bar that owns its
// actions (ShellLayout, or a layout that calls useShellAppBar()), an `overflow` action is an item of the bar's
// overflow menu, and on compact windows every action but the primary one joins it.
// Attributes such as `type="submit"` and `form` (so an app bar Save can submit the page's form), `target`,
// `data-testid` or `aria-*` land on the button, or on the menu item, in every form.
defineOptions({ inheritAttrs: false });

const props = defineProps({
  // A message key, { key, fallback } or plain text.
  label: {
    type: [String, Object],
    required: true
  },
  icon: {
    type: String,
    default: ""
  },
  to: {
    type: [String, Object],
    default: undefined
  },
  // With `to`: replaces the current history entry instead of pushing one.
  replace: {
    type: Boolean,
    default: false
  },
  // A link outside the app (another origin) or to a file; `to` is for the app's own pages.
  href: {
    type: String,
    default: undefined
  },
  // With `href`: downloads the file instead of opening it, under the given file name when it is a string.
  download: {
    type: [Boolean, String],
    default: undefined
  },
  primary: {
    type: Boolean,
    default: false
  },
  // A Material 3 colour role, such as "error" for a destructive action.
  color: {
    type: String,
    default: undefined
  },
  // An item of the top app bar's overflow menu, such as a record's secondary actions.
  overflow: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  loading: {
    type: Boolean,
    default: false
  }
});
const emit = defineEmits(["click"]);

const attrs = useAttrs();
const { text } = useJskitText();
const { isCompact } = useShellWindowSizeClass();
const resolvedLabel = computed(() => text(props.label));
const iconOnly = computed(() => Boolean(props.icon) && isCompact.value && !props.primary);
const color = computed(() => props.color || (props.primary ? "primary" : "on-surface-variant"));
// A boolean `download` is the attribute without a file name.
const download = computed(() => (props.download === true ? "" : props.download || undefined));

function handleClick(event) {
  emit("click", event);
}

const anchor = ref(null);
/** @type {import("../support/pageActions.js").ShellPageActionsRegistry} */
const registry = inject(SHELL_PAGE_ACTIONS_REGISTRY_KEY, NO_SHELL_PAGE_ACTIONS_REGISTRY);
/** @type {import("../support/pageActions.js").ShellPageActionEntry} */
const entry = {
  id: useId(),
  state: computed(() => ({
    label: resolvedLabel.value,
    icon: props.icon,
    to: props.to,
    href: props.href,
    replace: props.replace,
    download: download.value,
    color: props.color,
    primary: props.primary,
    overflow: props.overflow,
    disabled: props.disabled,
    loading: props.loading
  })),
  attrs,
  activate: handleClick,
  anchor: null
};
const registration = registry.register(entry);
const inMenu = computed(() => registry.inMenu(entry));

onMounted(() => {
  entry.anchor = anchor.value;
  registration.placed();
});

onBeforeUnmount(() => {
  registration.release();
});
</script>

<template>
  <!-- The action's place in the bar, which orders the overflow menu; it draws nothing itself. -->
  <span ref="anchor" class="shell-page-action-slot">
    <template v-if="!inMenu">
      <v-tooltip v-if="iconOnly" :text="resolvedLabel" location="bottom">
        <template #activator="{ props: tooltipProps }">
          <v-btn
            v-bind="mergeProps(attrs, tooltipProps)"
            class="shell-page-action"
            :icon="props.icon"
            variant="text"
            :color="color"
            :to="props.to"
            :replace="props.replace"
            :href="props.href"
            :download="download"
            :disabled="props.disabled"
            :loading="props.loading"
            :aria-label="resolvedLabel"
            @click="handleClick"
          />
        </template>
      </v-tooltip>
      <v-btn
        v-else
        v-bind="attrs"
        class="shell-page-action shell-page-action--labelled"
        :variant="props.primary ? 'flat' : 'text'"
        :color="color"
        :prepend-icon="props.icon || undefined"
        :to="props.to"
        :replace="props.replace"
        :href="props.href"
        :download="download"
        :disabled="props.disabled"
        :loading="props.loading"
        @click="handleClick"
      >
        {{ resolvedLabel }}
      </v-btn>
    </template>
  </span>
</template>

<style scoped>
.shell-page-action-slot {
  display: contents;
}

.shell-page-action--labelled {
  margin-inline: 4px;
}
</style>
