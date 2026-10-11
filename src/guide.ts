import { applyI18n, currentLang, iconNames } from "./i18n";
import { renderIconGrid } from "./render/icons";
import { savedBg, resolveTheme } from "./theme";

function applySavedBg(): void {
  document.body.dataset.bg = resolveTheme(savedBg(localStorage));
}

function renderIcons(): void {
  const grid = document.getElementById("icon-grid");
  if (grid) renderIconGrid(grid, iconNames());
}

function initGuide(): void {
  applySavedBg();
  applyI18n();
  document.documentElement.lang = currentLang();
  renderIcons();
}

initGuide();
