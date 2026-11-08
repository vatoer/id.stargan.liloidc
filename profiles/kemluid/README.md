# Profil `kemluid` — LiloIDC sebagai pengganti KemluID untuk uji lokal

> **Untuk**: pengembang tte-web dan modul TTE SuperApp · **Kelas**: panduan uji (bukan produksi)
> **Status**: berlaku · **Terakhir diverifikasi**: 2026-11-08 terhadap tte-web `main`

LiloIDC dengan `LILO_PROFILE=kemluid` meniru perilaku KemluID (OpenIddict) yang diandalkan tte-web:
login web "Masuk dengan KemluID" dan jalur mobile 2a (token SuperApp ditukar menjadi sesi perangkat
tte-web, ADR-0024). Profil bawaan (`stargan`) tidak berubah.

## Menjalankan

```bash
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
KEMLUID_CLIENT_ID=tte-web
KEMLUID_CLIENT_SECRET=tte-web-secret
AUTH_DEFAULT_ORG_SLUG=<slug org default di DB lokal>
# jalur mobile 2a
MOBILE_API_ENABLED=true
MOBILE_AUTH_GRANTS=kemluid_access_token,authorization_code
MOBILE_KEMLUID_AUDIENCE=tte-web
MOBILE_KEMLUID_ALLOWED_CLIENTS=superapp
```

## Yang ditiru

| Perilaku KemluID (tte-web `docs/oidc-kemluid.md`) | Profil `kemluid` |
|---|---|
| Endpoint OpenIddict `/connect/*` (path dicocokkan dengan discovery asli 2026-11-08) | `/connect/authorize`, `/connect/token`, `/connect/userinfo`, `/connect/introspect`, `/connect/revocation`, `/.well-known/jwks.json` |
| Tidak ada `end_session_endpoint` | logout RP dimatikan |
| `authorization_code` + PKCE `S256`, id_token RS256 | PKCE wajib, hanya S256 |
| Scope `openid profile email nip roles uuid jabatan satker addressbook:read offline_access` (discovery asli) | sama; `nip`, `roles`, `uuid`, `jabatan`, `satker` hanya lewat **userinfo** (id_token hanya klaim standar). Nama klaim `satker` masih **asumsi**; `addressbook:read` tanpa klaim |
| `jabatan` per 2026-10-13 tidak dikirim | hanya dikirim bila diisi di `users.json` |
| W1: client publik SuperApp, PKCE, App Link | client `superapp` (`token_endpoint_auth_method: none`) |
| W2: scope `api:tte` → `aud` = `client_id` tte-web; boleh diintrospeksi tte-web | client ber-`resource_scope` = resource server; token SuperApp ber-`aud: tte-web`, scope `api:tte` |
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

`clients.json`: `tte-web` (confidential, redirect `http://localhost:3000/api/auth/callback/kemluid`,
`resource_scope: api:tte`) dan `superapp` (publik; redirect App Link `https://app.example/tte/callback`, skema iOS `id.example.superapp:/callback`, dan loopback `http://127.0.0.1:8765/callback` untuk alat uji seperti tte-web `scripts/kemluid-probe.mjs`).

## Hasil uji 2026-11-08 (tte-web `main` + profil ini)

| # | Skenario | Hasil |
|---|---|---|
| W1 | login web akun baru | masuk; `nip`, `idp_sub`, `idp_roles` tersimpan; membership org default peran `user` |
| W2 | login web, email sama dengan akun lokal terverifikasi | masuk; akun `kemluid` tertaut |
| W3 | login web, IdP `email_verified: false` | ditolak `account_not_linked` |
| W4 | login web dengan `jabatan` | `jabatan` tersimpan |
| M1–M2 | token SuperApp (`aud: tte-web`) → `POST /api/mobile/v1/auth/token` dengan DPoP → `GET /me` | `200`, `tokenType: DPoP` |
| M3 | token login web (tanpa `aud` tte-web) ke jalur 2a | `401 MOBILE_UPSTREAM_TOKEN_INVALID` (`audience`) |
| M4 | token palsu | `401 MOBILE_UPSTREAM_TOKEN_INVALID` (`inactive`) |

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
- `grant_types_supported` KemluID memuat `client_credentials`; profil ini belum menirunya.
- Yang sudah dipastikan dari discovery asli dan yang masih dugaan dicatat di
  tte-web `docs/oidc-kemluid.md`. Alat untuk memastikan sisanya: tte-web
  `scripts/kemluid-probe.mjs`.
