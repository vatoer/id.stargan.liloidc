import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Router from '@koa/router';
import { koaBody } from 'koa-body';
import Provider from 'oidc-provider';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 9876;
const ISSUER = process.env.ISSUER || `http://localhost:${PORT}`;

// Load config
const users = JSON.parse(readFileSync(join(__dirname, 'users.json'), 'utf8'));
const clients = JSON.parse(readFileSync(join(__dirname, 'clients.json'), 'utf8'));

// Account model
function findAccount(ctx, id) {
  const user = users.find((u) => u.username === id);
  if (!user) return undefined;
  return {
    accountId: id,
    async claims(use, scope) {
      const claims = { sub: id };
      if (scope.includes('email')) {
        claims.email = user.email;
        claims.email_verified = true;
      }
      if (scope.includes('profile')) {
        claims.name = user.name;
        claims.preferred_username = user.username;
        claims.role = user.role;
      }
      return claims;
    },
  };
}

// Provider config
const provider = new Provider(ISSUER, {
  // Trust nginx reverse proxy (X-Forwarded-* headers)
  ...(process.env.NODE_ENV === 'production' && { proxy: true }),

  clients: clients.map((c) => ({
    client_id: c.client_id,
    client_secret: c.client_secret,
    application_type: c.application_type || 'web',
    redirect_uris: c.redirect_uris,
    grant_types: c.grant_types || ['authorization_code'],
    response_types: c.response_types || ['code'],
    scope: c.scope || 'openid email profile',
    token_endpoint_auth_method: c.token_endpoint_auth_method || 'client_secret_basic',
    post_logout_redirect_uris: c.post_logout_redirect_uris || [],
  })),
  findAccount,
  claims: {
    openid: ['sub'],
    email: ['email', 'email_verified'],
    profile: ['name', 'preferred_username', 'role'],
  },
  conformIdTokenClaims: false,
  features: {
    devInteractions: { enabled: false },
  },
  pkce: {
    required: () => false,
  },
  cookies: {
    keys: ['liloidc-secret-key-dev-only'],
  },
  ttl: {
    AccessToken: 3600,
    AuthorizationCode: 600,
    IdToken: 3600,
    RefreshToken: 86400,
    Session: 86400,
  },
});

// Mount interaction routes directly on the provider (which IS a Koa app)
const router = new Router();

// Login page
router.get('/interaction/:uid', async (ctx) => {
  const details = await provider.interactionDetails(ctx.req, ctx.res);
  const { prompt, params } = details;

  if (prompt.name === 'login') {
    ctx.type = 'html';
    ctx.body = loginPage(ctx.params.uid);
  } else if (prompt.name === 'consent') {
    // Auto-consent (superlite — no consent screen needed)
    const grant = new provider.Grant({
      accountId: details.session.accountId,
      clientId: params.client_id,
    });
    if (prompt.details.missingOIDCScope) {
      grant.addOIDCScope(prompt.details.missingOIDCScope.join(' '));
    }
    if (prompt.details.missingOIDCClaims) {
      grant.addOIDCClaims(prompt.details.missingOIDCClaims);
    }
    if (prompt.details.missingResourceScopes) {
      for (const [indicator, scope] of Object.entries(prompt.details.missingResourceScopes)) {
        grant.addResourceScope(indicator, scope.join(' '));
      }
    }
    const grantId = await grant.save();
    const result = { consent: { grantId } };
    await provider.interactionFinished(ctx.req, ctx.res, result, {
      mergeWithLastSubmission: true,
    });
  } else {
    ctx.throw(501, 'not implemented');
  }
});

// Login submit
router.post('/interaction/:uid/login', koaBody(), async (ctx) => {
  const { username, password } = ctx.request.body;
  const user = users.find((u) => u.username === username && u.password === password);

  if (!user) {
    ctx.type = 'html';
    ctx.body = loginPage(ctx.params.uid, 'Invalid username or password');
    return;
  }

  const result = {
    login: { accountId: user.username },
  };

  await provider.interactionFinished(ctx.req, ctx.res, result, {
    mergeWithLastSubmission: false,
  });
});

// Abort
router.get('/interaction/:uid/abort', async (ctx) => {
  const result = {
    error: 'access_denied',
    error_description: 'End-User aborted interaction',
  };
  await provider.interactionFinished(ctx.req, ctx.res, result, {
    mergeWithLastSubmission: false,
  });
});

// Mount interaction routes BEFORE provider's own routes
provider.use(router.routes());
provider.use(router.allowedMethods());

// Start
const server = createServer(provider.callback());
server.listen(PORT, () => {
  console.log(`\n  LiloIDC running on ${ISSUER}\n`);
  console.log(`  Discovery: ${ISSUER}/.well-known/openid-configuration`);
  console.log(`  Users:     ${users.map((u) => u.username).join(', ')}`);
  console.log(`  Clients:   ${clients.map((c) => c.client_id).join(', ')}\n`);
});

// HTML login page
function loginPage(uid, error) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LiloIDC - Sign In</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f0f2f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 2px 16px rgba(0,0,0,0.08);
      padding: 40px;
      width: 360px;
    }
    .card h1 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 4px;
      color: #111;
    }
    .card p.sub {
      font-size: 13px;
      color: #666;
      margin-bottom: 24px;
    }
    .error {
      background: #fee;
      color: #c00;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #333;
      margin-bottom: 6px;
    }
    input[type=text], input[type=password] {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #d0d5dd;
      border-radius: 8px;
      font-size: 14px;
      margin-bottom: 16px;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #4d90fe; }
    button {
      width: 100%;
      padding: 10px;
      background: #4d90fe;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #3a7be0; }
    .footer {
      text-align: center;
      margin-top: 20px;
      font-size: 11px;
      color: #aaa;
    }
    .footer a { color: #999; }
  </style>
</head>
<body>
  <div class="card">
    <h1>LiloIDC</h1>
    <p class="sub">Superlite OIDC Identity Provider</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="post" action="/interaction/${uid}/login">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" placeholder="alice" autofocus required>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" placeholder="alice" required>
      <button type="submit">Sign In</button>
    </form>
    <div class="footer">
      <a href="/interaction/${uid}/abort">Cancel</a>
    </div>
  </div>
</body>
</html>`;
}
