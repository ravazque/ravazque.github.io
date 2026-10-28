"use strict";
// Custom controls drawn by the page (styled from ui.json): a listbox select and an on/off switch.

// Keyboard model of the select, as a pure function: (state, key) -> state
function selectReducer(state, key) {
  const n = state.labels.length;
  const at = (i) => ((i % n) + n) % n;
  switch (key) {
    case "ArrowDown": return state.open ? {...state, index: at(state.index + 1)} : {...state, open: true};
    case "ArrowUp": return {...state, open: true, index: state.open ? at(state.index - 1) : state.index};
    case "Home": return {...state, open: true, index: 0};
    case "End": return {...state, open: true, index: n - 1};
    case "Enter": case " ": return state.open ? {...state, open: false, committed: state.index} : {...state, open: true};
    case "Escape": return {...state, open: false, index: state.committed};
    default:
      if (key.length === 1 && /\S/.test(key)) {
        const k = key.toLowerCase();
        for (let step = 1; step <= n; step++) {
          const i = at(state.index + step);
          if (state.labels[i].toLowerCase().startsWith(k)) return {...state, open: true, index: i};
        }
      }
      return state;
  }
}

let selectCount = 0;
// Replace a native <select> with a button + listbox. The native element stays (hidden) and keeps the value,
// so existing `change` listeners keep working; call the returned refresh() after changing its options.
function enhanceSelect(select) {
  if (select.dataset.enhanced) return select._refresh;
  select.dataset.enhanced = "1";
  const id = `sel${++selectCount}`;
  const label = select.closest("label");
  const wrap = select.parentElement;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "select-btn"; btn.id = `${id}-btn`;
  btn.setAttribute("aria-haspopup", "listbox"); btn.setAttribute("aria-expanded", "false");
  const list = document.createElement("ul");
  list.className = "select-list"; list.id = `${id}-list`; list.setAttribute("role", "listbox"); list.tabIndex = -1; list.hidden = true;
  btn.setAttribute("aria-controls", list.id);
  select.hidden = true; select.tabIndex = -1;
  wrap.append(btn, list);
  // a <label> would forward clicks to the hidden select; point it at the button instead
  if (label) { const text = label.querySelector("span"); if (text) { text.id = `${id}-label`; btn.setAttribute("aria-labelledby", `${text.id} ${btn.id}`); } }

  let state = {open: false, index: 0, committed: 0, labels: []};
  const options = () => [...select.options];
  function render() {
    const opts = options();
    state = {...state, labels: opts.map((o) => o.textContent), committed: select.selectedIndex < 0 ? 0 : select.selectedIndex};
    if (!state.open) state.index = state.committed;
    btn.textContent = opts[state.committed]?.textContent ?? "";
    list.innerHTML = opts.map((o, i) => `<li role="option" id="${id}-o${i}" aria-selected="${i === state.committed}"${i === state.index ? ' class="active"' : ""}>${o.textContent.replace(/[&<>]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]))}</li>`).join("");
    list.hidden = !state.open;
    btn.setAttribute("aria-expanded", String(state.open));
    if (state.open) { list.setAttribute("aria-activedescendant", `${id}-o${state.index}`); list.children[state.index]?.scrollIntoView({block: "nearest"}); }
  }
  function apply(next) {
    const changed = next.committed !== state.committed;
    state = next;
    if (changed) { select.selectedIndex = state.committed; select.dispatchEvent(new Event("change", {bubbles: true})); }
    render();
  }
  btn.addEventListener("click", () => apply({...state, open: !state.open, index: state.committed}));
  btn.addEventListener("keydown", (ev) => {
    if (ev.key === "Tab") { if (state.open) apply({...state, open: false, committed: state.index}); return; }
    const next = selectReducer(state, ev.key);
    if (next !== state) { ev.preventDefault(); apply(next); }
  });
  list.addEventListener("mousedown", (ev) => ev.preventDefault());  // keep focus on the button
  list.addEventListener("click", (ev) => {
    const li = ev.target.closest("[role=option]"); if (!li) return;
    apply({...state, open: false, index: [...list.children].indexOf(li), committed: [...list.children].indexOf(li)});
  });
  document.addEventListener("click", (ev) => { if (state.open && !wrap.contains(ev.target)) apply({...state, open: false, index: state.committed}); });
  render();
  select._refresh = render;
  return render;
}

// role="switch" button: toggles aria-checked and reports the new value
function makeSwitch(button, onChange) {
  button.setAttribute("role", "switch");
  if (!button.hasAttribute("aria-checked")) button.setAttribute("aria-checked", "false");
  button.addEventListener("click", () => {
    const on = button.getAttribute("aria-checked") !== "true";
    button.setAttribute("aria-checked", String(on));
    onChange?.(on);
  });
}

export {selectReducer, enhanceSelect, makeSwitch};
