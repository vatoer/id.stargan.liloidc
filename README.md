# LiloIDC

OIDC Identity Provider superlite untuk development dan testing: "Mailpit"-nya IdP OIDC. Pengguna
dan client ditulis di berkas JSON, sesi in-memory, satu halaman login. Dibangun di atas
[`oidc-provider`](https://github.com/panva/node-oidc-provider) (certified OpenID Connect).

> **Bukan untuk produksi.** Password tersimpan polos, kunci tanda tangan dibuat ulang setiap start,
> dan restart = semua sesi dan token hilang.

## Mulai cepat

Butuh Node.js ≥ 24.

```bash
npm ci
npm start                       # http://localhost:9876
```

Discovery: `http://localhost:9876/.well-known/openid-configuration`. Coba login dengan `alice` /
`alice`.

Docker:

```bash
docker compose up -d liloidc                                    # profil bawaan, port 9876
docker compose --profile kemluid up -d liloidc-kemluid          # profil kemluid, port 9877
```

## Konfigurasi

| Env | Bawaan | Isi |
|---|---|---|
| `PORT` | `9876` | port HTTP |
| `ISSUER` | `http://localhost:<PORT>` | URL issuer (yang dilihat client) |
| `LILO_PROFILE` | `stargan` | perilaku IdP: `stargan` atau `kemluid` (lihat di bawah) |
| `USERS_FILE` | `users.json` milik profil | berkas pengguna |
| `CLIENTS_FILE` | `clients.json` milik profil | berkas client |
| `NODE_ENV` | — | `production` = percaya header `X-Forwarded-*` dari reverse proxy |

`users.json` dan `clients.json` dibaca ulang pada setiap request, jadi perubahan berlaku tanpa
restart.

### `users.json`

```json
[{ "username": "alice", "password": "alice", "email": "alice@stargan.id", "name": "Alice Example", "role": "employee", "nip": "198001010000000001" }]
```

### `clients.json`

```json
[{
  "client_id": "web",
  "client_secret": "secret",
  "redirect_uris": ["http://localhost:3090/auth/oidc/callback"],
  "post_logout_redirect_uris": ["http://localhost:3090"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "openid email profile employee offline_access"
}]
```

Client publik (mobile/SPA): `"application_type": "native"` dan
`"token_endpoint_auth_method": "none"`, lalu pakai PKCE.

## Profil

### `stargan` (bawaan)

| Endpoint | Path |
|---|---|
| authorization | `/auth` |
| token | `/token` |
| userinfo | `/me` |
| logout | `/session/end` |
| jwks | `/jwks` |

| Scope | Klaim |
|---|---|
| `openid` | `sub` |
| `email` | `email`, `email_verified` |
| `profile` | `name`, `preferred_username`, `role` |
| `employee` | `nip` |

PKCE opsional. Klaim scope ikut di id_token.

### `kemluid`

Meniru KemluID (OpenIddict) untuk uji lokal tte-web dan modul TTE SuperApp: endpoint `/connect/*`,
PKCE S256 wajib, klaim `nip`/`roles`/`uuid`/`jabatan` hanya lewat userinfo, tanpa logout RP,
client publik SuperApp, dan scope resource `api:<modul>` yang menghasilkan token ber-audience
backend modul yang bisa diintrospeksi. Data dan dokumentasinya ada di
[`profiles/kemluid/`](profiles/kemluid/README.md).

```bash
LILO_PROFILE=kemluid PORT=9877 npm start
```

## Struktur

```
index.js              server, adapter, login/logout UI
profiles/kemluid.js   perilaku profil kemluid
profiles/kemluid/     users.json, clients.json, README.md profil kemluid
users.json            pengguna profil bawaan
clients.json          client profil bawaan
```

## Deploy

Push ke `main` men-deploy otomatis ke `demoid.stargan.id` (GitHub Actions → rsync → PM2) dengan
profil bawaan. Rinciannya di [`DEPLOY.md`](DEPLOY.md); pemulihan PM2 setelah reboot di
[`pm2-recovery.md`](pm2-recovery.md). Latar belakang rancangan: [`ideation.md`](ideation.md).
