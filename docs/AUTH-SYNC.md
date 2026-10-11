# Konto & Cloud-Speicher (Entwurf)

Ziel: Der Spielstand soll optional **pro Google-Konto** in der Cloud liegen und auf
jedem Gerät automatisch geladen werden. Lokal-first bleibt: ohne Anmeldung ändert
sich nichts.

## Architektur

```
Browser ──(Google Identity Services, ID-Token)──> Google
   │
   └── fetch /api/save  (same-origin, Bearer <idToken>)
            │
            └── Cloudflare Worker  ──►  KV-Namespace (1 Eintrag pro Nutzer)
```

- **Kein eigener Server.** Der Worker läuft auf Cloudflares Edge; die Domain ist eh
  dort, also liegt `/api/*` same-origin (kein CORS, keine Cookies).
- **Kein Secret im Umlauf.** Der Worker prüft Googles Signatur gegen das öffentliche
  JWKS. Client-ID ist öffentlich, im Worker liegt nichts Geheimes.
- **KV** als Speicher: ein Schlüssel `save:<google-sub>` mit
  `{ snapshot, updatedAt, saveVer }`. `snapshot` ist `base64(gzip(WASM-Speicher))`
  ≈ 23 KB (dieselbe Kodierung wie `src/storage/persist.ts`).

## Endpunkte

| Methode | Pfad | Antwort |
|---|---|---|
| GET | `/api/save` | `200 {snapshot, updatedAt, saveVer}` oder `404` |
| PUT | `/api/save` | Body `{snapshot, updatedAt, saveVer}`; schreibt nur, wenn neuer; `200 {ok}` bzw. `{skipped:true}` |
| DELETE | `/api/save` | löscht den Eintrag („meine Daten entfernen") |

Regeln: `401` ohne gültiges Token, `400` bei kaputtem Body, `413` über 64 KB,
`404/405` sonst. **Last-Write-Wins liegt im Server** — ein altes Gerät mit
verstaubtem Stand kann den aktuellen nicht überschreiben.

## Anmelde-Flow

1. Nutzer tippt „Anmelden" → Google Identity Services rendert den Button.
2. Google liefert ein **ID-Token (JWT, ~1 h gültig)** an die Seite.
3. Token wird im Speicher gehalten (plus `sessionStorage` mit Ablaufzeit); Requests
   gehen mit dem Token im Authorization-Header raus.
4. **Token-Erneuerung:** vor Ablauf still neu holen (`google.accounts.id.prompt()`),
   sonst Nutzer zum erneuten Klick auffordern.

## Sync-Policy

- **Beim Start** (nach dem Emulator-Boot): `GET /api/save`.
  - Cloud neuer als lokal (bzw. lokal leer) → Cloud-Stand laden.
  - Lokal neuer (bzw. Cloud leer) → lokalen Stand hochschieben.
  - Gleich alt → nichts.
- **Beim Speichern**: der lokale Autosave bleibt wie er ist; ein Cloud-Push läuft
  entkoppelt (entprellt, max. alle ~2 min) und zusätzlich bei `visibilitychange`.
- **Offline**: Pushes landen in einer kleinen Warteschlange und gehen raus, sobald
  wieder Netz da ist. Ein Fehlschlag ist nie ein Spielproblem.
- **Merging gibt es nicht**: Es gilt „der neuere Snapshot gewinnt", das andere Gerät
  holt beim nächsten Start per catch-up bis „jetzt" auf (§ Zeitmodell).

## Datenschutz

Gespeichert werden ausschließlich: Google-Konto-ID (`sub`), E-Mail/Name nur zur
Anzeige („angemeldet als …") und der Spielstand. Keine Telemetrie. `DELETE /api/save`
plus „Abmelden" löschen lokal und serverseitig. Ein kurzer Absatz dazu gehört auf die
Anleitungsseite, sobald die Funktion aktiv ist.

## Einmalig einzurichten (nur Ivan)

1. **Google Cloud Console**: Projekt → OAuth-Zustimmungsbildschirm → Anmeldedaten →
   OAuth-Client-ID vom Typ „Webanwendung", erlaubter JavaScript-Ursprung
   `https://tamagotchi.fugjoo.com` (+ `http://localhost:5173` für dev). Keine
   Redirect-URI nötig.
2. **Cloudflare**: KV-Namespace `tamagotchi-saves` anlegen, Worker deployen
   (`cd worker && npx wrangler deploy`), Route `tamagotchi.fugjoo.com/api/*` → Worker.
3. Client-ID in `src/auth/config.ts` eintragen, bauen, deployen. Vorher ist die
   Funktion aus (kein UI, kein Request).

## Aufwand

Spec + Worker + Tests + Client-Anbindung: ~1 Tag. Ohne Konten-Zugang ist die
End-to-End-Probe erst nach Schritt 1–3 möglich; Worker-Logik und Sync-Entscheidung
sind aber ohne Zugangsdaten testbar (JWKS wird im Test selbst erzeugt).
