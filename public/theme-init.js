/*
 * Setzt das gespeicherte Hintergrund-Thema, bevor der erste Frame gemalt wird
 * (verhindert den Theme-Flash). Muss als klassisches Script direkt nach <body>
 * stehen – nicht als Modul, damit es vor dem Rest läuft.
 * Die IDs müssen zu src/theme.ts passen.
 */
(function () {
  try {
    var ids = ["day", "blossom", "forest", "dusk", "night", "midnight"];
    var bg = localStorage.getItem("tamagotchi.bg");
    if (bg && ids.indexOf(bg) !== -1) document.body.dataset.bg = bg;
  } catch (e) { /* ignore */ }
})();
