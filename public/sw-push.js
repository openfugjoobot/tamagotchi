// Tamagotchi PWA – Web-Push-Empfang im Service Worker.
//
// Warum eine eigene Datei und nicht direkt in `sw.js`: `sw.js` ist ein
// klassisches Worker-Skript mit dem Build-Platzhalter `__SW_VERSION__` und
// laesst sich deshalb nicht in Vitest importieren. Die Push-Logik hier ist
// reines Verhalten (kein Precache, kein Fetch) und wird von `sw.js` per
// `importScripts("sw-push.js")` geladen – dasselbe Muster wie bei der
// Boot-Gardine (Task 11): herausziehen, damit es testbar ist, den Aufrufer
// duenn halten. Die Precache-/Offline-Logik in `sw.js` bleibt unberuehrt.
//
// Vertrag (Spec §4, Payload aus Task 7 `{title, body, petId}`):
//   * `push` zeigt eine Notification mit `tag = pet:<petId>`, damit ein
//     Folge-Beep desselben Tieres die vorige ersetzt statt sich zu stapeln.
//   * `notificationclick` fokussiert einen offenen Tab, sonst oeffnet er `/`.
//   * Ein fehlender/ kaputter Payload wirft nie – der Worker bleibt am Leben.

/* global self */

(function () {
  "use strict";

  /** Notification, wenn der Server ausnahmsweise keinen Titel mitschickt. */
  var DEFAULT_TITLE = "Tamagotchi";

  /**
   * Liest den Task-7-Payload defensiv. Ein `push` ohne JSON (oder mit
   * unerwartetem Typ) darf den Worker nicht umbringen, also immer ein Objekt
   * zurueckgeben.
   */
  function readPayload(event) {
    var data = event && event.data;
    if (data == null) return {};
    try {
      var parsed = typeof data.json === "function" ? data.json() : data;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  /**
   * Ein Beep pro Tier ersetzt den vorigen: der `tag` haengt am `petId`.
   * Ohne `petId` faellt er auf einen stabilen Tier-Tag zurueck.
   */
  function tagFor(petId) {
    return "pet:" + (petId == null ? "" : String(petId));
  }

  function handlePush(event) {
    var payload = readPayload(event);
    var title = typeof payload.title === "string" && payload.title ? payload.title : DEFAULT_TITLE;
    var options = {
      body: typeof payload.body === "string" ? payload.body : "",
      tag: tagFor(payload.petId),
      icon: "/icons/icon-192-v2.png",
      badge: "/icons/icon-192-v2.png",
      data: { petId: payload.petId == null ? null : String(payload.petId) },
    };
    event.waitUntil(self.registration.showNotification(title, options));
  }

  function handleClick(event) {
    event.notification.close();
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (all) {
        for (var i = 0; i < all.length; i++) {
          if ("focus" in all[i]) return all[i].focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow("/");
        return undefined;
      }),
    );
  }

  self.addEventListener("push", handlePush);
  self.addEventListener("notificationclick", handleClick);
})();
