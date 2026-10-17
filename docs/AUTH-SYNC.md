# Konto, Auth & Spielstand-Sync

Der Spielstand lebt **auf dem Server** (Postgres), nicht mehr in localStorage und
nicht mehr in Cloudflare KV. Der Browser ist Fenster: er meldet sich mit einem
Google-ID-Token an und arbeitet dann über denselben Host per REST (`/api/*`) und
WebSocket (`/ws`).

## Architektur

```
Browser ──(Google Identity Services, ID-Token)──> Google
   │
   ├── fetch /api/*      (same-origin, Authorization: Bearer <idToken>)
   └── WS    /ws          (hello-Nachricht mit Token + petId)
            │
            ▼
     tamagotchi-server (Node, fastify + ws)  ──►  Postgres
        server/src/auth.ts  prüft Token gegen Googles JWKS (öffentlich)
```

- **Kein Cloudflare Worker mehr.** Ein Isolate kann nicht dauerhaft pro Nutzer
  ticken; der Dienst läuft jetzt always-on auf dem fugjoo-Host
  (`server/src/main.ts`). Siehe [DECISIONS.md](./DECISIONS.md).
- **Kein Secret im Umlauf.** Der Server prüft die Token-Signatur gegen Googles
  öffentliches **JWKS**. Die Client-ID ist öffentlich; serverseitig liegt kein
  Google-Secret. (VAPID-Keys für Web Push sind separat, siehe unten.)
- **Kein Token im Server gespeichert.** Der Client hält das ID-Token (im Speicher
  plus `sessionStorage` mit Ablaufzeit) und schickt es bei jedem Request mit.

## Auth-Pfad

1. Nutzer tippt „Anmelden" → Google Identity Services rendert den Button.
2. Google liefert ein **ID-Token (JWT, ~1 h gültig)** an die Seite.
3. Jeder REST-Aufruf geht mit `Authorization: Bearer <idToken>` raus; der
   Server prüft die Signatur (`server/src/auth.ts`) und löst `sub` zu einer
   internen `users.id` auf (`Repo.upsertUser`).
4. Der WebSocket bindet sich erst nach einer `hello`-Nachricht mit Token+petId
   (`server/src/ws.ts`): Token prüfen → Tier laden (nutzer-scoped) → Socket an
   `(userId, petId)` binden. Ohne gültiges Token: Close-Code `4401`.
5. **Token-Erneuerung:** vor Ablauf still neu holen (`google.accounts.id.prompt()`),
   sonst Nutzer zum erneuten Klick auffordern.

## Endpunkte (REST, alle nutzer-scoped)

| Methode | Pfad | Antwort |
|---|---|---|
| GET | `/api/pets` | Liste der Tiere des Nutzers (mit `alive`, `diedAt`, `ageYears`) |
| POST | `/api/pets` | Body `{device:"p1"\|"p2"}` → legt ein Tier an und startet es live |
| GET | `/api/pets/:id/slots` | Speicherstände zum Gerät dieses Tiers |
| POST | `/api/pets/:id/slots` | Body `{label}` → legt einen Slot an (snapshottet den aktuellen Stand) |
| DELETE | `/api/slots/:id` | löscht einen Slot |
| GET | `/api/settings` | Einstellungen (über Defaults gemerged) |
| PUT | `/api/settings` | partielles Update, allow-listed (`theme/lang/shell/sound/push`) |
| POST | `/api/push/subscribe` | Body `{endpoint,p256dh,auth}` → registriert ein Push-Abo |
| POST | `/api/push/unsubscribe` | Body `{endpoint}` → entfernt das Abo (**eigenes** Abo) |
| GET | `/api/beeps` | letzte Beeps des Nutzers (max. 50, **ohne Grund**) |

Regeln (spec §7): fehlendes/ungültiges Token → `401` (Body nennt keinen Grund,
keine Existenz-Orakel). Eine Ressource, die dem Aufrufer nicht gehört, ist von
einer nicht existierenden **nicht unterscheidbar** → `404`. `400` bei kaputtem
Body, `404/405` sonst.

## WS-Protokoll

