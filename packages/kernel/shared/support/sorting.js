function sortStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

export { sortStrings };
