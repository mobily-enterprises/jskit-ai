// Vue Preview locator: a classic script a Preview bridge can inline. It defines
// globalThis.__vibe64LocateElement(element), which returns the nearest project
// component that rendered the element in a Vue development build, as
// { file, name? } with the file as the build reports it, or null. It reads only
// Vue's own component bookkeeping (`__vueParentComponent`, the component's
// parent and its `__file`/`name`), never an element's text or value.
(function defineVueLocator() {
  "use strict";
  var MAX_STEPS = 512;

  function projectComponent(instance) {
    for (var current = instance, steps = 0; current && steps < MAX_STEPS; current = current.parent, steps += 1) {
      var type = current.type;
      if (type && typeof type.__file === "string" && type.__file) {
        var name = type.name || type.__name;
        return typeof name === "string" && name ? { file: type.__file, name: name } : { file: type.__file };
      }
    }
    return null;
  }

  globalThis.__vibe64LocateElement = function locateElement(element) {
    for (var node = element, steps = 0; node && steps < MAX_STEPS; node = node.parentNode, steps += 1) {
      if (node.__vueParentComponent) {
        return projectComponent(node.__vueParentComponent);
      }
    }
    return null;
  };
})();
