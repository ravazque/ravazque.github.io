"use strict";
// The landing's seat field lights up around the pointer and the mark tilts toward it. Without this script (or with
// reduced motion) the panel is simply still.
(() => {
  const plan = document.querySelector(".landing-plan");
  if (!plan || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let frame = 0;
  plan.addEventListener("pointermove", (ev) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const r = plan.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
      plan.style.setProperty("--px", `${(x * 100).toFixed(1)}%`);
      plan.style.setProperty("--py", `${(y * 100).toFixed(1)}%`);
      plan.style.setProperty("--ty", `${((x - .5) * 22).toFixed(1)}deg`);
      plan.style.setProperty("--tx", `${((.5 - y) * 22).toFixed(1)}deg`);
    });
  });
  plan.addEventListener("pointerleave", () => ["--tx", "--ty"].forEach((k) => plan.style.setProperty(k, "0deg")));
})();
