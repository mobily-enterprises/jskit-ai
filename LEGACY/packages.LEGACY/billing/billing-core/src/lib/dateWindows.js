function startOfUtcDay(referenceDate) {
  return new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate(), 0, 0, 0, 0)
  );
}

function startOfUtcWeek(referenceDate) {
  const start = startOfUtcDay(referenceDate);
  const weekday = start.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  start.setUTCDate(start.getUTCDate() + mondayOffset);
  return start;
}

export { startOfUtcDay, startOfUtcWeek };
