# Profil `kemluid` — LiloIDC sebagai pengganti KemluID untuk uji lokal

> **Untuk**: pengembang tte-web dan SuperApp (mobile, `sapp-api`) · **Kelas**: panduan uji (bukan produksi)
> **Status**: berlaku · **Terakhir diverifikasi**: 2026-11-08 terhadap tte-web `main`

LiloIDC dengan `LILO_PROFILE=kemluid` meniru perilaku KemluID (OpenIddict) yang diandalkan tte-web:
login web "Masuk dengan KemluID" dan jalur mobile 2a (token SuperApp ditukar menjadi sesi perangkat
tte-web, ADR-0024), serta yang diandalkan SuperApp: satu client publik `sapp` dengan token per
backend (ADR-005 SuperApp) dan `client_credentials` aplikasi sumber (W2b). Profil bawaan
(`stargan`) tidak berubah.

## Menjalankan

```bash
# opsional: client lokal (tidak dilacak git); tanpa ini dipakai clients.example.json
cp profiles/kemluid/clients.example.json profiles/kemluid/clients.json
# langsung
LILO_PROFILE=kemluid PORT=9877 node index.js
# atau docker
docker compose --profile kemluid up -d liloidc-kemluid
```

Discovery: `http://localhost:9877/.well-known/openid-configuration`.

Setelan tte-web (timpa lewat env; `.env` tidak perlu diubah):

```bash
AUTH_OIDC_ENABLED=true
KEMLUID_DISCOVERY_URL=http://localhost:9877/.well-known/openid-configuration
KEMLUID_CLIENT_ID=ttev2
KEMLUID_CLIENT_SECRET=ttev2-secret-lokal
AUTH_DEFAULT_ORG_SLUG=kemlu
# jalur mobile 2a
MOBILE_API_ENABLED=true
MOBILE_AUTH_GRANTS=kemluid_access_token,authorization_code
MOBILE_KEMLUID_AUDIENCE=ttev2
MOBILE_KEMLUID_ALLOWED_CLIENTS=sapp
```

Nilai client mengikuti deployment produksi T0 (2026-11-08): `client_id` `ttev2`, org default
`kemlu`. Redirect produksi diganti contoh `https://tte.example.com/...`. **Secret-nya sengaja bukan secret produksi**
(repo ini publik) — `ttev2-secret-lokal` hanya berlaku di LiloIDC. Jangan menyalin secret
produksi ke `clients.json` maupun `clients.example.json`.

## Yang ditiru

| Perilaku KemluID (tte-web `docs/oidc-kemluid.md`) | Profil `kemluid` |
|---|---|
| Endpoint OpenIddict `/connect/*` (path dicocokkan dengan discovery asli 2026-11-08) | `/connect/authorize`, `/connect/token`, `/connect/userinfo`, `/connect/introspect`, `/connect/revocation`, `/.well-known/jwks.json` |
| Tidak ada `end_session_endpoint` | logout RP dimatikan |
| `authorization_code` + PKCE `S256`, id_token RS256 | PKCE wajib, hanya S256 |
| Scope `openid profile email nip roles uuid jabatan satker addressbook:read offline_access` (discovery asli) | sama; `nip`, `roles`, `uuid`, `jabatan`, `satker` hanya lewat **userinfo** (id_token hanya klaim standar). Nama klaim `satker` masih **asumsi**; `addressbook:read` tanpa klaim |
| `jabatan` per 2026-10-13 tidak dikirim | hanya dikirim bila diisi di `users.json` |
| W1: client publik SuperApp, PKCE, App Link + skema reverse-domain iOS | client `sapp` (`token_endpoint_auth_method: none`) |
| ADR-005 SuperApp: satu login dengan `api:sapp` + `api:tte`, access token per backend lewat refresh dengan subset scope | refresh `scope=openid api:sapp` → `aud: sapp-api`; `scope=openid api:tte` → `aud: ttev2`; masing-masing hanya bisa diintrospeksi backend-nya |
| Backend Go: client confidential + resource `api:sapp` | client `sapp-api` (`resource_scope: "api:sapp api:sapp.integrations"`) |
| W2b: `client_credentials` aplikasi sumber, scope `api:sapp.integrations` | client `sumber-contoh`; token `aud: sapp-api`, tanpa pengguna (userinfo `401`) |
| W2: scope `api:tte` → `aud` = `client_id` tte-web; boleh diintrospeksi tte-web | client ber-`resource_scope` = resource server; token SuperApp ber-`aud: ttev2`, scope `api:tte` |
| Token yang sama dipakai tte-web untuk introspeksi **dan** userinfo | userinfo kustom menerima token ber-audience (oidc-provider bawaan menolaknya) |
| Introspeksi hanya oleh client presenter/audience | `allowedPolicy` disesuaikan |
| W3: refresh token ≥ 30 hari, bergulir; `offline_access` tanpa `prompt=consent` | TTL 30 hari, rotasi; `prompt=consent` ditambahkan otomatis |
| Access token terenkripsi (JWE) | access token opak (sama-sama tidak bisa dibaca client) |

## Data uji

