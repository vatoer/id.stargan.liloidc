# Deployment `liloidc.intihexa.id` — pengganti sementara KemluID

> **Untuk**: tim SuperApp dan tte-web (staging/uji) · **Kelas**: panduan deployment
> **Status**: berjalan · **Terakhir diverifikasi**: 2026-11-14

LiloIDC profil `kemluid` di VPS `vpskvm4` (76.13.19.72), untuk staging SuperApp (`sapp`,
`sapp-api`, aplikasi sumber) dan tte-web selama client KemluID asli (W1–W3) belum terbit.
**Bukan IdP produksi**: sesi dan token in-memory (restart = semua sesi dan refresh token hilang).

Discovery: <https://liloidc.intihexa.id/.well-known/openid-configuration>

## Susunan di server

```
Internet → edge-caddy (:443, Let's Encrypt, ~/edge/sites-enabled/liloidc.caddy)
         → jaringan docker "edge", alias liloidc-kemluid:9877
         → ~/liloidc  (docker compose -p liloidc, image liloidc:local dibangun di server)
            ├── .env              ISSUER, COOKIE_KEYS          (600, bukan dari repo)
            └── data/             users.json, clients.json, jwks.json (700/600, bukan dari repo)
```

Container: user 1000, filesystem read-only (kecuali `/data`), `cap_drop: ALL`, memori 256 MB,
tanpa port host. `jwks.json` dibuat sekali saat start pertama dan dipakai ulang, jadi id_token
tetap bisa diverifikasi setelah restart.

## Data

Pengguna dan client sama dengan `profiles/kemluid/` (lihat README profil), tetapi **password dan
secret diacak** oleh `gen-data.mjs`; nilai `password = username` dari repo publik tidak berlaku di
sini. Daftar kredensial disimpan di luar repo (di mesin yang menjalankan `gen-data.mjs`,
`CREDENTIALS.md`). Mintalah ke pengelola; jangan menaruhnya di repo atau issue.

| Client | Jenis | Untuk |
|---|---|---|
| `sapp` | publik, PKCE S256 | aplikasi SuperApp (redirect `app.sapp.mobile:/oauth2redirect`, loopback `http://127.0.0.1:8765/callback`) |
| `sapp-api` | resource server | introspeksi token `api:sapp` / `api:sapp.integrations` |
| `sumber-contoh` | `client_credentials` | aplikasi sumber percontohan |
| `ttev2` | confidential + resource `api:tte` | tte-web |

Menambah redirect: sunting `~/liloidc/data/clients.json` (dibaca ulang per request). Menambah
client ber-`resource_scope` baru butuh `docker compose -p liloidc restart`.

## Membuat ulang dan memperbarui

```bash
# di mesin lokal: data baru (password/secret baru!) ke folder di luar repo
node deploy/intihexa/gen-data.mjs ~/.liloidc-intihexa https://liloidc.intihexa.id

# perbarui kode di server (tanpa menimpa .env/data)
tar -cf - Dockerfile .dockerignore package.json package-lock.json index.js clients.json users.json \
  profiles/kemluid.js profiles/kemluid/users.json profiles/kemluid/clients.example.json \
  -C deploy/intihexa docker-compose.yml | ssh vpskvm4 'cd ~/liloidc && tar -xf - && docker compose -p liloidc up -d --build'
```

Site Caddy: salin `liloidc.caddy` ke `~/edge/sites-enabled/`, lalu
`docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile` dan
`docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile`.

Mencabut: `docker compose -p liloidc down`, hapus `~/edge/sites-enabled/liloidc.caddy`, reload
edge-caddy.

## Hasil uji 2026-11-14 (lewat internet)

| # | Skenario | Hasil |
|---|---|---|
| 1 | discovery | issuer dan semua endpoint `https://liloidc.intihexa.id/...`, tanpa `end_session_endpoint`; sertifikat Let's Encrypt |
| 2 | login PKCE `sapp` (`hendra.wijaya`) | kode + refresh token + id_token; `kid` id_token = `kid` di `jwks.json` server (bukan DEV_KEYSTORE) |
| 3 | refresh `openid api:sapp` → introspeksi `sapp-api` | aktif, `aud: sapp-api`; userinfo memuat `nip`, `roles`, `satker` |
| 4 | refresh `openid api:tte` → introspeksi `sapp-api` | tidak aktif (token per backend) |
| 5 | `sumber-contoh` `client_credentials` | aktif, `aud: sapp-api`, scope `api:sapp.integrations`; secret salah → `401` |
| 6 | login dengan password = username (nilai repo) | ditolak |
| 7 | restart/rebuild container | JWKS dipakai ulang; healthcheck `healthy` |
