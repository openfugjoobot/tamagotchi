# Cloudflare Worker: Spielstand pro Google-Konto

Dieser Worker bedient `https://tamagotchi.fugjoo.com/api/save` — same-origin, damit
kein CORS nötig ist. Er prüft das Google-ID-Token selbst (Signatur gegen Googles
öffentliches JWKS) und legt den Stand in KV ab. **Kein Secret liegt im Worker und
keines im Browser.**

Details: [`../docs/AUTH-SYNC.md`](../docs/AUTH-SYNC.md)

## Einmalig einrichten

1. **KV-Namespace anlegen**
   ```bash
   cd worker
   npx wrangler kv namespace create SAVES
   ```
   Die ausgegebene `id` in `wrangler.toml` bei `[[kv_namespaces]]` eintragen.

2. **Google-Client-ID** in `wrangler.toml` unter `[vars] GOOGLE_CLIENT_ID` und im
   Frontend in `../src/auth/config.ts` eintragen (dieselbe ID).

3. **Deployen**
   ```bash
   npx wrangler deploy
   ```
   Die Route `tamagotchi.fugjoo.com/api/*` steht in `wrangler.toml`; Cloudflare
   leitet diesen Pfad dann zuerst an den Worker, alles andere geht weiter an nginx.

## Lokal testen

```bash
cd worker
npx wrangler dev          # Worker auf http://localhost:8787
```

Das Frontend ruft `/api/save` relativ auf; im Dev-Server von Vite leitet ein Proxy
`/api` auf den Worker weiter (siehe `vite.config.ts`).

## Verify im Worker

Die Logik (Token-Prüfung, Last-Write-Wins, Fehlercodes) ist ohne Cloudflare testbar:
`npm run test` im Projektwurzelverzeichnis führt `tests/worker-*.test.ts` aus — die
Tests erzeugen ihren eigenen RSA-Schlüssel und ein eigenes JWKS.
