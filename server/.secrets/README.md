# Server secrets (never committed)

This directory holds runtime secrets for the tamagotchi server. Everything here
is gitignored except this README.

## `tamagotchi.env`

`KEY=value` per line, read by `server/docker-compose.yml` as the Postgres
container's `env_file`. Required:

```
POSTGRES_PASSWORD=<long-random-string>
```

Generate a password with `openssl rand -base64 32`. Do not commit it, do not
paste it into Compose files, docs, or chat — reference this path instead.
