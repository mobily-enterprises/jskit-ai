import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref } from "vue";
import { EMPTY_REALTIME_SOCKET, useRealtimeSocket } from "../composables/useRealtimeEvent.js";

const ROOT_STYLE = Object.freeze({
  alignItems: "center",
  display: "inline-flex",
  height: "32px",
  justifyContent: "center",
  width: "32px"
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
    return "Realtime is unavailable. Live updates are disabled for this page.";
  }
  if (connected) {
    return "Realtime is connected. Live updates are active.";
  }
  return "Realtime is disconnected. The client will keep trying to reconnect.";
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

    const statusLabel = computed(() => (connected.value ? "Realtime connected" : "Realtime disconnected"));

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
        "span",
        {
          style: ROOT_STYLE,
          title: tooltipText.value,
          "aria-label": statusLabel.value
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
