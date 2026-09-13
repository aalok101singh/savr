---
id: readme
level: L5
depends_on: [vision, architecture]
provides: public-intro
used_by: [L5]
status: active
---

# Savr

**Savr is an autonomous procurement employee for companies without a procurement team.**

A 5–20 person startup spends $40k–$60k/year on SaaS across 15–30 tools. Nobody owns procurement. Renewals happen when someone remembers them. Prices creep up silently. Seats go unused. Nobody has time to negotiate.

Savr runs in the background and fixes this.

## What Savr Does

- **Guardian** — Continuously monitors your SaaS stack. Flags renewals, unused seats, overlapping tools, and price increases. Benchmarks market pricing. Recommends actions with evidence.
- **Negotiator** — Engages vendors in structured rounds when Guardian recommends NEGOTIATE. The LLM handles strategy and language; code owns financial boundaries.
- **Human Gate** — NEGOTIATE and SWITCH always require human approval. KEEP, DOWNGRADE, and CANCEL run autonomously. Policy is deterministic and authoritative — the agent never violates your rules. A NEGOTIATE card that passes the human gate only then authorizes the Negotiator to contact the vendor; if the negotiation does not reach an accepted agreement, the approval is refused and no mutation is applied.
- **Security** — The API binds to `127.0.0.1` by default. State-changing routes (imports, resets, approvals, demo runs, debug negotiation) require a bearer token when the deployment sets `API_TOKEN`; debug negotiation routes are additionally compiled out unless `DEBUG_MODE=true` is set. See [Deployment](#deployment).

## Architecture

See `docs/01-architecture.md`.

![Architecture Diagram](docs/architecture.png)

Core loop: **Observe → Reason → Propose → Policy Check → Execute or Human Gate → Persist**

The LLM decides what to do. Code decides what it is allowed to do. Human decides what requires human authority.

## Why Strands

Built with the Strands Agents SDK for TypeScript (`@strands-agents/sdk@1.14.0`).

| Strands Feature | What It Does in Savr | What You See |
|----------------|---------------------|-------------|
| **Strands Agent** | Orchestrates Guardian and Negotiator modes | Agent running autonomously |
| **Custom tools** | 6 tools for renewal checks, pricing, alternatives, negotiation, policy | Agent researching and negotiating |
| **Tool calling** | Agent picks tools during reasoning (12-call limit) | Agent deciding what to research |
| **Structured output** | LLM emits `GuardianOutput`/`NegotiationOutput` via Zod; app code builds DecisionPackage/DecisionCard | Consistent, validated recommendations |
| **Hooks** | `BeforeToolCallEvent` policy guardrails | Blacklist blocked, price bounds enforced |
| **State** | `appState` (policy/config), `invocationState` (current evaluation) | Agent tracking its current task |
| **Persistence** | Procurement Memory (local JSON) | Agent remembers decisions across runs |

## Stack

- **Strands Agents SDK** `@strands-agents/sdk@1.14.0`
- **Amazon Bedrock** — Claude Sonnet 4.6 (`anthropic.claude-sonnet-4-6`, `us-east-1`)
- **Node.js 22+ / TypeScript 5.x**
- **React / Vite** — UI
- **Express** — API + vendor sandbox
- **SSE** — real-time UI events
- **Local JSON** — persistence (`data/*.json`); DynamoDB is the production intent, not implemented in this submission
- **Zod** — structured-output validation

## Build

```bash
npm install
npm --prefix ui install    # UI dependencies (needed for ui:* scripts and rebuilds)
npm run demo:test          # L5 acceptance E2E: seed → guardian → cards → approve → negotiate → savings = 5760
npm run validate:data      # Validate synthetic data (14 subs, $47,400, 32 unused seats)
npm run guardian           # Run the Guardian loop
npm run negotiate          # Run Guardian + Negotiator
npm run sandbox            # Start vendor sandbox (port 3001)
npm run dev                # Start API + built UI (port 3000)
npm run demo:reset         # Reset to initial state
npm run demo:run           # Run canonical demo pipeline (synchronous)
```

The built UI is committed at `ui/dist`, so `npm run dev` serves the full app with no
extra steps. Rebuild with `npm run build:ui`.

### Deployment

The API binds to the loopback interface by default (`HOST=127.0.0.1`). To serve the
API beyond loopback (Docker, hosted backend), set `HOST` explicitly **and** configure
`API_TOKEN` — every state-changing `/api` route then requires
`Authorization: Bearer $API_TOKEN` and rejects otherwise. Debug negotiation routes
are only registered when `DEBUG_MODE=true`.

**Autonomous trigger (opt-in):** `AUTOPILOT_ENABLED=true npm run dev` — Guardian re-runs
on its own every `AUTOPILOT_INTERVAL_MS` (default 120s) and surfaces anything newly
flagged (autopilot_check SSE). It is **off by default** so a dev server never makes
unsolicited Bedrock calls.

See `AGENTS.md` for build levels.

> AWS prereqs (live mode only): credentials with Bedrock access (Sonnet 4.6, `us-east-1`). The deterministic demo runs fully offline with `DEMO_MODE=true`. One-time account setup (budget alert, least-privilege IAM) is in `docs/07-build-plan.md` → "AWS Cost Guardrails".

#### Deploying to AWS (EC2 demo instance)

The simplest always-on path is a single **EC2 t3.micro** (free tier) running the
Node process directly — no Docker, ECS, or container registry needed. The Express
app in `src/api/server.ts` already serves `ui/dist` as a static bundle; with
`ui/dist/index.html` present a single `npx tsx src/api/server.ts` hosts everything.

**Quick version (full runbook in `docs/09-deployment.md`):**

```bash
# 1. IAM — attach this least-privilege Bedrock policy to savr-dev (console or CLI)
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
    "Resource": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6"
  }]
}

# 2. Build the UI — committed dist is token-free for local demo use; the deployed
#    instance rebuilds it with the token baked in (see server step below).
npm run build:ui            # commit the default build if you changed UI source

# 3. On the EC2 instance (Amazon Linux 2023 user-data / manual)
sudo yum install -y nodejs20 git
git clone https://github.com/aalok101singh/savr.git /opt/savr/app && cd /opt/savr/app
cat > /opt/savr/app/.env <<'ENV'
HOST=0.0.0.0
API_PORT=3000
DEMO_MODE=true
API_TOKEN=<SAME_STRONG_DEMO_TOKEN>
ENV
npm ci --omit=dev
# Rebuild the UI on the server with the demo token baked into every POST
# (token stays on the instance; never committed to git).
(cd /opt/savr/app/ui && VITE_API_TOKEN="<SAME_STRONG_DEMO_TOKEN>" npm ci && VITE_API_TOKEN="<SAME_STRONG_DEMO_TOKEN>" npx vite build)
cat > /etc/systemd/system/savr.service <<'UNIT'
[Unit]
Description=Savr API + UI
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
sudo systemctl daemon-reload && sudo systemctl enable --now savr
# 4. Allocate an Elastic IP → attach to the instance → http://<EIP>:3000 is live
```

**Cost:** t3.micro free tier + minimal Bedrock token spend during the demo. Set a
billing alarm and **stop/release** the instance + Elastic IP immediately after
submission day.

## Security

`.env` is gitignored and never committed. Copy `.env.example` → `.env` and fill in real
values. If a credential has ever been pushed or shared, **rotate it** in the AWS console
immediately. The demo itself (`DEMO_MODE=true`) runs without any AWS credentials.

## Demo

**Video:** TODO — record a ≤5-min demo (script and timings in `tasks/L5-demo-submission.md`). The UI's **Replay** button replays the canonical run at narrative pacing for recording.

**Flow:** Reset → Run → Guardian flags Notion NEGOTIATE + Loom/Veed SWITCH → "2 actions need your approval" → Approve Notion (the Negotiator then engages the vendor: 3 rounds $10,800→$10,200→$9,840) → Approve Loom → Savings counter: **$5,760/yr** → "All actions resolved."

For the "runs on its own" shot: `AUTOPILOT_ENABLED=true AUTOPILOT_INTERVAL_MS=45000 npm run dev`, then watch Guardian flag a renewal unprompted.

## What Is Simulated

- **Vendor negotiations** use a sandbox (`src/sandbox/`). Same API contract production would use; the vendor is simulated because real enterprise sales cycles take days or weeks.
- **Web research** uses cached evidence (`data/cached-evidence.json`) in demo mode. Live search is a stretch feature.
- **Procurement Memory** persists to local JSON (`data/memory.json`, `data/cards.json`). DynamoDB is the production intent, not implemented in this submission.
- **The data** is synthetic (Acme Corp, 18 employees, 14 SaaS tools). The agent's behavior on this data is real.

## Stack Import

Savr accepts a company stack as JSON matching the `Subscription` type (`POST /api/stack/import`). The demo ships with Acme Corp seeded, but the import endpoint exists so the schema is the product boundary, not hardcoded data.

## License

MIT

---

**Hackathon:** Built for the AWS AI Hackathon. Strands Agents SDK required and used. Public repo, English materials, AWS Builder ID verified. Blog post (optional bonus): "Agents for Humans" title if published.