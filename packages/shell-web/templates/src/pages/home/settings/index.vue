<script setup>
definePage({
  redirect: (to) => `${String(to.path || "").replace(/\/$/, "")}/general`
});
</script>
