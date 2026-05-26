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

Private web UI for starting allowlisted deploy scripts on an AlmaLinux 9 target server over SSH, watching live logs, and keeping job history.

## Stack

- Frontend: Next.js, TypeScript, App Router, Tailwind CSS
- Backend: Django, Django REST Framework, SimpleJWT, Paramiko
- Database: PostgreSQL 16
- Live logs: Django Server-Sent Events consumed by `@microsoft/fetch-event-source`
- Runtime: Docker Compose

## Local Setup

1. Create the SSH key on VPS #2:

   ```bash
   mkdir -p secrets
   ssh-keygen -t ed25519 -f secrets/deploy_panel_key -C "deploy-panel"
   chmod 600 secrets/deploy_panel_key
   ```

2. Add the public key to the AlmaLinux 9 target server:

   ```bash
   ssh-copy-id -i secrets/deploy_panel_key.pub tuanle@TARGET_SERVER_IP
   ```

   If `ssh-copy-id` is unavailable, append `secrets/deploy_panel_key.pub` to `/home/tuanle/.ssh/authorized_keys` on the target server.

3. Copy the reference wrapper to the target server:

   ```bash
   scp ops/target-server/run-deploy-job.sh tuanle@TARGET_SERVER_IP:/tmp/run-deploy-job.sh
   ssh tuanle@TARGET_SERVER_IP
   sudo mkdir -p /opt/apps/scripts
   sudo mv /tmp/run-deploy-job.sh /opt/apps/scripts/run-deploy-job.sh
   sudo chmod 750 /opt/apps/scripts/run-deploy-job.sh
   sudo chown tuanle:tuanle /opt/apps/scripts/run-deploy-job.sh
   ```

   The app does not install this file automatically.

4. Create the target log directory:

   ```bash
   ssh tuanle@TARGET_SERVER_IP
   mkdir -p /home/tuanle/logs/deploy
   chmod 750 /home/tuanle/logs/deploy
   ```

5. Set target server permissions:

   ```bash
   chmod 750 /opt/apps/scripts/deploy-coin-identifier.sh
   chmod 750 /opt/apps/scripts/deploy-hikoni.sh
   chown tuanle:tuanle /opt/apps/scripts/deploy-coin-identifier.sh
   chown tuanle:tuanle /opt/apps/scripts/deploy-hikoni.sh
   ```

   If the deploy scripts need privileged operations, grant only the exact required `sudo` commands to `tuanle`; do not allow arbitrary shell execution.

6. Create `.env`:

   ```bash
   cp .env.example .env
   ```

   Edit `TARGET_SSH_HOST`, database password, `DJANGO_SECRET_KEY`, and any SSH settings. For production, set `SSH_AUTO_ADD_HOST_KEY=false` and provide `TARGET_SSH_KNOWN_HOSTS`.

7. Start the stack:

   ```bash
   docker compose up --build
   ```

8. Create the Django superuser:

   ```bash
   make createsuperuser
   ```

9. Seed the allowlisted scripts:

   ```bash
   make seed-scripts
   ```

10. Log into the frontend:

   Open [http://localhost:3000/login](http://localhost:3000/login) and use the Django superuser credentials.

11. Start a deploy job:

   Go to `/dashboard`, choose an enabled script, and press Start deploy. The backend only starts scripts in the `ScriptDefinition` allowlist and passes only the script's `remote_key` to the target wrapper.

12. Watch live logs:

   After a job starts, the frontend redirects to `/jobs/<id>`. The backend streams `tail -n +1 -F <log_file>` over SSH and sends each log line as Server-Sent Events.

## Make Commands

```bash
make up
make down
make logs
make migrate
make createsuperuser
make shell-backend
make seed-scripts
```

## API

- `POST /api/auth/token/`
- `POST /api/auth/token/refresh/`
- `GET /api/scripts/`
- `POST /api/jobs/start/`
- `GET /api/jobs/`
- `GET /api/jobs/<uuid:id>/`
- `GET /api/jobs/<uuid:id>/logs/stream/`
- `POST /api/jobs/<uuid:id>/refresh-status/`
- `POST /api/jobs/<uuid:id>/stop/`

All deployment endpoints require JWT authentication.

## Security Notes

- The web UI never accepts arbitrary shell commands.
- The backend validates the requested `script_slug`, loads an enabled database allowlist record, validates the `remote_key`, and calls only `run-deploy-job.sh start <script_key>`.
- The target wrapper also has a hardcoded whitelist:
  - `coin-identifier` -> `/opt/apps/scripts/deploy-coin-identifier.sh`
  - `hikoni` -> `/opt/apps/scripts/deploy-hikoni.sh`
- The SSH private key is mounted read-only from `./secrets` and is not stored in the database.
- Use known host verification in production.

## Troubleshooting

### SSH connection failures

Run this from VPS #2 or from the backend container:

```bash
ssh -i secrets/deploy_panel_key tuanle@TARGET_SERVER_IP '/opt/apps/scripts/run-deploy-job.sh status test'
```

An invalid test job id should return a JSON error, which confirms SSH can reach the wrapper. If SSH fails, check `TARGET_SSH_HOST`, `TARGET_SSH_USER`, key permissions, and `authorized_keys`.

### Host key verification

For production, create a known hosts file:

```bash
ssh-keyscan -H TARGET_SERVER_IP > secrets/known_hosts
```

Then set:

```bash
TARGET_SSH_KNOWN_HOSTS=/run/secrets/known_hosts
SSH_AUTO_ADD_HOST_KEY=false
```

### Permission problems

Confirm the SSH user can execute the wrapper and deploy scripts:

```bash
ssh -i secrets/deploy_panel_key tuanle@TARGET_SERVER_IP '/opt/apps/scripts/run-deploy-job.sh start coin-identifier'
```

The command should return JSON with `job_id`, `log_file`, `pid_file`, and `status_file`.

### Log streaming problems

Check that the log path returned by the wrapper is under `TARGET_REMOTE_LOG_DIR`, default `/home/tuanle/logs/deploy`. The backend rejects log paths outside that directory. Also confirm the SSH user can run:

```bash
tail -n +1 -F /home/tuanle/logs/deploy/<job>.log
```

### Duplicate deploys

The backend returns HTTP 409 if the same script already has a queued or running job. Refresh the job status or stop the running job before starting another deploy for that script.
