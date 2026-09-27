const storageKey = "vl-appearance";
let current = "dark";
try { if (localStorage.getItem(storageKey) === "light") current = "light"; } catch { /* private webview */ }

export function applyAppearance(tg = window.Telegram?.WebApp) {
  document.documentElement.classList.toggle("vl-theme-light", current === "light");
  const background = current === "light" ? "#f4f4f4" : "#090909";
  for (const setter of ["setHeaderColor", "setBackgroundColor", "setBottomBarColor"]) {
    try { tg?.[setter]?.(background); } catch { /* older Telegram clients */ }
  }
  const button = document.getElementById("appearanceToggle");
  if (button) {
    button.textContent = current === "light" ? "Тёмная ◐" : "Светлая ◑";
    button.setAttribute("aria-label", current === "light" ? "Включить тёмную тему" : "Включить светлую тему");
  }
}

export function bindAppearance(tg) {
  applyAppearance(tg);
  const button = document.getElementById("appearanceToggle");
  if (button) button.onclick = () => {
    current = current === "dark" ? "light" : "dark";
    try { localStorage.setItem(storageKey, current); } catch { /* private webview */ }
    applyAppearance(tg);
  };
  tg?.onEvent?.("themeChanged", () => applyAppearance(tg));
}

applyAppearance();
