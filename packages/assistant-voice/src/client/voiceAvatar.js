import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const IDLE_GESTURES = Object.freeze([
  "glance-left",
  "tiny-nod",
  "glance-right",
  "brow-lift",
  "glance-up",
  "curious-tilt",
  "smile-brighten",
  "friendly-lean",
  "shoulder-lift",
  "earring-sway"
]);
const IDLE_MOUTH_POSES = Object.freeze({
  "tiny-nod": "warm-smile",
  "curious-tilt": "warm-smile",
  "smile-brighten": "smile",
  "friendly-lean": "warm-smile"
});
const IDLE_GESTURE_DURATION_MS = 1_100;
const LISTENING_EXPRESSIONS = Object.freeze([
  "attentive",
  "tiny-nod",
  "follow-left",
  "tilt-left",
  "follow-right",
  "tilt-right"
]);
const LISTENING_MOUTH_POSES = Object.freeze({
  "attentive": "soft-smile",
  "tiny-nod": "soft-smile"
});
const PRE_THINKING_EXPRESSIONS = Object.freeze([
  "settle",
  "glance-left",
  "center",
  "glance-right",
  "tiny-tilt",
  "ready"
]);
const PRE_THINKING_MOUTH_POSES = Object.freeze({
  "ready": "soft-smile",
  "tiny-tilt": "thoughtful"
});
const THINKING_EXPRESSIONS = Object.freeze([
  "look-up-left",
  "focus",
  "look-up-right",
  "weigh-left",
  "weigh-right",
  "idea"
]);
const THINKING_MOUTH_POSES = Object.freeze({
  "idea": "soft-smile",
  "weigh-left": "closed",
  "weigh-right": "closed"
});
const ACTIVE_EXPRESSION_DURATION_MS = Object.freeze({
  listening: 1_350,
  "pre-thinking": 1_450,
  thinking: 1_700
});
const ACTIVE_EXPRESSION_SEQUENCES = Object.freeze({
  listening: LISTENING_EXPRESSIONS,
  "pre-thinking": PRE_THINKING_EXPRESSIONS,
  thinking: THINKING_EXPRESSIONS
});

