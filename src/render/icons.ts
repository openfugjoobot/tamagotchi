/** Echte P1-Icons (14×14 PNGs, aus GMMan/flipperzero-tamagotch-p1). */
export const ICON_SRCS = Array.from({ length: 8 }, (_, i) => `/emu/icons/${i}.png`);

/**
 * Zeichnet das Icon-Raster der Anleitung (echte P1-Icons + Namen).
 * Genutzt von der Guide-Seite und dem Anleitungs-Fenster im Spiel.
 *
 * Die Live-Ansicht des Geräts zeichnet diese Reihe bewusst nicht mehr: die 8
 * Menü-Icons sind eigene LCD-Segmente, die das Task-6-Protokoll nicht
 * überträgt (nur das 32×16-LCD). Eine dauerhaft blasse, nie aufleuchtende Reihe
 * hätte einen Zustand vorgetäuscht, den der Client nicht kennt. Als statische
 * Referenz stehen die Icons hier im Guide.
 */
export function renderIconGrid(container: HTMLElement, names: string[]): void {
  container.replaceChildren();
  names.forEach((name, i) => {
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
    container.appendChild(item);
  });
}
