# Konto einrichten — Schritt für Schritt

Ziel: Spielstand pro Google-Konto. Dauert ~10 Minuten, alles klickbar. Am Ende
trägst du zwei Werte ein und ich baue.

---

## 1. Google: Anmelde-Schlüssel anlegen

1. **Projekt anlegen** (falls du keins hast):
   👉 https://console.cloud.google.com/projectcreate
   Name z. B. `tamagotchi` → **Erstellen**.

2. **Zustimmungsbildschirm** (heißt jetzt „Google Auth Platform"):
   👉 https://console.cloud.google.com/auth/overview
   - **Get started**: App-Name `Tamagotchi P1`, deine Support-E-Mail, Entwickler-Kontakt.
   - **Audience**: `External` → **Create**.
   - Danach unter **Audience** → **Add users**: deine eigene Google-Adresse als
     **Test user** eintragen. (Im Test-Modus funktioniert die Anmeldung sofort, ganz
     ohne Google-Prüfung — es reicht, wenn du dich selbst einträgst.)

3. **Client-ID erzeugen**:
   👉 https://console.cloud.google.com/auth/clients
   - **Create client** → Typ **Web application**, Name `tamagotchi-web`.
   - Bei **Authorized JavaScript origins** genau das hier eintragen:
     ```
     https://tamagotchi.fugjoo.com
     http://localhost:5173
     ```
     (Weiterleitungs-URLs brauchen wir **nicht**.)
   - **Create** → es erscheint eine **Client-ID**, die aussieht wie
     `1234567890-abcdefg.apps.googleusercontent.com`.
   - **Diese ID kopieren und mir schicken** (sie ist öffentlich, kein Geheimnis).

---

## 2. Cloudflare: Speicher + Worker

Ein Terminal, drei Befehle. Du brauchst keine Datei anzufassen.

```bash
cd ~/projects/tamagotchi/worker
npx wrangler login                      # Browser öffnet sich → „Allow"
npx wrangler kv namespace create SAVES  # gibt eine id aus: {"id":"abc123…"}
npx wrangler deploy
```

Die ausgegebene **id** (nur die Zeichenfolge, ohne Anführungszeichen) in
`wrangler.toml` bei `id = "TODO_KV_NAMESPACE_ID"` einsetzen — oder mir schicken,
dann mache ich das.

Wenn `allow`/`deploy` durchläuft, steht der Endpunkt unter:
👉 https://dash.cloudflare.com/?to=/:account/workers-and-pages

---

## 3. Fertig machen

Mir die **Client-ID** schicken. Ich trage sie ein, baue, deploye und teste den
Login-Durchlauf. Danach: Menü → **Konto** → „Sign in with Google".

---

## Wenn was klemmt

| Symptom | Ursache |
|---|---|
| `Error 400: redirect_uri_mismatch` | Ursprung in Schritt 1.3 falsch (muss exakt `https://tamagotchi.fugjoo.com` sein, ohne `/` am Ende). |
| „Access blocked: app not verified" | Du bist nicht als Test user eingetragen (Schritt 1.2). |
| Anmeldung klappt, aber kein Abgleich | Route fehlt: in Cloudflare unter *Workers → tamagotchi-saves → Settings → Domains & Routes* `tamagotchi.fugjoo.com/api/*` prüfen. |
| `wrangler` fragt nach Konto/Zone | `npx wrangler login` nochmal; die Zone `fugjoo.com` muss im selben Konto liegen. |

## Technische Details

- Endpunkt: `GET/PUT/DELETE /api/save`, Auth per Google-ID-Token, Prüfung gegen
  Googles JWKS im Worker (kein Secret nötig).
- Speicher: ein KV-Eintrag `save:<google-sub>` pro Nutzer, Last-Write-Wins.
- Entwurf/Datenmodell: [`../docs/AUTH-SYNC.md`](../docs/AUTH-SYNC.md)
- Tests ohne Zugänge: `npm run test` (erzeugt eigenen Schlüssel + JWKS).
