import type { Policy } from "../types";
import { fmtUsd } from "../api";

interface Props {
  policy: Policy | null;
}

export function PolicyView({ policy }: Props) {
  if (!policy) {
    return <p className="muted">Policy unavailable.</p>;
  }
  return (
    <section className="panel panel-secondary" aria-label="Active Policy">
      <div className="panel-head">
        <h2>Active Policy</h2>
      </div>
      <dl className="policy-list">
        <div>
          <dt>Max annual budget</dt>
          <dd>{fmtUsd(policy.maxAnnualBudget)}</dd>
        </div>
        <div>
          <dt>Max per-vendor spend</dt>
          <dd>{fmtUsd(policy.maxSingleVendorSpend)}</dd>
        </div>
        <div>
          <dt>Renewal window</dt>
          <dd>{policy.renewalWindowDays} days</dd>
        </div>
        <div>
          <dt>Unused seat threshold</dt>
          <dd>{Math.round(policy.unusedSeatThresholdPct * 100)}%</dd>
        </div>
        <div>
          <dt>Blacklist</dt>
          <dd>{policy.blacklist.length > 0 ? policy.blacklist.join(", ") : "none"}</dd>
        </div>
        <div>
          <dt>NEGOTIATE / SWITCH</dt>
          <dd>require approval</dd>
        </div>
        <div>
          <dt>DOWNGRADE / CANCEL</dt>
          <dd>autonomous</dd>
        </div>
      </dl>
    </section>
  );
}