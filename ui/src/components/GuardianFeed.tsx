import type { DecisionPackage } from "../types";
import { fmtUsd } from "../api";

interface Props {
  packages: DecisionPackage[];
}

export function GuardianFeed({ packages }: Props) {
  return (
    <section className="panel panel-secondary" aria-label="Guardian Feed">
      <div className="panel-head">
        <h2>Guardian Feed</h2>
      </div>
      {packages.length === 0 && <p className="muted">No recommendations yet. Run the demo.</p>}
      <div className="feed">
        {packages.map((pkg) => (
          <article key={pkg.id} className="feed-item">
            <div className="feed-head">
              <strong>{pkg.subscriptionId}</strong>
              <span className={`badge badge-action badge-${pkg.action.toLowerCase()}`}>{pkg.action}</span>
              <span className={pkg.approvalRequirement === "requires_approval" ? "approval-tag" : "autonomy-tag"}>
                {pkg.approvalRequirement === "requires_approval" ? "requires approval" : "autonomous"}
              </span>
            </div>
            <p className="feed-reason">{pkg.reasoning}</p>
            <div className="feed-meta">
              <span>{pkg.triggers.join(", ")}</span>
              <span>confidence {pkg.confidence.toFixed(2)}</span>
              <span>{pkg.evidence.length} evidence</span>
              {pkg.estimatedSavings.amount > 0 && <span>est. savings {fmtUsd(pkg.estimatedSavings.amount)}</span>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}