export function useVoiceAvatar(props) {
  const blinking = ref(false);
  const activeExpression = ref("");
  const idleGesture = ref("");
  const reducedMotion = ref(false);
  let blinkTimer = 0;
  let activeExpressionTimer = 0;
  const activeExpressionIndexes = {
    listening: Math.floor(Math.random() * LISTENING_EXPRESSIONS.length),
    "pre-thinking": Math.floor(Math.random() * PRE_THINKING_EXPRESSIONS.length),
    thinking: Math.floor(Math.random() * THINKING_EXPRESSIONS.length)
  };
  let idleGestureIndex = Math.floor(Math.random() * IDLE_GESTURES.length);
  let idleGestureTimer = 0;
  let reopenTimer = 0;
  let reducedMotionQuery = null;

  const expression = computed(() => String(props.state || "idle"));
  const visibleMouthPose = computed(() => {
    if (expression.value === "idle") {
      return IDLE_MOUTH_POSES[idleGesture.value] || "soft-smile";
    }
    if (expression.value === "thinking") {
      return THINKING_MOUTH_POSES[activeExpression.value] || "thoughtful";
    }
    if (expression.value === "pre-thinking") {
      return PRE_THINKING_MOUTH_POSES[activeExpression.value] || "closed";
    }
    if (expression.value === "listening") {
      return LISTENING_MOUTH_POSES[activeExpression.value] || "closed";
    }
    if (expression.value !== "speaking") {
      return "closed";
    }
    const pose = String(props.mouthPose || "closed");
    if (props.mouthLevel < 0.045 || !["open", "round", "small", "wide"].includes(pose)) {
      return "closed";
    }
    return pose;
  });

  function clearBlinkTimers() {
    window.clearTimeout(blinkTimer);
    window.clearTimeout(reopenTimer);
    blinkTimer = 0;
    reopenTimer = 0;
  }

  function clearIdleGesture() {
    window.clearTimeout(idleGestureTimer);
    idleGestureTimer = 0;
    idleGesture.value = "";
  }

  function clearActiveExpression() {
    window.clearTimeout(activeExpressionTimer);
    activeExpressionTimer = 0;
    activeExpression.value = "";
  }

  function scheduleBlink(delay = 2_800 + (Math.random() * 3_400)) {
    window.clearTimeout(blinkTimer);
    if (reducedMotion.value) {
      return;
    }
    blinkTimer = window.setTimeout(() => {
      const doubleBlink = Math.random() < 0.16;
      blinking.value = true;
      reopenTimer = window.setTimeout(() => {
        blinking.value = false;
        if (!doubleBlink) {
          scheduleBlink();
          return;
        }
        blinkTimer = window.setTimeout(() => {
          blinking.value = true;
          reopenTimer = window.setTimeout(() => {
            blinking.value = false;
            scheduleBlink();
          }, 115);
        }, 155);
      }, 135);
    }, delay);
  }

  function scheduleIdleGesture(delay = 2_400 + (Math.random() * 2_800)) {
    window.clearTimeout(idleGestureTimer);
    if (reducedMotion.value || expression.value !== "idle") {
      return;
    }
    idleGestureTimer = window.setTimeout(() => {
      idleGesture.value = IDLE_GESTURES[idleGestureIndex];
      idleGestureIndex = (idleGestureIndex + 1) % IDLE_GESTURES.length;
      idleGestureTimer = window.setTimeout(() => {
        idleGesture.value = "";
        scheduleIdleGesture();
      }, IDLE_GESTURE_DURATION_MS);
    }, delay);
  }

  function showNextActiveExpression() {
    const state = expression.value;
    const sequence = ACTIVE_EXPRESSION_SEQUENCES[state] || [];
    if (!sequence.length) {
      clearActiveExpression();
      return;
    }
    const index = activeExpressionIndexes[state] || 0;
    activeExpression.value = sequence[index];
    activeExpressionIndexes[state] = (index + 1) % sequence.length;
    if (!reducedMotion.value) {
      activeExpressionTimer = window.setTimeout(
        showNextActiveExpression,
        ACTIVE_EXPRESSION_DURATION_MS[state]
      );
    }
  }

  function updateReducedMotion(event) {
    reducedMotion.value = Boolean(event.matches);
    clearBlinkTimers();
    clearActiveExpression();
    clearIdleGesture();
    blinking.value = false;
    if (ACTIVE_EXPRESSION_SEQUENCES[expression.value]) {
      showNextActiveExpression();
    }
    if (!reducedMotion.value) {
      scheduleBlink();
      scheduleIdleGesture();
    }
  }

  watch(expression, () => {
    clearActiveExpression();
    clearIdleGesture();
    if (ACTIVE_EXPRESSION_SEQUENCES[expression.value]) {
      showNextActiveExpression();
    } else if (!reducedMotion.value) {
      scheduleIdleGesture(900 + (Math.random() * 1_200));
    }
  });

  onMounted(() => {
    reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.value = reducedMotionQuery.matches;
    reducedMotionQuery.addEventListener?.("change", updateReducedMotion);
    if (!reducedMotion.value) {
      scheduleBlink(1_800 + (Math.random() * 1_800));
      scheduleIdleGesture(900 + (Math.random() * 1_500));
    }
    if (ACTIVE_EXPRESSION_SEQUENCES[expression.value]) {
      showNextActiveExpression();
    }
  });

  onBeforeUnmount(() => {
    clearBlinkTimers();
    clearActiveExpression();
    clearIdleGesture();
    reducedMotionQuery?.removeEventListener?.("change", updateReducedMotion);
    reducedMotionQuery = null;
  });
  return { blinking, activeExpression, idleGesture, expression, visibleMouthPose, reducedMotion };
}
