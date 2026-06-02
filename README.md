# README #
This repository stores the code for the Deploy Control Panel.

## Note for GIT
* Please help apply GitFlow for this repository (https://danielkummer.github.io/git-flow-cheatsheet).
* Example:
  - Name for any features -> `feature/xxx-yyy`. Ex: `feature/implement-login-ui`
  - Name for any bugs -> `bugfix/xxx-yyy`. Ex: `bugfix/wrong-message-when-login`

* When creating a title for a pull request or a commit message, please ensure that both the title and message are meaningful, and include a description if necessary. Capitalize the first letter and avoid using special characters.
* Example:
  - Implement the authentication feature

## Author
* Name: Tuan Le
* Email: latuan.dev@gmail.com
* Website: https://atun29dev.devnook.net

# Deploy Control Panel

Private web UI for running allowlisted deploy scripts on customer servers through an outbound target-side agent. The control panel does not need SSH access to target servers.

## Stack

- Frontend: Next.js, TypeScript, App Router, Tailwind CSS
- Backend: Django, Django REST Framework, SimpleJWT
- Database: PostgreSQL 16
- Target runtime: Python agent installed on each target server
- Live logs: Django Server-Sent Events consumed by `@microsoft/fetch-event-source`
- Runtime: Docker Compose

## How It Works

1. A staff user creates a target server in the dashboard.
2. The control panel generates a one-time agent token for that target.
3. The customer installs `ops/target-agent/deploy_agent.py` on their server and runs it with that token.
4. The agent connects outbound to the control panel, polls for queued jobs, runs local deploy scripts, and pushes logs/status back.
5. Users start deploy jobs from the dashboard and watch logs in real time.

The service never asks customers to upload their existing SSH private keys.

## Local Setup

1. Create `.env`:

   ```bash
   cp .env.example .env
   ```

   Edit the database password, `DJANGO_SECRET_KEY`, and public web/API URLs.

2. Start the stack:

   ```bash
   docker compose up -d --build
   ```

   When running behind an HTTPS reverse proxy, set the public hosts in `.env`
   before building the images. For example:

   ```bash
   DJANGO_DEBUG=false
   DJANGO_ALLOWED_HOSTS=deploy-control-api.example.com,localhost,127.0.0.1,backend
   CORS_ALLOWED_ORIGINS=https://deploy-control.example.com
   CSRF_TRUSTED_ORIGINS=https://deploy-control.example.com,https://deploy-control-api.example.com
   NEXT_PUBLIC_API_BASE_URL=https://deploy-control-api.example.com
   ```

   `NEXT_PUBLIC_API_BASE_URL` is compiled into the Next.js frontend image, so
   rebuild the frontend after changing it.

3. Create the Django superuser:

   ```bash
   docker compose exec backend python manage.py createsuperuser
   ```

4. Log into the frontend:

   Open [http://localhost:3000/login](http://localhost:3000/login) and use the Django superuser credentials.

## Dashboard Setup

### 1. Create A Target Server

Go to `/dashboard` as a staff user and fill in the Target servers form.

Example values:

```text
Slug: prod-api
Name: Production API server
Allowed script dir: /opt/scripts
Log dir: /home/deployer/logs/deploy
Enabled: checked
```

After creation, the dashboard shows an agent token once. Save it immediately.

### 2. Install The Agent On The Target Server

On the target server:

```bash
sudo useradd -m -s /bin/bash deployer || true
sudo mkdir -p /opt/deploy-control-agent /opt/scripts /home/deployer/logs/deploy
sudo chown -R deployer:deployer /opt/deploy-control-agent /opt/scripts /home/deployer/logs/deploy
```

Copy the agent file:

```bash
scp ops/target-agent/deploy_agent.py deployer@TARGET_SERVER_IP:/opt/deploy-control-agent/deploy_agent.py
ssh deployer@TARGET_SERVER_IP 'chmod 750 /opt/deploy-control-agent/deploy_agent.py'
```

Run the agent:

```bash
DEPLOY_CONTROL_API_URL=https://deploy-control-api.example.com \
DEPLOY_AGENT_TOKEN=PASTE_AGENT_TOKEN_HERE \
DEPLOY_ALLOWED_SCRIPT_DIR=/opt/scripts \
DEPLOY_LOG_DIR=/home/deployer/logs/deploy \
DEPLOY_LOG_RETENTION_DAYS=30 \
python3 /opt/deploy-control-agent/deploy_agent.py
```

For production, run the agent with systemd or another process supervisor.
The agent removes local `.log` files in `DEPLOY_LOG_DIR` older than `DEPLOY_LOG_RETENTION_DAYS`; logs already sent to the control panel remain in the control panel database.

Install a systemd unit:

```bash
sudo tee /etc/systemd/system/deploy-control-agent.service >/dev/null <<'UNIT'
[Unit]
Description=Deploy Control Agent
After=network-online.target
Wants=network-online.target

[Service]
User=deployer
Group=deployer
Environment=DEPLOY_CONTROL_API_URL=https://deploy-control-api.example.com
Environment=DEPLOY_AGENT_TOKEN=PASTE_AGENT_TOKEN_HERE
Environment=DEPLOY_ALLOWED_SCRIPT_DIR=/opt/scripts
Environment=DEPLOY_LOG_DIR=/home/deployer/logs/deploy
Environment=DEPLOY_LOG_RETENTION_DAYS=30
ExecStart=/usr/bin/python3 /opt/deploy-control-agent/deploy_agent.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now deploy-control-agent
sudo systemctl status deploy-control-agent
```

Back in the dashboard, press Check on the target. It should report the agent's last check-in time.

### 3. Add Deploy Scripts On The Target Server

Each deploy script must already exist under the target's Allowed script dir and must be executable.

Example:

```bash
sudo tee /opt/scripts/deploy-coin-identifier.sh >/dev/null <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/apps/coin-identifier-backend
git pull --ff-only
docker compose up -d --build
SCRIPT

sudo chmod 750 /opt/scripts/deploy-coin-identifier.sh
sudo chown deployer:deployer /opt/scripts/deploy-coin-identifier.sh
```

### 4. Create Script Records In The Dashboard

Example values:

```text
Target: Production API server
Slug: coin-identifier
Remote key: coin-identifier
Label: Deploy Coin Identifier Backend
Script path: /opt/scripts/deploy-coin-identifier.sh
Description: Runs the backend deploy script on the selected target server.
Enabled: checked
```

### 5. Start A Deploy Job

Go to `/dashboard`, choose an enabled script, and press Start deploy. The job is queued in the control panel. The target agent picks it up, runs the script, and streams logs back.

### 6. Watch Logs

After a job starts, the frontend redirects to `/jobs/<id>`. The page shows:

- Job status
- Target server
- Started by
- Started time
- Exit code
- Live logs

Use Stop to request cancellation. The agent polls for this request and terminates the running process.

## Fresh Reset

If you deployed an earlier fixed-target or SSH-based prototype and do not need its old job history, recreate the database volume before running the new setup:

```bash
docker compose down -v
docker compose up -d --build
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
```

This deletes the PostgreSQL data volume.

## Make Commands

```bash
make up
make down
make logs
make migrate
make createsuperuser
make shell-backend
```

## API

User-facing API:

- `POST /api/auth/token/`
- `POST /api/auth/token/refresh/`
- `GET /api/me/`
- `GET /api/setup/agent/`
- `GET /api/targets/`
- `POST /api/targets/`
- `GET /api/targets/<int:id>/`
- `PATCH /api/targets/<int:id>/`
- `DELETE /api/targets/<int:id>/`
- `DELETE /api/targets/<int:id>/hard-delete/`
- `POST /api/targets/<int:id>/test-connection/`
- `GET /api/scripts/`
- `POST /api/scripts/`
- `GET /api/scripts/<int:id>/`
- `PATCH /api/scripts/<int:id>/`
- `DELETE /api/scripts/<int:id>/`
- `DELETE /api/scripts/<int:id>/hard-delete/`
- `POST /api/jobs/start/`
- `GET /api/jobs/`
- `GET /api/jobs/<uuid:id>/`
- `GET /api/jobs/<uuid:id>/logs/stream/`
- `POST /api/jobs/<uuid:id>/refresh-status/`
- `POST /api/jobs/<uuid:id>/stop/`

Agent API:

- `POST /api/agent/ping/`
- `POST /api/agent/jobs/claim/`
- `POST /api/agent/jobs/<uuid:id>/logs/`
- `POST /api/agent/jobs/<uuid:id>/status/`
- `POST /api/agent/jobs/<uuid:id>/control/`

All user-facing deployment endpoints require JWT authentication. Agent endpoints require the target's bearer token.

## Security Notes

- The control panel does not need SSH access to target servers.
- Customers do not upload existing SSH private keys.
- Each target has its own agent token.
- The agent connects outbound to the control panel.
- Staff users can create target server and script records. Non-staff users can run enabled scripts only.
- The backend validates the requested `script_slug`, target, `remote_key`, and absolute script path.
- The agent rejects script paths outside `DEPLOY_ALLOWED_SCRIPT_DIR`.
- The agent token is shown once when the target is created. Store it securely.
- If an agent token is lost or exposed, disable that target and create a new target token.
- Run deploy scripts with a low-privilege OS user such as `deployer`.

## Troubleshooting

### Agent Does Not Check In

Check the agent process:

```bash
sudo systemctl status deploy-control-agent
sudo journalctl -u deploy-control-agent -f
```

Confirm these environment variables are set correctly:

```bash
DEPLOY_CONTROL_API_URL
DEPLOY_AGENT_TOKEN
DEPLOY_ALLOWED_SCRIPT_DIR
DEPLOY_LOG_DIR
DEPLOY_LOG_RETENTION_DAYS
```

### Script Is Not Picked Up

Confirm the script record is enabled and belongs to a target whose agent is connected. Also confirm the script path is under the target's Allowed script dir.

### Permission Problems

Confirm the agent user can execute the deploy script:

```bash
sudo -u deployer /opt/scripts/deploy-coin-identifier.sh
```

### Log Streaming Problems

Confirm the agent can write to its log directory and that the browser is connected to `/api/jobs/<id>/logs/stream/`.

### Duplicate Deploys

The backend returns HTTP 409 if the same script already has a queued or running job. Refresh the job status or stop the running job before starting another deploy for that script.
