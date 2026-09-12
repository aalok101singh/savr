import type { DecisionCard, DecisionPackage } from "../types";
import { fmtUsd } from "../api";

interface Props {
  cards: DecisionCard[];
  packages: DecisionPackage[];
  onApprove: (card: DecisionCard) => void;
  onReject: (card: DecisionCard) => void;
}

export function DecisionCardView({ cards, packages, onApprove, onReject }: Props) {
  if (cards.length === 0) {
    return (
      <section className="panel panel-decision" aria-label="Decision Card">
        <div className="panel-head">
          <h2>Decision</h2>
        </div>
        <p className="muted">All actions resolved — savings are live.</p>
      </section>
    );
  }
  return (
    <section className="panel panel-decision" aria-label="Decision Card">
      <div className="panel-head">
        <h2>Your approval needed</h2>
        <span className="panel-note">{cards.length} {cards.length === 1 ? "card" : "cards"} waiting</span>
      </div>
      <div className="decisioncards">
        {cards.map((card) => {
          const pkg = packages.find((p) => p.id === card.decisionPackageId);
          const evidence = pkg?.evidence ?? [];
          return (
            <article key={card.id} className="decisioncard">
              <div className="decisioncard-head">
                <span className="card-required">DECISION REQUIRED</span>
                <span className={`badge badge-action badge-${card.action.toLowerCase()}`}>{card.action}</span>
              </div>
              <p className="decisioncard-sub">
                Subscription: <strong>{card.subscriptionId}</strong>
              </p>
              <div className="decisioncard-prices">
                {card.action === "NEGOTIATE" && card.negotiation && (
                  <>
                    <div>
                      Current price: <strong>{fmtUsd(card.negotiation.currentPrice)}/yr</strong>
                    </div>
                    <div>
                      Negotiated to:{" "}
                      <strong>{card.negotiation.currentOffer ? fmtUsd(card.negotiation.currentOffer.totalAnnual) : "—"}/yr</strong>
                    </div>
                    <div className="savings-line">Realized savings: {fmtUsd(card.realizedSavings)}/yr</div>
                  </>
                )}
                {card.action !== "NEGOTIATE" && (
                  <div className="savings-line">Estimated savings: {fmtUsd(card.estimatedSavings)}/yr</div>
                )}
              </div>
              <p className="decisioncard-migration">{card.migrationNotes}</p>
              {evidence.length > 0 && (
                <ul className="evidence-list">
                  {evidence.slice(0, 4).map((e) => (
                    <li key={e.id}>
                      {e.isInternal ? "Utilization" : "Market"}: {e.observedValue} <span className="muted">({e.source})</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="decisioncard-actions">
                <button className="btn-approve" onClick={() => onApprove(card)}>
                  Approve
                </button>
                <button className="btn-reject" onClick={() => onReject(card)}>
                  Reject
                </button>
                <span className="muted">View Full Details</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}