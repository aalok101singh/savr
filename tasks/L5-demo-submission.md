---
id: L5-demo-submission
level: L5
context:
  - docs/00-vision.md
  - docs/01-architecture.md
deliverable: Public repo, architecture diagram, demo video (≤5 min), README, compliance verified. Blog post optional bonus.
status: todo
---

# L5 — Demo & Submit

## Inputs

- `docs/00-vision.md`, `docs/01-architecture.md`
- All implemented code from L0–L4

## Outputs

- `README.md` (public front door)
- `docs/architecture.png`
- YouTube demo video (≤5 minutes — 3 is the plan, 5 is the max)
- GitHub public repo
- AWS Builder Center verification
- AWS blog post (OPTIONAL bonus, not required)

## Build

1. Audit README claims against what the demo shows. Remove anything not visible.
2. Create architecture diagram → `docs/architecture.png`.
3. Demo script (≤5 minutes; ~3:20 target):
   - 0:00 Stack overview (14 rows, $47,400/yr) — "Savr watches your SaaS stack."
   - 0:10 Run Demo → Guardian evaluates 14 subscriptions → flags Notion **NEGOTIATE**
     + Loom/Veed **SWITCH**; KEEP/DOWNGRADE run autonomously. "Your policy gates.
     Nothing contacts a vendor without your say-so."
   - 0:55 "2 actions need your approval" → the NEGOTIATE + SWITCH cards appear with
     $0 realized until you act.
   - 1:10 Approve Notion → **this** is when the Negotiator engages the vendor:
     3 rounds ($10,800 → $10,200 → $9,840) → accepted → renewal $12,000 → $9,840.
   - 2:20 Approve Loom → status switches, Veed stays active.
   - 2:50 Savings counter counts to **$5,760/yr** → "All actions resolved." Replay/
     auto-run story if time allows.
   - Optional (only if the IAM Bedrock grant is verified, ~+15s): switch to live mode
     and show Guardian reasoning against **real Claude on Bedrock** — "Same loop, real
     model." Keep ≤5:00 total.
4. Record and upload demo video (≤5 min).
5. Push public repo. Verify README renders, image loads, links resolve.
6. Verify hackathon compliance:
   - Public repo on GitHub
   - MIT/Apache license
   - English materials
   - AWS Builder ID documented
   - Strands Agents SDK is the orchestrator (never fallback)
   - Disclosure: no pre-existing non-standard code; third-party APIs/licenses compliant
7. Optional: AWS blog post — must be public on Builder Center, "Agents for Humans" in title (bonus worth up to ~~0.6~~ points).
8. Submit.

## Tests

```bash
test -f docs/architecture.png  # OK
git remote -v  # public remote
curl -sI "https://youtube.com/<video-id>" | head -1  # HTTP 200/302
npm run demo:test  # E2E: seed → guardian → negotiate → card → approve → savings = 5760
```

## Done when

- Repo public, README renders, image loads.
- Video live, ≤5 minutes, linked.
- E2E acceptance test passes (savings == 5760, cards resolve).
- Every README claim demo-visible.
- "Why Strands" maps features to observations. "What is simulated" present.
- Standard compliance checks pass.
- `PROGRESS.md` all levels complete.
- Blog post published IF opting for the bonus.

## Do not

- Do not modify agent logic (L2/L3) or UI (L4).
- Do not remove Strands.
- Do not treat the blog post as mandatory (it is a bonus).