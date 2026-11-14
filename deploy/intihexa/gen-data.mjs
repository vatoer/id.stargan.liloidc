// Membuat data deployment (users.json, clients.json, .env) dari data uji profil kemluid,
// dengan password pengguna dan secret client ACAK. Keluaran berisi rahasia: simpan di luar repo.
//
//   node deploy/intihexa/gen-data.mjs <dir-keluaran> <issuer>
//
// Redirect client mengikuti clients.example.json; tambahkan URL staging di sana atau di hasilnya.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [outDir, issuer] = process.argv.slice(2);
if (!outDir || !issuer?.startsWith('https://')) {
  console.error('pakai: node gen-data.mjs <dir-keluaran> <issuer https>');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'profiles', 'kemluid');
const rand = (n) => randomBytes(n).toString('base64url');

const users = JSON.parse(readFileSync(join(root, 'users.json'), 'utf8')).map((u) => ({ ...u, password: rand(12) }));
const clients = JSON.parse(readFileSync(join(root, 'clients.example.json'), 'utf8')).map((c) =>
  c.client_secret ? { ...c, client_secret: rand(24) } : c,
);

mkdirSync(join(outDir, 'data'), { recursive: true });
writeFileSync(join(outDir, 'data', 'users.json'), JSON.stringify(users, null, 2) + '\n', { mode: 0o600 });
writeFileSync(join(outDir, 'data', 'clients.json'), JSON.stringify(clients, null, 2) + '\n', { mode: 0o600 });
writeFileSync(join(outDir, '.env'), `ISSUER=${issuer}\nCOOKIE_KEYS=${rand(32)},${rand(32)}\n`, { mode: 0o600 });

const lines = [
  `# LiloIDC ${issuer} — kredensial uji (RAHASIA, jangan commit)`,
  '',
  '| Username | Password | Roles |',
  '|---|---|---|',
  ...users.map((u) => `| ${u.username} | ${u.password} | ${(u.roles || []).join(', ')} |`),
  '',
  '| Client | Secret |',
  '|---|---|',
  ...clients.map((c) => `| ${c.client_id} | ${c.client_secret ?? '(publik, PKCE)'} |`),
  '',
];
writeFileSync(join(outDir, 'CREDENTIALS.md'), lines.join('\n'), { mode: 0o600 });
console.log(`ditulis ke ${outDir}: .env, data/users.json, data/clients.json, CREDENTIALS.md`);
