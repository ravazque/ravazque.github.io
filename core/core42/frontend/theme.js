// Loaded first in <head>: applies the saved light/dark choice before the first paint.
try { const t = localStorage.getItem("theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) {}
