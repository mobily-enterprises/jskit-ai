import { createSocialRuntime, socialRuntimeTestables } from "@jskit-ai/social-client-runtime/client";
import { useAuthGuard } from "../auth/useAuthGuard.js";
import { useQueryErrorMessage } from "@jskit-ai/web-runtime-core/server";
import { api } from "../../platform/http/api/index.js";
import { useWorkspaceStore } from "../../app/state/workspaceStore.js";

const socialRuntime = createSocialRuntime({
  api,
  useAuthGuard,
  useQueryErrorMessage,
  useWorkspaceStore
});

const { useSocialView } = socialRuntime;

export { useSocialView, socialRuntimeTestables };
