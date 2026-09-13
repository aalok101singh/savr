# Deployment — Savr on AWS

Goal: (1) unblock the live Bedrock path with a least-privilege IAM policy, and (2)
run the full API + built UI (`ui/dist`) on one always-on AWS instance serving a
public URL for the demo-day submission.

**Primary path (verified):** one EC2 t3.micro (free tier) running the Node process
directly — `infra/ec2-user-data.sh` is the bootstrap. **Alternative:** ECS Fargate
(ALB + SecretsManager + ECR image) — `infra/` contains that runbook and the README
documents the commands.

The API and UI are served by a **single Node process** — the Express app in
`src/api/server.ts` already serves `ui/dist` when `ui/dist/index.html` exists, so
no web server beyond it is needed.

## 0. IAM — unblock live Bedrock (one-time, manual)

`savr-dev` currently has no `bedrock:InvokeModel*` permission, which is the only
reason live runs fall back to the local deterministic model (DECISIONS #038).

Attach this least-privilege policy **as a standalone inline/JSON policy** to the
`savr-dev` IAM user (it is scoped to a single foundation model in a single region).
The snippet below is the Bedrock-only piece common to both paths:

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
DEMO_MODE=false \
npx tsx -e 'import { loadEnv } from "./src/utils/env.js"; import { runDemo } from "./src/api/demo.js"; loadEnv(); process.env.DEMO_MODE="false"; runDemo({ mode: "live"}).then(r=>console.log("LIVE OK", JSON.stringify({status:r.status}) )).catch(e=>{console.error(e.message);process.exit(1)})'
```

Pass = decision packages come back from the real model with a non-zero status
(IAM is the only known blocker; code is already live-path capable per DECISIONS #038).

## 1. Build the UI with the demo token

For a public instance every state-changing POST must present the bearer token. The
token is baked into the **served** bundle only — it is regenerated on the instance
at boot (see user-data below) so no token ever lands in git. The committed `ui/dist`
stays token-free for local development.

`infra/ec2-user-data.sh` does this automatically. By hand:

```bash
DEMO_TOKEN="$(openssl rand -hex 24)"
(cd ui && VITE_API_TOKEN="$DEMO_TOKEN" npx vite build)   # token baked into the SPA
HOST=0.0.0.0 API_PORT=3000 DEMO_MODE=true API_TOKEN="$DEMO_TOKEN" npx tsx src/api/server.ts
```

This injects `Authorization: Bearer <token>` into every UI POST (see `ui/src/api.ts`).
Without `VITE_API_TOKEN` the built UI only works against a loopback-bound API, exactly
as before. Store the same token in the server env as `API_TOKEN`.

> The token is a demo-deployment-only secret: it ships inside the served JS bundle
> to let the judge click Run/Approve. It is **not** the secret you would use for a
> real backend — it is deliberately scoped to a disposable demo instance.

## 2. EC2 (recommended: t3.micro, free tier) — primary path

### 2a. Launch

1. Console → EC2 → Instances → Launch instance:
   - Name `savr-live`; AMI **Amazon Linux 2023**; instance type **t3.micro** (free tier).
   - Key pair: create or reuse one, save the `.pem` (or use EC2 Instance Connect,
     which needs no key).
   - Network settings → Create security group with **two rules**:
     - SSH (22) from your IP only
     - Custom TCP (3000) from `0.0.0.0/0`
   - **Advanced details → User data**: paste the entire
     `infra/ec2-user-data.sh` file (it bootstraps everything).
   - Launch.

The user-data script clones the repo, `npm ci`s both packages, generates a demo
token, rebuilds the SPA with the token baked in, writes `.env`, and installs a
systemd unit. Boot progress is in `/var/log/savr-bootstrap.log`.

### 2b. Public URL

Allocate an **Elastic IP** and attach it to the instance (or note the public IPv4
from the console). The judge URL is:

```
http://<PUBLIC_IP>:3000/
```

Retrieve the demo token for smoke tests:

```bash
# EC2 Instance Connect (or ssh): 
sudo cat /root/savr-token.txt
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

## 3. ECS Fargate alternative (containers)

Same IAM policy (§0), then follow the README → "Deploying to AWS (ECS Fargate)"
runbook in `infra/` (ECR image with the token baked in via
`docker build --build-arg VITE_API_TOKEN=…`, SecretsManager secret, one
CloudFormation stack providing ALB + Fargate service + task role).

## 4. Lightsail alternative (if you prefer a fixed IP + firewall UI)

- Lightsail → Create instance → **Linux (+ Node.js)** blueprint → $5/mo tier.
- Static IP: Networking → Create static IP → attach.
- Firewall: allow `3000` (Custom TCP) + `22`.
- SSH in (`ssh -i key.pem ubuntu@<static-ip>`) and run the same install steps from
  `infra/ec2-user-data.sh` (the blueprint includes Node; skip `dnf`, use `apt`).

## 5. Runtimes, costs, and what to shut down

- t3.micro free tier is the cheapest path; set a **billing alarm** anyway.
- After the demo day, **stop the instance** (EC2 → stop) or delete it + the
  Elastic IP so nothing accrues. `Stop` still bills elastic IP; release it.

## 6. Production intent (explicitly NOT done here)

- **Persistence:** local JSON (`data/*.json`) is the implemented store; DynamoDB
  via `strands-dynamodb-storage` is the documented production intent, not
  implemented (README + DECISIONS).
- **Scheduler:** in-process opt-in autopilot (`AUTOPILOT_ENABLED=true`); EventBridge
  cron is the production intent, not deployed (DECISIONS #044).
- **Orchestration:** Strands Agents SDK orchestrates every agent path in every mode;
  Amazon Bedrock AgentCore is a stretch rubric item, deliberately not used so the
  Strands-orchestrator requirement is never ambiguous.