| Richtung | Nachricht | Bedeutung |
|---|---|---|
| → | `{t:"hello", token, petId}` | anmelden und an ein Tier binden |
| ← | `{t:"frame", lcd:number[], icons:number[]}` | aktueller 32×16-LCD + 8 Icon-Segmente (nur bei Änderung) |
| ← | `{t:"buzzer", freq, on}` | Piezo-Zustand des serverseitigen Tiers (nur bei Änderung; der Tab speist damit sein Audio) |
| ← | `{t:"state", alive, ageYears}` | beim Binden und bei jedem Lebenszustands-Wechsel |
| → | `{t:"press", btn:"left"\|"middle"\|"right"}` | Tastendruck |

## Spielstand-Sync

Es gibt **eine Quelle** — den Server. Ein lokaler Tab-Snapshot existiert nicht mehr.

- Der Server tickt jedes Tier in Echtzeit und schreibt `pets.state` gedrosselt
  (max. alle 60 s) und beim Tod.
- Beim Server-Boot werden alle lebenden Tiere rehydriert und über `last_tick_at`
  nachgeholt (`stepInSlices`, 60-s-Scheiben).
- **Kein Merging, keine Konflikte** — es gibt nichts zu mergen.
- Manuelle **Speicherstände** (Slots) sind ein separates Feature: anlegen/löschen
  über die API, das Laden eines Slots ist serverseitig noch nicht verdrahtet
  (bekannte Lücke, siehe unten).

## Push (Web Push / VAPID)

- Der Server verschickt **generische** Beep-Benachrichtigungen (`server/src/push.ts`)
  an alle Push-Abos eines Nutzers — aber **nur**, wenn dieser Nutzer **keine aktive
  WS-Verbindung** hat (`hasLiveConnection`). Wer zusieht, hört den Beep live; eine
  System-Notification wäre redundant.
- Erfolgreicher Versand setzt `beeps.notified_at`; `410 Gone` löscht das Abo
  (nutzer-scoped); andere Fehler bleiben liegen und werden beim nächsten Sweep
  (alle 30 s) erneut versucht.
- VAPID-Keys kommen aus der Umgebung (`VAPID_SUBJECT`/`VAPID_PUBLIC_KEY`/
  `VAPID_PRIVATE_KEY`), nie aus dem Repo.

## Datenschutz

Gespeichert werden: Google-Konto-ID (`sub`), E-Mail/Name/Avatar (in der DB,
zur Anzeige), der Spielstand, Einstellungen und Push-Abos. Keine Telemetrie.
„Abmelden" verwirft nur das lokale Token; das Konto in der DB bleibt gespeichert.
Ein Löschen des Kontos ist derzeit **nicht implementiert** (kein
`DELETE /api/account`). Der Menüpunkt heißt deshalb ehrlich „Konto löschen
(nicht verfügbar)" und der Bestätigen-Button im Dialog „Abmelden" — der Klick
meldet nur lokal ab und entfernt keine serverseitigen Daten. Bis eine Löschroute
existiert, bleibt das Konto samt Daten bestehen.

## Einmalig einzurichten (Betrieb)

1. **Google Cloud Console**: OAuth-Client-ID (Typ „Webanwendung"), erlaubter
   JavaScript-Ursprung `https://tamagotchi.fugjoo.com` (+ `http://localhost:5173`
   für dev). Keine Redirect-URI nötig. Werte: `GOOGLE_CLIENT_ID` (Server + Client).
2. **Postgres** starten (`server/docker-compose.yml`), `DATABASE_URL` setzen.
3. **VAPID-Paar** erzeugen (`npx web-push generate-vapid-keys`) und als Env/Secrets
   hinterlegen.
4. **Server** deployen (`docker compose -f server/docker-compose.yml up -d --build`),
   Route `tamagotchi.fugjoo.com/api/*` **und** `/ws` (Upgrade) → Container.
5. Client-ID im Browser-Build setzen. Vorher ist die Konto-Funktion aus.

Die vollständige Start-Anleitung steht in [README.md](./README.md); Server-Details
in [ARCHITECTURE.md](./ARCHITECTURE.md).
