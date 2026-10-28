import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref } from "vue";
import { EMPTY_REALTIME_SOCKET, useRealtimeSocket } from "../composables/useRealtimeEvent.js";
import { reconnectSocketIoClient } from "../runtime.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

const ROOT_STYLE = Object.freeze({
  alignItems: "center",
  background: "transparent",
  border: "0",
  borderRadius: "50%",
  display: "inline-flex",
  height: "48px",
  justifyContent: "center",
  padding: "0",
  width: "48px"
});

const DOT_STYLE = Object.freeze({
  borderRadius: "9999px",
  boxShadow: "0 0 0 2px rgba(255, 255, 255, 0.82)",
  display: "block",
  height: "10px",
  width: "10px"
});

const SR_ONLY_STYLE = Object.freeze({
  border: "0",
  clip: "rect(0, 0, 0, 0)",
  clipPath: "inset(50%)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: "0",
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px"
});

function resolveTooltipText({ realtimeAvailable, connected }) {
  if (!realtimeAvailable) {
    return t("jskit.realtime.indicator.unavailableTooltip");
  }
  if (connected) {
    return t("jskit.realtime.indicator.connectedTooltip");
  }
  return t("jskit.realtime.indicator.disconnectedTooltip");
}

const RealtimeConnectionIndicator = defineComponent({
  name: "RealtimeConnectionIndicator",
  setup() {
    const socket = useRealtimeSocket({ required: false });
    const connected = ref(Boolean(socket?.connected));
    const realtimeAvailable = socket !== EMPTY_REALTIME_SOCKET;
    let detach = null;

    const tooltipText = computed(() => {
      return resolveTooltipText({
        realtimeAvailable,
        connected: connected.value
      });
    });

    const statusLabel = computed(() =>
      connected.value ? t("jskit.realtime.indicator.connected") : t("jskit.realtime.indicator.disconnected")
    );

    const dotStyle = computed(() => ({
      ...DOT_STYLE,
      backgroundColor: connected.value ? "#22c55e" : "#ef4444"
    }));

    function syncConnected(nextState) {
      connected.value = Boolean(nextState);
    }

    function bindSocketStatusListeners() {
      if (!realtimeAvailable || typeof socket.on !== "function") {
        syncConnected(false);
        return;
      }

      syncConnected(socket.connected);

      const onConnect = () => syncConnected(true);
      const onDisconnect = () => syncConnected(false);
      const onConnectError = () => syncConnected(false);

      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onConnectError);

      detach = () => {
        if (typeof socket.off === "function") {
          socket.off("connect", onConnect);
          socket.off("disconnect", onDisconnect);
          socket.off("connect_error", onConnectError);
        }
      };
    }

    onMounted(() => {
      bindSocketStatusListeners();
    });

    onBeforeUnmount(() => {
      if (typeof detach === "function") {
        detach();
      }
      detach = null;
    });

    return () =>
      h(
        "button",
        {
          disabled: !realtimeAvailable || connected.value,
          onClick: () => reconnectSocketIoClient(socket),
          style: { ...ROOT_STYLE, cursor: realtimeAvailable && !connected.value ? "pointer" : "default" },
          title: tooltipText.value,
          type: "button",
          "aria-label": realtimeAvailable && !connected.value
            ? t("jskit.realtime.indicator.reconnect")
            : statusLabel.value
        },
        [
          h("span", { style: dotStyle.value, "aria-hidden": "true" }),
          h("span", { style: SR_ONLY_STYLE }, statusLabel.value)
        ]
      );
  }
});

export { RealtimeConnectionIndicator };
export default RealtimeConnectionIndicator;
