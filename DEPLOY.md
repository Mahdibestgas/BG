# Going live (private server + GitHub)

GitHub holds the code and deploys it. It never holds secrets or company data.

## What stays out of GitHub (enforced by `.gitignore`)
`.env*` (except `.env.production.example`), keys, logs, spreadsheets, `bestgas_plan*.json`, the whole `bank/` folder (it is outside this repo).
Before the first push run `git add -n .` and read the list: no `.env`, no `.xlsx`, no plan JSON.

## One-time setup
1. **GitHub:** create an empty **private** repo. Turn on: branch protection for `main`, secret scanning and push protection, 2-step login on your account.
2. **Server:** a small Ubuntu 24.04 server (2 GB memory). Create a non-root user `deploy`, add your SSH key, then:
   `ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable`, and set `PasswordAuthentication no` in `/etc/ssh/sshd_config`. Install Docker and git.
3. **Domain:** point an A record (for example `cash.yourcompany.com`) at the server's IP. HTTPS is automatic once it resolves.
4. **Deploy key:** on the server `ssh-keygen -t ed25519 -f ~/.ssh/gh_pull -N ""`, add `gh_pull.pub` to the repo as a **read-only deploy key**, then `git clone git@github.com:YOU/REPO.git /opt/cashflow13`.
5. **Secrets on the server only:** `cd /opt/cashflow13 && cp .env.production.example .env.production`, then fill each value (`openssl rand -hex 32` for `OWNER_DB_PW`, `APP_DB_PW`, `SESSION_KEY`; your domain for `CF13_DOMAIN`). `chmod 600 .env.production`.
6. **GitHub Actions secrets** (repo Settings, Secrets, environment `production`): `DEPLOY_SSH_KEY` (a separate key pair for GitHub to log in as `deploy`), `DEPLOY_KNOWN_HOSTS` (output of `ssh-keyscan -t ed25519 SERVER_IP`), `DEPLOY_HOST`, `DEPLOY_USER`.

## First start
`cd /opt/cashflow13 && docker compose -f docker-compose.prod.yml up -d --build`
The API applies migrations and the row-level-security rules on every start.

## First owner and your real plan
1. Set `CF13_SIGNUP=on` in `.env.production`, restart the api, create the owner company on the site, then set it back to `off` and restart. From then on people join only by owner invitation.
2. Copy the live plan from this PC straight to the server (never through GitHub):
   `scp bestgas_plan_unitcost_DATE.json deploy@SERVER:/tmp/plan.json`, then
   `docker compose -f docker-compose.prod.yml exec api sh -c "cd apps/api && npx tsx prisma/import-plan.ts best-gas /tmp/plan.json"` and delete `/tmp/plan.json`.
3. In the site: turn on two-factor for every owner (Members and account settings).

## Safety checklist after the first deploy
- `https://YOUR-DOMAIN` loads over HTTPS and `http://` redirects.
- Sign-in is required; `/api/plans` without a login returns 401.
- The database port is not reachable from outside (`nmap SERVER_IP` shows only 22, 80, 443).
- Backups appear in `/opt/cashflow13/backups` each night (kept 14 days). Copy them off the server weekly; test one restore.
- Rotate secrets if anyone with access leaves.
