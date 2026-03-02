const statusLabelMap = {
  draft: "Draft",
  active: "Active",
  archived: "Archived"
};

export function projectStatusLabel(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  return statusLabelMap[normalized] || "Draft";
}

export function formatProjectDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString();
}
