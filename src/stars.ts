// Dezente Sterne für die dunklen Themes: gelegentliches Funkeln + Sternschnuppen.
// Rein dekorativ (aria-hidden) und ohne Layout-Einfluss.
export function buildStars(container: HTMLElement): void {
  const frag = document.createDocumentFragment();

  // Funkelnde Punkte: erscheinen nur kurz, sehr unterschiedliche Zyklen.
  for (let i = 0; i < 30; i++) {
    const s = document.createElement("span");
    s.className = "star-dot";
    s.style.left = (Math.random() * 100).toFixed(2) + "%";
    s.style.top = (Math.random() * 82).toFixed(2) + "%";
    const size = 1 + Math.random() * 1.7;
    s.style.width = size.toFixed(2) + "px";
    s.style.height = size.toFixed(2) + "px";
    s.style.setProperty("--max", (0.35 + Math.random() * 0.6).toFixed(2));
    s.style.setProperty("--dur", (8 + Math.random() * 18).toFixed(2) + "s");
    s.style.setProperty("--delay", (-Math.random() * 26).toFixed(2) + "s");
    frag.appendChild(s);
  }

  // Zwei Sternschnuppen mit langen, versetzten Zyklen.
  for (let i = 0; i < 2; i++) {
    const sh = document.createElement("span");
    sh.className = "shooter";
    sh.style.left = (3 + Math.random() * 55).toFixed(1) + "%";
    sh.style.top = (Math.random() * 32).toFixed(1) + "%";
    sh.style.setProperty("--dur", (12 + Math.random() * 18).toFixed(2) + "s");
    sh.style.setProperty("--delay", (-Math.random() * 28).toFixed(2) + "s");
    frag.appendChild(sh);
  }

  container.replaceChildren(frag);
}
