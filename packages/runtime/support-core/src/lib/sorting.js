function sortStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function sortById(items = [], { idSelector = (item) => item?.id } = {}) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftId = String(idSelector(left) || "").trim();
    const rightId = String(idSelector(right) || "").trim();
    return leftId.localeCompare(rightId);
  });
}

export { sortStrings, sortById };
