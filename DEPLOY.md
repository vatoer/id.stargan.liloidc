# Deploying LiloIDC to VPS

Production deployment of LiloIDC to `demoid.stargan.id` using GitHub Actions, PM2, and nginx.

## Architecture

```
Browser → nginx (443/SSL) → localhost:9876 (Node.js/PM2)
```

## Prerequisites

- VPS with Ubuntu/Debian, SSH access as `submin`
- Domain `demoid.stargan.id` DNS A record pointing to the VPS IP
- GitHub repository with push access

## 1. VPS Setup (one-time)

### Install Node.js 24 and PM2

```bash
# Node.js via NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 globally
sudo npm install -g pm2

# PM2 startup (auto-restart on reboot)
pm2 startup
# Run the command it prints (starts with sudo env ...)
```

### Prepare deployment directory

```bash
mkdir -p /home/submin/www/demoid
```

### Create .env

```bash
cat > /home/submin/www/demoid/.env << 'EOF'
PORT=9876
ISSUER=https://demoid.stargan.id
NODE_ENV=production
EOF
```

> `.env` is excluded from rsync deploys — it stays on the server and never enters git.

### nginx configuration

```bash
sudo nano /etc/nginx/sites-available/demoid.stargan.id
```

Paste:

```nginx
server {
    listen 80;
    server_name demoid.stargan.id;

    location / {
        proxy_pass http://127.0.0.1:9876;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and get SSL:

```bash
sudo ln -s /etc/nginx/sites-available/demoid.stargan.id /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# SSL via Let's Encrypt
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d demoid.stargan.id
```

Certbot auto-edits the nginx config to add the 443 block and redirect.

## 2. GitHub Secrets

Go to **Settings → Secrets and variables → Actions** in the GitHub repo and add:

| Secret        | Value                                     |
|---------------|-------------------------------------------|
| `VPS_HOST`    | VPS IP address or hostname                |
| `VPS_USER`    | `submin`                                  |
| `VPS_SSH_KEY` | Private SSH key (see below)               |

### Generate a deploy key

```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-deploy@liloidc" -f ~/.ssh/liloidc_deploy -N ""

# Copy the public key to VPS
ssh-copy-id -i ~/.ssh/liloidc_deploy.pub submin@<VPS_IP>

# Paste the private key content into the VPS_SSH_KEY secret
cat ~/.ssh/liloidc_deploy
```

## 3. CI/CD Pipeline

The workflow (`.github/workflows/deploy.yml`) runs on every push to `main`:

```
checkout → npm ci → rsync to VPS → pm2 restart → healthcheck
```

### What it does

1. **Checkout** — clones the repo
2. **Install** — `npm ci --omit=dev` (production dependencies only, cached)
3. **Deploy** — rsync to `/home/submin/www/demoid/`, excludes `.env` and `.git`
4. **Restart** — SSH into VPS, `pm2 restart` (or `pm2 start` on first deploy)
5. **Healthcheck** — curls `/.well-known/openid-configuration`, fails the pipeline if not 200

### Manual trigger

The workflow also supports `workflow_dispatch` — you can trigger it manually from the GitHub Actions tab.

## 4. First Deploy

```bash
# Push to main triggers the pipeline
git push origin main
```

Or trigger manually from GitHub Actions → Deploy LiloIDC → Run workflow.

After the first deploy, SSH in and verify:

```bash
pm2 status
curl -s http://localhost:9876/.well-known/openid-configuration | head
```

## 5. Updating Configuration

### Users and clients

Edit `users.json` or `clients.json`, push to `main`. The pipeline deploys and restarts automatically.

### Environment variables

SSH into the VPS and edit `/home/submin/www/demoid/.env`, then:

```bash
pm2 restart liloidc
```

## 6. Monitoring

```bash
# Logs
pm2 logs liloidc

# Status
pm2 monit

# Restart manually
pm2 restart liloidc
```

## Security Notes

- `users.json` contains plaintext passwords — this is by design (LiloIDC is for dev/testing)
- `.env` never enters git or the pipeline
- The deploy SSH key should be scoped to the `submin` user only
- SSL is terminated at nginx via Let's Encrypt with auto-renewal
