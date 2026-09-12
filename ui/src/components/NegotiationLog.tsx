import type { NegotiationState } from "../types";
import type { NegotiationMeta, RoundSummary, TranscriptItem } from "../director/types";
import { fmtUsd } from "../api";

interface Props {
  subscriptionId: string | null;
  maxRounds: number;
  currentPrice: number | null;
  transcript: TranscriptItem[];
  rounds: RoundSummary[];
  resolution: string | null;
  meta: NegotiationMeta;
  negotiation: NegotiationState | null;
}

export function NegotiationLog({
  subscriptionId,
  maxRounds,
  currentPrice,
  transcript,
  rounds,
  resolution,
  meta,
  negotiation,
}: Props) {
  const hasStory = transcript.length > 0 || rounds.length > 0;
  if (!subscriptionId && !hasStory) {
    return (
      <section className="panel panel-log" aria-label="Negotiation Log">
        <div className="panel-head">
          <h2>Negotiation Log</h2>
        </div>
        <p className="muted">No negotiation in progress. Run the demo.</p>
      </section>
    );
  }
  const accepted = resolution === "accepted";
  const terms =
    rounds.length > 0
      ? (transcript
          .slice()
          .reverse()
          .find((m) => m.vendorOffer !== null)?.vendorOffer ?? null)
      : null;
  const finalTerms = negotiation?.currentOffer?.terms ?? null;
  return (
    <section className="panel panel-log" aria-label="Negotiation Log">
      <div className="panel-head">
        <h2>{subscriptionId ? `Negotiation: ${subscriptionId}` : "Negotiation Log"}</h2>
        {resolution && (
          <span className={`badge ${accepted ? "badge-accepted" : "badge-stalled"}`}>
            {accepted ? "resolved · accepted" : resolution.replace(/_/g, " ")}
          </span>
        )}
      </div>
      <div className="log-meta">
        <span>Round {rounds.length} of {maxRounds}</span>
        {currentPrice !== null && <span>Current {fmtUsd(currentPrice)}/yr</span>}
        {meta.targetPrice !== null && <span>Target {fmtUsd(meta.targetPrice)}</span>}
        {meta.maxAcceptablePrice !== null && (
          <span>Max acceptable {fmtUsd(meta.maxAcceptablePrice)}</span>
        )}
        {finalTerms && <span>{finalTerms}</span>}
      </div>
      {rounds.length > 0 && (
        <div className="offer-ticker mono" aria-label="Vendor offer path">
          {rounds.map((r, i) => (
            <span className="ticker-step" key={r.round}>
              <span className={r.vendorOffer !== null && i === rounds.length - 1 && accepted ? "ticker-final" : undefined}>
                {r.vendorOffer === null ? "—" : fmtUsd(r.vendorOffer)}
              </span>
              {i < rounds.length - 1 && <span className="ticker-arrow">→</span>}
            </span>
          ))}
          {accepted && terms !== null && (
            <span className="ticker-accept">accepted {fmtUsd(terms)}/yr</span>
          )}
        </div>
      )}
      <div className="log-messages">
        {transcript.length === 0 && (
          <p className="muted">No messages were exchanged before the negotiation ended.</p>
        )}
        {transcript.map((m) => (
          <div key={m.id} className={`bubble bubble-${m.role}`} role="listitem">
            <div className="bubble-head">
              <span className="bubble-role">{m.role === "agent" ? "Savr" : "Vendor"}</span>
              <span className="bubble-round mono">round {m.round}</span>
            </div>
            <p className="bubble-text">{m.content}</p>
            {m.buyerOfferPrice !== null && m.role === "agent" && (
              <div className="bubble-offer mono">Proposing {fmtUsd(m.buyerOfferPrice)}/yr</div>
            )}
            {m.vendorOffer !== null && (
              <div className="bubble-offer mono">Offer: {fmtUsd(m.vendorOffer)}/yr</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}