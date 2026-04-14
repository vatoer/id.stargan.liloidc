# LiloIDC — Superlite OIDC Identity Provider

## Tujuan

OIDC Identity Provider superlite untuk development & testing — "Mailpit"-nya IdP OIDC.
Zero-config, langsung jalan, tidak untuk production.

## Prinsip

- Se-ringan mungkin, minimal setup
- User & client hardcoded di file JSON — tanpa hashing, tanpa database
- Session in-memory — restart = logout semua
- Login UI minimal — satu halaman HTML form
- Single dependency utama: `oidc-provider` (Node.js) — certified OpenID Connect

## Stack

- **Node.js** + **oidc-provider** (npm)
- Alasan: library sudah mature & certified, cukup config ~200 baris, paling efektif
- Tidak perlu framework (Express/Koa minimal hanya untuk serve)

## OIDC Flows

- Authorization Code Flow (wajib)
- Authorization Code + PKCE (untuk SPA/mobile)
- Client Credentials (service-to-service) — opsional

## Endpoints (otomatis dari oidc-provider)

- `GET /.well-known/openid-configuration` — discovery
- `GET /auth` — authorization + login form
- `POST /token` — token exchange
- `GET /userinfo` — user claims
- `GET /jwks` — public keys (JWT verification)

## Config Files

### `users.json`
```json
[
  {"username": "alice", "password": "alice", "email": "alice@example.com", "name": "Alice"},
  {"username": "bob", "password": "bob", "email": "bob@example.com", "name": "Bob"}
]
```

### `clients.json`
```json
[
  {
    "client_id": "my-app",
    "client_secret": "secret",
    "redirect_uris": ["http://localhost:3000/callback"],
    "grant_types": ["authorization_code"],
    "response_types": ["code"]
  }
]
```

## Fitur

- Login form HTML sederhana
- Hardcoded users & clients dari file JSON
- Discovery endpoint untuk auto-config
- JWT access & id tokens
- Session in-memory (tidak persist)
