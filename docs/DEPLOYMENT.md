# Putting Campus HelpDesk online

This is the short, practical guide: where to run it, how to get HTTPS, which settings to change and how backups work.

## 1. What has to run

One Node.js process (`npm start`, or `node server/index.js` after `npm run build`) plus a MySQL / MariaDB database. The process serves the website and the API on one port (default 3001), creates the database on the first start and keeps it up to date.

## 2. Settings for a real server

Copy `server/.env.example` to `server/.env` and set at least:

| Setting | Why |
| --- | --- |
| `DB_PASSWORD`, `DB_USER`, `DB_HOST` | Use a database user with its own password, not `root` with none. |
| `JWT_SECRET` | A long random text (for example 64 random characters). Without it a secret file is created on the server; with it, sessions survive moving the app. |
| `APP_URL` | The public address, used in alert emails. |
| `TRUST_PROXY=1` | When a proxy (Render, Railway, Nginx, Caddy, Cloudflare) sits in front, so the sign-in limiter sees the visitor and not the proxy. |
| `FORCE_HTTPS=true` | Sends plain http visitors to https and adds the HSTS header. Only behind a proxy that sets `X-Forwarded-Proto`. |

The first start creates accounts with random passwords that are printed once in the server log (on Render: open the service Logs and copy them, or set `SEED_DEMO=false`, `ADMIN_ID`, `ADMIN_NAME`, `ADMIN_EMAIL` to create a single administrator). A database that still has the old shared demo passwords gets new ones at the next deploy, printed once in the log: sign in with those and choose your own password.

## 3. HTTPS

Browsers only treat the site as secure over HTTPS, and the sign-in token must never travel in plain text. The easiest ways:

- **Cloudflare (free)**: put the domain on Cloudflare, point it at your server, choose *Full* encryption. Nothing to install.
- **Caddy (free, automatic certificates)**: install Caddy and use this `Caddyfile`:

  ```
  help.yourcampus.edu {
      reverse_proxy localhost:3001
  }
  ```

  Then start the app with `TRUST_PROXY=1` and `FORCE_HTTPS=true`.
- **Hosting platforms** (Render, Railway, Koyeb, Fly.io) give you HTTPS on their domain automatically; set `TRUST_PROXY=1` and `FORCE_HTTPS=true`.
- **Nginx**: use `certbot --nginx` for a free Let's Encrypt certificate and `proxy_pass http://localhost:3001;` with `proxy_set_header X-Forwarded-Proto $scheme;`. For live updates also add `proxy_buffering off;` for the `/api/events` location.

## 4. Where to host it

- **A campus PC or server** (what the project is built for): run `npm start`, keep it on, give it a fixed address and put Caddy or Cloudflare in front.
- **Free cloud**: the website and API run together on a free Node host (Render, Koyeb); the database needs a MySQL-compatible service (TiDB Cloud Serverless or Aiven have free plans). Free hosts sleep when idle and erase their disk on restart, so photos in `server/uploads/` and files in `backups/` are lost there. Use the Super Admin Panel to download backups regularly, or use a paid disk.

## 5. Backups

- A backup is made every day (`BACKUP_HOUR`, default 2 AM) in `backups/daily/` and the newest 14 are kept (`BACKUP_KEEP`). The Super Admin Panel lists them, downloads them and makes one on demand.
- **A backup on the same machine is not enough.** Copy `backups/daily/` and `server/uploads/` (the photos) to another disk or cloud storage every day, for example with a scheduled copy.
- **Restore** (stop the server first):

  ```bash
  node scripts/restore-backup.mjs backups/daily/helpdesk-2026-10-13.sql.gz
  ```

  Use `DB_NAME=other_name` in front to restore into a different database and check it before replacing the real one. The archive exports in `backups/archives/` are separate: they hold the tickets that were archived.

## 6. Checklist before going live

- [ ] HTTPS works and `FORCE_HTTPS=true` is set
- [ ] `JWT_SECRET` and a database password are set
- [ ] Initial passwords copied from the log and changed (or `SEED_DEMO=false`)
- [ ] `APP_URL` and the `SMTP_*` settings are set if you want email alerts (send yourself a test)
- [ ] A copy of `backups/daily/` and `server/uploads/` is saved somewhere else
- [ ] Two-step verification is on for the super admin and the admins (Profile > Two-step verification)
- [ ] Run `npm test` and the checks in the README on a copy of the database
