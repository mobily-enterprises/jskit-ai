import { computed, reactive, ref } from "vue";

function createBooleanState(initial = false) {
  const flag = ref(initial);
  return Object.freeze({
    value: flag,
    set(value) {
      flag.value = Boolean(value);
    }
  });
}

export function useLoginView() {
  const mode = ref("login");
  const email = ref("");
  const password = ref("");
  const confirmPassword = ref("");
  const errorMessage = ref("");
  const loading = ref(false);

  const isLogin = computed(() => mode.value === "login");
  const isRegister = computed(() => mode.value === "register");
  const isForgot = computed(() => mode.value === "forgot");
  const isOtp = computed(() => mode.value === "otp");

  function switchMode(nextMode) {
    mode.value = String(nextMode || "login");
  }

  async function submitAuth() {
    loading.value = true;
    errorMessage.value = "";
    try {
      // stubbed; real implementations can replace this singleton
      await Promise.resolve();
    } catch (error) {
      errorMessage.value = String(error?.message || "Authentication failed.");
    } finally {
      loading.value = false;
    }
  }

  return {
    content: {
      authTitle: computed(() => "Welcome back"),
      authSubtitle: computed(() => "Please sign in."),
      submitLabel: computed(() => (isRegister.value ? "Register" : "Sign in"))
    },
    mode: reactive({
      isLogin,
      isRegister,
      isForgot,
      isOtp
    }),
    form: reactive({
      email,
      password,
      confirmPassword
    }),
    validation: reactive({
      emailErrorMessages: computed(() => []),
      passwordErrorMessages: computed(() => []),
      confirmPasswordErrorMessages: computed(() => []),
      canSubmit: computed(() => !loading.value)
    }),
    feedback: reactive({
      loading,
      errorMessage
    }),
    oauth: {
      providers: ref([]),
      providerButtonLabel: computed(() => "Continue with provider"),
      providerIcon: computed(() => "")
    },
    actions: {
      switchMode,
      submitAuth
    }
  };
}
