const BG_KEY = "***";
const ICON_NAMES = ["Food", "Light", "Game", "Medicine", "Bath", "Status", "Discipline", "Attention"];

function applySavedBg(): void {
  try {
    const bg = localStorage.getItem(BG_KEY);
    if (bg) document.body.dataset.bg = bg;
  } catch { /* ignore */ }
}

function initGuide(): void {
  applySavedBg();

  const grid = document.getElementById("icon-grid");
  if (grid) {
    ICON_NAMES.forEach((name, i) => {
      const item = document.createElement("div");
      item.className = "lcd-item";
      const img = document.createElement("img");
      img.src = `/emu/icons/${i}.png`;
      img.alt = name;
      const span = document.createElement("span");
      span.textContent = name;
      item.append(img, span);
      grid.appendChild(item);
    });
  }

  const y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
}

initGuide();
