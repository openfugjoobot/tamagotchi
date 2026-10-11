const NS = "http://www.w3.org/2000/svg";

/** Baut eine zufällige Grasfläche (viele Halme, je eigene Bewegung). */
export function buildGrass(container: HTMLElement): void {
  const w = Math.max(320, Math.round(container.clientWidth || window.innerWidth));
  const h = 58;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "none");

  const count = Math.round(w / 3);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const len = h * (0.28 + Math.random() * 0.72);
    const thick = 0.7 + Math.random() * 2.1;
    const lean = (Math.random() - 0.5) * 16;
    const hue = 100 + Math.random() * 45;
    const light = 30 + Math.random() * 24;

    const p = document.createElementNS(NS, "path");
    p.setAttribute(
      "d",
      `M${x.toFixed(1)} ${h} Q ${(x + lean * 0.3).toFixed(1)} ${(h - len * 0.55).toFixed(1)} ${(x + lean).toFixed(1)} ${(h - len).toFixed(1)}`,
    );
    p.setAttribute("stroke", `hsl(${hue.toFixed(0)} 45% ${light.toFixed(0)}%)`);
    p.setAttribute("stroke-width", thick.toFixed(2));
    p.setAttribute("fill", "none");
    p.setAttribute("stroke-linecap", "round");
    p.classList.add("grass-blade");
    p.style.setProperty("--dur", (2.6 + Math.random() * 4.6).toFixed(2) + "s");
    p.style.setProperty("--delay", (-Math.random() * 6).toFixed(2) + "s");
    p.style.setProperty("--amp", (0.8 + Math.random() * 3.4).toFixed(2) + "deg");
    svg.appendChild(p);
  }
  container.replaceChildren(svg);
}
