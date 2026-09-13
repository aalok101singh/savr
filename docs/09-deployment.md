# Deployment — Savr on AWS

Goal: (1) unblock the live Bedrock path with a least-privilege IAM policy, and (2)
run the full API + built UI (`ui/dist`) on one always-on AWS instance serving a
public URL for the demo-day submission. The API and UI are served by a **single
Node process** (`npm run dev` / `tsx src/api/server.ts`) — the Express app in
`src/api/server.ts` already serves `ui/dist` when `ui/dist/index.html` exists.

## 0. IAM — unblock live Bedrock

`savr-dev` currently has no `bedrock:InvokeModel*` permission, which is the only
reason live runs fall back to the local deterministic model (DECISIONS #038).

Attach this least-privilege policy **as a standalone inline/JSON policy** to the
`savr-dev` IAM user (it is scoped to a single foundation model in a single region):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeSonnet46",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6"
    }
  ]
}
```

Via console: IAM → Users → `savr-dev` → Permissions → Add permissions → Create
inline policy → JSON → paste above → review (name `savr-live-bedrock`) → create.

Verify live mode actually hits Bedrock:

```bash
DEMO_MODE=false SAVR_MODEL= SAAS... # or just DEMO_MODE=false
# run one Guardian evaluation against nothing-but-Bedrock:
node -e "import('./dist/scripts/demo-run.js')"   # (not needed; use tsx)
npm run demo:live-check   # see package.json if present, else:
npx tsx -e 'import { loadEnv } from "./src/utils/env.js"; import { runDemo } from "./src/api/demo.js"; loadEnv(); process.env.DEMO_MODE="false"; process.env.SAVR_MODEL="anthropic.claude-sonnet-4-6"; runDemo({ mode: "live"}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exit(1)})'
```

Pass = 5 decision packages come back from the real model (IAM is the only known
blocker; code is already live-path capable per DECISIONS #038).

## 1. Build the UI with the demo token

For a public instance every state-changing POST must present the bearer token. The
token is baked into the **served** bundle only — it is rebuilt on the instance at
boot (see user-data below) so no token ever lands in git. The committed `ui/dist`
stays token-free for local development:

```bash
# on the EC2 instance (see user-data): build ui/dist with the token
(cd /opt/savr/app/ui && VITE_API_TOKEN="<STRONG_DEMO_TOKEN>" npm ci && VITE_API_TOKEN="<STRONG_DEMO_TOKEN>" npx vite build)
```

This injects `Authorization: Bearer <token>` into every UI POST (see `ui/src/api.ts`).
Without `VITE_API_TOKEN` the built UI only works against a loopback-bound API, exactly
as before. Store the same token in the server env as `API_TOKEN`.

> The token is a demo-deployment-only secret: it ships inside the served JS bundle
> to let the judge click Run/Approve. It is **not** the secret you would use for a
> real backend — it is deliberately scoped to a disposable demo instance.

## 2. EC2 (recommended: t3.micro, free tier)

### 2a. Launch

1. Console → EC2 → Instances → Launch instance:
   - Name `savr-live`; AMI **Amazon Linux 2023**; instance type **t3.micro** (free tier).
   - Key pair: create or reuse one, save the `.pem`.
   - Network settings → Create security group with **two rules**:
     - SSH (22) from your IP only
     - Custom TCP (3000) from `0.0.0.0/0`
   - **Advanced details → User data** (boots everything; saves 30 min of SSH):
   - Launch.

### 2b. User data (Amazon Linux 2023)

```bash
#!/bin/bash
set -euxo pipefail
yum update -y
yum install -y nodejs20 git
# Node 20 via Amazon Extras if 'nodejs20' name differs:
#   dnf module install -y nodejs:20

mkdir -p /opt/savr
cd /opt/savr
git clone https://github.com/aalok101singh/savr.git app

cd /opt/savr/app
# Demo token must match the token baked into the UI bundle below.
npm ci

cat > .env <<'ENV'
HOST=0.0.0.0
API_PORT=3000
DEMO_MODE=true
API_TOKEN=CHANGE_ME_STRONG_DEMO_TOKEN
ENV

# Rebuild the UI with the same token baked in (token never committed to git).
(cd /opt/savr/app/ui && VITE_API_TOKEN="CHANGE_ME_STRONG_DEMO_TOKEN" npx vite build)

cat > /etc/systemd/system/savr.service <<'UNIT'
[Unit]
Description=Savr procurement agent API + UI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/savr/app
EnvironmentFile=/opt/savr/app/.env
ExecStart=/bin/bash -lc 'npx tsx src/api/server.ts'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now savr
```

### 2c. Public URL

Allocate an **Elastic IP** and attach it to the instance (or note the public IPv4
from the console). The judge URL is:

```
http://<PUBLIC_IP>:3000/
```

Two quick smoke tests from any laptop:

```bash
curl -s http://<PUBLIC_IP>:3000/health
# {"status":"ok"}

# state-changing route must be gated:
curl -s -X POST http://<PUBLIC_IP>:3000/api/demo/run
# {"error":"Unauthorized. Configure API_TOKEN and send Authorization: Bearer <token>."}

curl -s -X POST -H "Authorization: Bearer <token>" http://<PUBLIC_IP>:3000/api/demo/run
# {"status":"complete", ...}
```

## 3. Lightsail alternative (if you prefer a fixed IP + firewall UI)

- Lightsail → Create instance → **Linux (+ Node.js)** blueprint → $5/mo tier.
- Static IP: Networking → Create static IP → attach.
- Firewall: allow `3000` (Custom TCP) + `22`.
- SSH in (`ssh -i key.pem ubuntu@<static-ip>`) and run the same install steps from
  §2b (the blueprint includes Node; skip `yum`, use `apt`).
- Lightbulb → Manage → enable **automatic snapshots** only if you expect the
  instance to live past submission day.

## 4. Runtimes, costs, and what to shut down

- t3.micro free tier is the cheapest path; set a **billing alarm** anyway.
- After the demo day, **stop the instance** (EC2 → stop) or delete it + the
  Elastic IP so nothing accrues. `Stop` still bills elastic IP; release it.

## 5. Production intent (explicitly NOT done here)

- **Persistence:** local JSON (`data/*.json`) is the implemented store; DynamoDB
  via `strands-dynamodb-storage` is the documented production intent, not
  implemented (README + DECISIONS).
- **Scheduler:** in-process opt-in autopilot (`AUTOPILOT_ENABLED=true`); EventBridge
  cron is the production intent, not deployed (DECISIONS #044).
- **Orchestration:** Strands Agents SDK orchestrates every agent path in every mode;
  Amazon Bedrock AgentCore is a stretch rubric item, deliberately not used so the
  Strands-orchestrator requirement is never ambiguous (DECISIONS #..).