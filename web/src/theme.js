const storageKey = "vl-appearance";
const paletteStorageKey = "vl-palette";
// Keep the old storage keys so existing users retain their preference, while
// presenting a modern gothic palette without the previous gold treatment.
const palettes = [
  { key: "gothic", label: "Серебро", next: "Ноктюрн" },
  { key: "nocturne", label: "Ноктюрн", next: "Лёд" },
  { key: "silver", label: "Лёд", next: "Серебро" },
];
let current = "dark";
let palette = "gothic";
try { if (localStorage.getItem(storageKey) === "light") current = "light"; } catch { /* private webview */ }
try {
  const savedPalette = localStorage.getItem(paletteStorageKey);
  if (palettes.some((item) => item.key === savedPalette)) palette = savedPalette;
} catch { /* private webview */ }

const colors = {
  dark: { gothic: "#09090d", nocturne: "#0b0a14", silver: "#090c10" },
  light: { gothic: "#ececf1", nocturne: "#eeedf4", silver: "#edf1f4" },
};

export function applyAppearance(tg = window.Telegram?.WebApp) {
  document.documentElement.classList.toggle("vl-theme-light", current === "light");
  document.documentElement.classList.remove(...palettes.map((item) => `vl-palette-${item.key}`));
  document.documentElement.classList.add(`vl-palette-${palette}`);
  const background = colors[current]?.[palette] || colors.dark.gothic;
  for (const setter of ["setHeaderColor", "setBackgroundColor", "setBottomBarColor"]) {
    try { tg?.[setter]?.(background); } catch { /* older Telegram clients */ }
  }
  const button = document.getElementById("appearanceToggle");
  if (button) {
    button.textContent = current === "light" ? "Тёмная ◐" : "Светлая ◑";
    button.setAttribute("aria-label", current === "light" ? "Включить тёмную тему" : "Включить светлую тему");
  }
  const paletteButton = document.getElementById("paletteToggle");
  if (paletteButton) {
    const item = palettes.find((entry) => entry.key === palette) || palettes[0];
    paletteButton.textContent = item.label;
    paletteButton.setAttribute("aria-label", `Сменить палитру. Сейчас: ${item.label}. Следующая: ${item.next}`);
    paletteButton.title = `Следующая палитра: ${item.next}`;
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
  const paletteButton = document.getElementById("paletteToggle");
  if (paletteButton) paletteButton.onclick = () => {
    const index = palettes.findIndex((item) => item.key === palette);
    palette = palettes[(index + 1) % palettes.length].key;
    try { localStorage.setItem(paletteStorageKey, palette); } catch { /* private webview */ }
    applyAppearance(tg);
  };
  tg?.onEvent?.("themeChanged", () => applyAppearance(tg));
}

applyAppearance();
