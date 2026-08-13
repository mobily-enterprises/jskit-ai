import { defineComponent, h } from "vue";
import { RouterLink } from "vue-router";
import { useJskitNavigation } from "./navigation.js";

function isJskitOrdinaryLinkClick(event, { target = "", download = false } = {}) {
  const resolvedTarget = String(target || "").trim().toLowerCase();
  return Boolean(
    event &&
      event.defaultPrevented !== true &&
      event.button === 0 &&
      event.metaKey !== true &&
      event.ctrlKey !== true &&
      event.shiftKey !== true &&
      event.altKey !== true &&
      (!resolvedTarget || resolvedTarget === "_self") &&
      download !== true
  );
}

function invokeClickHandler(handler, event) {
  for (const callback of Array.isArray(handler) ? handler : [handler]) {
    if (typeof callback === "function") {
      callback(event);
    }
  }
}

const JskitDestinationLink = defineComponent({
  name: "JskitDestinationLink",
  inheritAttrs: false,
  props: {
    to: {
      type: [String, Object],
      required: true
    },
    focus: {
      type: String,
      default: "auto",
      validator: (value) => ["auto", "heading", "preserve"].includes(value)
    }
  },
  setup(props, { attrs, slots }) {
    const navigation = useJskitNavigation();

    return () => h(RouterLink, {
      to: props.to,
      custom: true
    }, {
      default: ({ href, isExactActive }) => {
        const {
          onClick,
          ...anchorAttrs
        } = attrs;
        const hasDownload = Object.hasOwn(anchorAttrs, "download") &&
          anchorAttrs.download !== false &&
          anchorAttrs.download != null;

        return h("a", {
          ...anchorAttrs,
          href,
          "aria-current": anchorAttrs["aria-current"] || (isExactActive ? "page" : undefined),
          onClick: async (event) => {
            invokeClickHandler(onClick, event);
            if (!isJskitOrdinaryLinkClick(event, {
              target: anchorAttrs.target,
              download: hasDownload
            })) {
              return;
            }
            event.preventDefault();
            await navigation.push(props.to, {
              reason: "link",
              focus: props.focus
            });
          }
        }, slots.default?.());
      }
    });
  }
});

export { JskitDestinationLink, isJskitOrdinaryLinkClick };
