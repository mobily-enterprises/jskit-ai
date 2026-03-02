function getAction(contributor, actionId) {
  const actions = Array.isArray(contributor?.actions) ? contributor.actions : [];
  return actions.find((action) => action.id === actionId);
}

export { getAction };
