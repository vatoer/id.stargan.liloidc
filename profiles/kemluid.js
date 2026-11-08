// Profil "kemluid": LiloIDC meniru perilaku KemluID (OpenIddict) yang diandalkan tte-web, supaya
// login web dan jalur mobile 2a (ADR-0024 tte-web) bisa diuji lokal tanpa IdP sungguhan.
//
// Aktif dengan LILO_PROFILE=kemluid. Profil bawaan (stargan) tidak berubah sama sekali.
//
// Yang ditiru (sumber: tte-web/docs/oidc-kemluid.md):
// - endpoint OpenIddict /connect/* ; tanpa end_session_endpoint;
// - authorization_code + PKCE S256 wajib; id_token RS256;
// - scope openid profile email nip roles uuid jabatan offline_access; nip/roles/uuid/jabatan
//   hanya lewat userinfo (claims_supported KemluID tidak memuatnya);
// - W2: scope resource `api:<modul>` → access token ber-`aud` = client_id backend modul, bisa
//   diintrospeksi (RFC 7662) oleh backend itu dan TETAP bisa dipakai di userinfo — seperti
//   OpenIddict, tidak seperti oidc-provider bawaan yang menolak token ber-audience di userinfo;
// - introspeksi hanya untuk client presenter/audience token (perilaku OpenIddict);
// - W1/W3: client publik SuperApp + offline_access, refresh token 30 hari.
//
// Backend modul didefinisikan di clients.json: client dengan `resource_scope` (mis. tte-web
// dengan "api:tte") sekaligus menjadi resource server untuk scope itu, audience = client_id-nya.

import { errors } from 'oidc-provider';

const RESOURCE_PREFIX = 'urn:liloidc:resource:';

/** Klaim per scope — standar di id_token dan userinfo, sisanya hanya di userinfo. */
export const claims = {
  openid: ['sub'],
  profile: ['name', 'preferred_username'],
  email: ['email', 'email_verified'],
  nip: ['nip'],
  roles: ['roles'],
  uuid: ['uuid'],
  jabatan: ['jabatan'],
};

const USERINFO_ONLY = new Set(['nip', 'roles', 'uuid', 'jabatan']);

/** Klaim akun untuk satu pemakaian (`id_token` | `userinfo`) dan scope yang diberikan. */
export function accountClaims(user, use, scope) {
  const scopes = new Set(String(scope || '').split(' '));
  const out = { sub: user.username };
  if (scopes.has('profile')) {
    out.name = user.name;
    out.preferred_username = user.username;
  }
  if (scopes.has('email')) {
    out.email = user.email;
    // Default true seperti akun KemluID pada umumnya; set false di users.json untuk menguji
    // penolakan penautan akun (tte-web: account_not_linked).
    out.email_verified = user.email_verified ?? true;
  }
  if (use !== 'id_token') {
    if (scopes.has('nip') && user.nip) out.nip = user.nip;
    if (scopes.has('roles') && user.roles) out.roles = user.roles;
    if (scopes.has('uuid') && user.uuid) out.uuid = user.uuid;
    // Per 2026-10-13 KemluID tidak mengirim jabatan: hanya dikirim bila diisi di users.json.
    if (scopes.has('jabatan') && user.jabatan) out.jabatan = user.jabatan;
  }
  for (const k of Object.keys(out)) {
    if (use === 'id_token' && USERINFO_ONLY.has(k)) delete out[k];
  }
  return out;
}

/** Resource server dari clients.json: client ber-`resource_scope`. */
function resourceServers(loadClients) {
  return loadClients()
    .filter((c) => typeof c.resource_scope === 'string' && c.resource_scope)
    .map((c) => ({ indicator: `${RESOURCE_PREFIX}${c.client_id}`, scope: c.resource_scope, audience: c.client_id }));
}

