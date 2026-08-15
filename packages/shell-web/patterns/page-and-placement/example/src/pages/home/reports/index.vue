<script setup>
import { redirectToChild } from "@jskit-ai/kernel/client/pageRedirects";

definePage({
  redirect: redirectToChild("overview")
});
</script>
