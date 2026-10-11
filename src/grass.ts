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
  const groups: SVGGElement[] = [];
  const NG = 10;
  for (let gi = 0; gi < NG; gi++) {
    const g = document.createElementNS(NS, "g");
    g.classList.add("grass-g");
    g.style.setProperty("--dur", (2.6 + Math.random() * 4.6).toFixed(2) + "s");
    g.style.setProperty("--delay", (-Math.random() * 6).toFixed(2) + "s");
    g.style.setProperty("--amp", (0.8 + Math.random() * 3.2).toFixed(2) + "deg");
    svg.appendChild(g);
    groups.push(g);
  }
  const cs = getComputedStyle(container);
  const baseHue = parseFloat(cs.getPropertyValue("--grass-hue")) || 150;
  const sat = (cs.getPropertyValue("--grass-sat") || "40%").trim();
  const baseLight = parseFloat(cs.getPropertyValue("--grass-light")) || 42;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const len = h * (0.12 + Math.pow(Math.random(), 1.6) * 0.88);
    const thick = 0.6 + Math.random() * 2.6;
    const lean = (Math.random() - 0.5) * 16;
    const hue = baseHue + (Math.random() - 0.5) * 26;
    const light = Math.max(10, Math.min(85, baseLight + (Math.random() - 0.5) * 18));

    const p = document.createElementNS(NS, "path");
    p.setAttribute(
      "d",
      `M${x.toFixed(1)} ${h} Q ${(x + lean * 0.3).toFixed(1)} ${(h - len * 0.55).toFixed(1)} ${(x + lean).toFixed(1)} ${(h - len).toFixed(1)}`,
    );
    p.setAttribute("stroke", `hsl(${hue.toFixed(0)} ${sat} ${light.toFixed(0)}%)`);
    p.setAttribute("stroke-width", thick.toFixed(2));
    p.setAttribute("fill", "none");
    p.setAttribute("stroke-linecap", "round");
    groups[i % NG].appendChild(p);
  }
  container.replaceChildren(svg);
}
