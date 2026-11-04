// A plugin's name finds nothing once the Uppy instance has removed it, or when dashboardOptions gave it another id.

/** @param {import("../types.js").ImageUppy} uppy */
function closeDashboard(uppy) {
  const dashboard = uppy.getPlugin("Dashboard");
  if (dashboard) {
    dashboard.closeModal();
  }
}

/** @param {import("../types.js").ImageUppy} uppy */
function stopImageEditor(uppy) {
  const imageEditor = uppy.getPlugin("ImageEditor");
  if (imageEditor) {
    imageEditor.stop();
  }
}

export { closeDashboard, stopImageEditor };
