// Before the first paint: the theme the reader chose (the system's otherwise), so the page never flashes.
(function () {
  try {
    var t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
