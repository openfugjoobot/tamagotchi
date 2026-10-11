import { applyI18n, iconNames, currentLang } from "./i18n";
import { savedBg } from "./theme";

function applySavedBg(): void {
  document.body.dataset.bg = savedBg(localStorage);
}

function renderIcons(): void {
  const grid = document.getElementById("icon-grid");
  if (!grid) return;
  grid.replaceChildren();
  iconNames().forEach((name, i) => {
    const item = document.createElement("div");
    item.className = "lcd-item";
    const img = document.createElement("img");
    img.src = `/emu/icons/${i}.png`;
    img.alt = name;
    img.width = 22;
    img.height = 22;
    const span = document.createElement("span");
    span.textContent = name;
    item.append(img, span);
    grid.appendChild(item);
  });
}

function initGuide(): void {
  applySavedBg();
  applyI18n();
  document.documentElement.lang = currentLang();
  renderIcons();
  const y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
}

initGuide();