`users.json` (password = username):

| Username | Email | Untuk menguji |
|---|---|---|
| `rina.pratiwi` | `rina.pratiwi@idp.test` | akun baru → autoprovision tte-web; jalur 2a |
| `signer` | `signer@tte.test` | penautan ke akun lokal tte-web yang emailnya terverifikasi |
| `belum.verifikasi` | `signer2@tte.test` | `email_verified: false` → tte-web menolak penautan (`account_not_linked`) |
| `budi.santoso` | `budi.santoso@idp.test` | klaim `jabatan` dan beberapa `roles` |
| `dewi.lestari` | `dewi.lestari@idp.test` | akun baru cadangan bila `rina.pratiwi` sudah pernah diprovisikan di DB lokal |

`clients.example.json` (templat; salinan lokal `clients.json` tidak dilacak git): `ttev2` (client tte-web; confidential, redirect contoh `https://tte.example.com/api/auth/callback/kemluid`
dan dev `http://localhost:3000/api/auth/callback/kemluid`, `resource_scope: api:tte`), `sapp` (publik; redirect App Link
`https://app.example.com/auth/callback`, skema iOS `com.example.sapp:/oauth2redirect`, dan loopback
`http://127.0.0.1:8765/callback` untuk alat uji seperti tte-web `scripts/kemluid-probe.mjs`), `sapp-api`
(resource server backend Go, secret `sapp-api-secret-lokal`, hanya untuk introspeksi), dan `sumber-contoh`
(aplikasi sumber, `client_credentials`, secret `sumber-contoh-secret-lokal`).

## Hasil uji 2026-11-08 (tte-web `main` + profil ini, client `ttev2`, org `kemlu`)

| # | Skenario | Hasil |
|---|---|---|
| W1 | login web akun baru (`dewi.lestari`) | masuk; `nip`, `idp_sub`, `idp_roles` tersimpan; membership `kemlu/user` |
| W2 | login web, email sama dengan akun lokal terverifikasi | masuk; akun `kemluid` tertaut |
| W3 | login web, IdP `email_verified: false` | ditolak `account_not_linked` |
| W4 | login web dengan `jabatan` | `jabatan` tersimpan |
| M1–M2 | token SuperApp (`aud: ttev2`) → `POST /api/mobile/v1/auth/token` dengan DPoP → `GET /me` | `200`, `tokenType: DPoP` |
| M3 | token login web (tanpa `aud: ttev2`) ke jalur 2a | `401 MOBILE_UPSTREAM_TOKEN_INVALID` (`audience`) |
| M4 | token palsu | `401 MOBILE_UPSTREAM_TOKEN_INVALID` (`inactive`) |
| M5 | token `sapp` ber-`aud: sapp-api` (`api:sapp`) ke jalur 2a | `401 MOBILE_UPSTREAM_TOKEN_INVALID` |
| S1 | login `sapp` (`api:sapp api:tte offline_access`), refresh `openid api:sapp` | `aud: sapp-api`, scope `api:sapp`; introspeksi `ttev2` → tidak aktif; userinfo `200` |
| S2 | refresh berikutnya `openid api:tte` | `aud: ttev2`, scope `api:tte`; introspeksi `sapp-api` → tidak aktif |
| S3 | `sapp` meminta `api:sapp.integrations` | `400 invalid_scope` |
| S4 | `sumber-contoh` `client_credentials` `api:sapp.integrations` | `200`; introspeksi `sapp-api` aktif, `ttev2` tidak; userinfo `401` |
| S5 | `sumber-contoh` meminta `api:sapp` | `400 invalid_scope` |

## Batasan

- Kunci tanda tangan dibuat ulang setiap start (dev key oidc-provider); token lama tidak valid
  setelah restart. Sesi dan token in-memory.
- `claims_supported` di discovery memuat klaim tambahan (KemluID asli hanya
  `sub, name, preferred_username, email, email_verified`). Tidak memengaruhi tte-web.
- Issuer tanpa garis miring penutup (KemluID: `https://oms.kemlu.go.id/`).
- Menambah client ber-`resource_scope` baru butuh restart; perubahan client lain tetap hot-reload.
- Bentuk klaim `roles` di KemluID asli belum terkonfirmasi; di sini array string. tte-web
  menormalkan keduanya (`normalizeIdpRoles`).
- Nama dan bentuk klaim scope `satker` belum terkonfirmasi.
- Menukar kode tanpa parameter `scope` saat login meminta beberapa scope API menghasilkan token
  untuk **satu** backend saja (yang pertama); token per backend diambil lewat refresh (ADR-005).
  Apakah KemluID asli menerbitkan satu token ber-`aud` ganda dalam kasus itu belum diketahui.
- `kemluid.js` dibundel ke image Docker: perubahan kode profil butuh
  `docker compose --profile kemluid up -d --build liloidc-kemluid`.
- Yang sudah dipastikan dari discovery asli dan yang masih dugaan dicatat di
  tte-web `docs/oidc-kemluid.md`. Alat untuk memastikan sisanya: tte-web
  `scripts/kemluid-probe.mjs`.