/** Override konfigurasi oidc-provider untuk profil ini. */
export function providerConfig({ loadClients }) {
  return {
    claims,
    // Scope resource (api:<modul>) wajib dikenal provider agar boleh tercantum di metadata client.
    // Dibaca saat start: menambah `resource_scope` baru di clients.json butuh restart (client
    // lain tetap hot-reload seperti biasa).
    scopes: ['openid', 'offline_access', ...new Set(resourceServers(loadClients).map((s) => s.scope))],
    // Klaim id_token diatur accountClaims (standar saja), bukan oleh conform mode.
    conformIdTokenClaims: false,
    pkce: { required: () => true },
    clientAuthMethods: ['client_secret_basic', 'client_secret_post', 'none'],
    routes: {
      authorization: '/connect/authorize',
      token: '/connect/token',
      userinfo: '/connect/userinfo',
      introspection: '/connect/introspect',
      revocation: '/connect/revoke',
      jwks: '/.well-known/jwks',
    },
    features: {
      devInteractions: { enabled: false },
      // KemluID tidak mengiklankan end_session_endpoint (tte-web docs/oidc-kemluid.md § Logout).
      rpInitiatedLogout: { enabled: false },
      revocation: { enabled: true },
      introspection: {
        enabled: true,
        // OpenIddict: hanya client presenter atau yang tercantum di audience token.
        async allowedPolicy(ctx, client, token) {
          if (token.clientId === client.clientId) return true;
          if (client.clientAuthMethod === 'none') return false;
          const aud = [].concat(token.aud ?? []);
          return aud.includes(client.clientId);
        },
      },
      resourceIndicators: {
        enabled: true,
        // Scope `api:<modul>` cukup diminta lewat scope (tanpa parameter `resource`), seperti
        // OpenIddict yang memetakan scope ke resource-nya.
        async defaultResource(ctx, client, oneOf) {
          const servers = resourceServers(loadClients);
          const requested = new Set(String(ctx.oidc.params?.scope || '').split(' '));
          if (oneOf) {
            // Refresh/kode dengan subset scope (ADR-005 SuperApp: token per backend): pilih resource
            // yang scope-nya diminta. Tanpa scope API sama sekali → token userinfo biasa.
            if (ctx.oidc.params?.scope && !servers.some((s) => requested.has(s.scope))) return undefined;
            const wanted = servers.filter((s) => requested.has(s.scope)).map((s) => s.indicator);
            return oneOf.find((r) => wanted.includes(r)) ?? oneOf[0];
          }
          const hits = servers.filter((s) => requested.has(s.scope)).map((s) => s.indicator);
          if (hits.length === 0) return undefined;
          return hits.length === 1 ? hits[0] : hits;
        },
        // Token untuk resource diterbitkan walau scope memuat `openid` (W2: SuperApp memakai satu
        // token ber-aud tte-web untuk introspeksi DAN userinfo).
        // Kecuali permintaan menyebut scope eksplisit tanpa scope API (mis. refresh dengan
        // `scope=openid profile`): itu permintaan token userinfo.
        async useGrantedResource(ctx) {
          const requested = ctx.oidc.params?.scope;
          if (!requested) return true;
          const scopes = new Set(String(requested).split(' '));
          return resourceServers(loadClients).some((s) => scopes.has(s.scope));
        },
        async getResourceServerInfo(ctx, indicator, client) {
          const server = resourceServers(loadClients).find((s) => s.indicator === indicator);
          if (!server) throw new errors.InvalidTarget();
          if (!String(client.scope || '').split(' ').includes(server.scope)) throw new errors.InvalidTarget();
          return { scope: server.scope, audience: server.audience, accessTokenTTL: 3600, accessTokenFormat: 'opaque' };
        },
      },
    },
    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 600,
      IdToken: 3600,
      RefreshToken: 30 * 24 * 3600,
      Grant: 30 * 24 * 3600,
      Session: 30 * 24 * 3600,
    },
  };
}

/**
 * OpenIddict memberi refresh token untuk `offline_access` tanpa syarat `prompt=consent`, sedangkan
 * oidc-provider (mengikuti OIDC Core §11) membuang `offline_access` bila prompt itu tidak ada.
 * Untuk meniru KemluID, `prompt=consent` ditambahkan otomatis pada authorize yang meminta
 * `offline_access` tanpa prompt. Consent di LiloIDC otomatis, jadi tidak ada layar tambahan.
 */
export function mountOfflineAccessShim(provider) {
  provider.use(async (ctx, next) => {
    if (ctx.method === 'GET' && ctx.path === '/connect/authorize') {
      const q = new URLSearchParams(ctx.querystring);
      if (String(q.get('scope') || '').split(' ').includes('offline_access') && !q.has('prompt')) {
        q.set('prompt', 'consent');
        ctx.querystring = q.toString();
      }
    }
    await next();
  });
}

/**
 * Userinfo ala OpenIddict: menerima access token apa pun yang sah (termasuk ber-audience resource)
 * dan mengembalikan klaim menurut scope OIDC yang diberikan pada grant-nya. Dipasang di
 * /connect/userinfo sebelum rute bawaan oidc-provider.
 */
export function mountUserinfo(router, provider, findAccount) {
  const handler = async (ctx) => {
    const m = /^Bearer\s+(\S+)$/i.exec(ctx.get('authorization') || '');
    const deny = (status, error) => {
      ctx.status = status;
      ctx.set('WWW-Authenticate', `Bearer error="${error}"`);
      ctx.body = { error };
    };
    if (!m) return deny(401, 'invalid_token');
    const token = await provider.AccessToken.find(m[1]);
    if (!token?.isValid || !token.accountId) return deny(401, 'invalid_token');
    const grant = token.grantId ? await provider.Grant.find(token.grantId) : undefined;
    if (!grant || grant.clientId !== token.clientId || grant.accountId !== token.accountId) {
      return deny(401, 'invalid_token');
    }
    const scope = grant.getOIDCScope() || '';
    if (!scope.split(' ').includes('openid')) return deny(403, 'insufficient_scope');
    const account = await findAccount(ctx, token.accountId);
    if (!account) return deny(401, 'invalid_token');
    ctx.set('Cache-Control', 'no-store');
    ctx.body = await account.claims('userinfo', scope, {}, []);
  };
  router.get('/connect/userinfo', handler);
  router.post('/connect/userinfo', handler);
}
