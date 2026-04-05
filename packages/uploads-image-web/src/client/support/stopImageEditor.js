function stopImageEditor(uppy) {
  const imageEditor = uppy?.getPlugin?.("ImageEditor");
  if (imageEditor && typeof imageEditor.stop === "function") {
    imageEditor.stop();
  }
}

export { stopImageEditor };
