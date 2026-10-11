/*
 * Setzt das gespeicherte Hintergrund-Thema, bevor der erste Frame gemalt wird
 * (verhindert den Theme-Flash). Muss als klassisches Script direkt nach <body>
 * stehen – nicht als Modul, damit es vor dem Rest läuft.
 * Default ohne gespeicherte Auswahl: "auto" (nach Tageszeit).
 * IDs und "auto"-Logik müssen zu src/theme.ts passen.
 */
(function () {
  try {
    var ids = ["blossom", "day", "dusk", "night", "midnight", "auto"];
    var stored = localStorage.getItem("tamagotchi.bg");
    var v = stored && ids.indexOf(stored) !== -1 ? stored : "auto";
    var bg = v;
    if (v === "auto") {
      var h = new Date().getHours();
      bg = h >= 5 && h < 9 ? "blossom" : h >= 9 && h < 17 ? "day" : h >= 17 && h < 20 ? "dusk" : h >= 20 && h < 23 ? "night" : "midnight";
    }
    document.body.dataset.bg = bg;
  } catch (e) { /* ignore */ }
})();
