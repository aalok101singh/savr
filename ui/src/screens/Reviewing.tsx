import type { GuardianProgressEvent } from "../types";

interface ReviewingProps {
  progress: GuardianProgressEvent[];
  running: boolean;
  error: string | null;
  checkedCount: number | null;
  foundNothing?: boolean;
}

export default function Reviewing({ progress, running, error, checkedCount, foundNothing }: ReviewingProps) {
  const evaluating = progress.filter((p) => p.status === "evaluating").map((p) => p.subscriptionId);
  const doneEvent = (id: string) => progress.find((p) => p.subscriptionId === id && p.status === "done");

  return (
    <section className="panel setup-panel">
      <div className="panel-head">
        <h2>Guardian is reviewing your stack</h2>
        <span className="panel-note">step 3 of 3 · live evaluation, no invention — each tool below is a real Strands run</span>
      </div>

      {error && <p className="setup-error">⚠ {error}</p>}

      {progress.length === 0 && running && (
        <div className="reviewing-idle">
          <div className="spinner" aria-hidden="true" />
          <p>Starting evaluation…</p>
        </div>
      )}

      <ul className="progress-list">
        {progress
          .filter((p) => p.status === "evaluating" || doneEvent(p.subscriptionId))
          .sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId))
          .map((p) => {
            const done = doneEvent(p.subscriptionId);
            const isEvaluating = evaluating.includes(p.subscriptionId) && !done;
            return (
              <li key={p.subscriptionId} className={`progress-item ${done ? "progress-done" : "progress-active"}`}>
                <span className="progress-spinner" aria-hidden="true" />
                <span className="progress-vendor">{p.vendorName}</span>
                <span className="progress-id mono">{p.subscriptionId}</span>
                {isEvaluating && <span className="progress-state">evaluating…</span>}
                {done && (
                  <span className={`progress-action badge-action badge-${(done.action ?? "").toLowerCase()}`}>
                    {done.action ?? "done"}
                  </span>
                )}
              </li>
            );
          })}
      </ul>

      {progress.length > 0 && !running && !error && foundNothing && (
        <p className="reviewing-done reviewing-allclear">
          Checked {checkedCount ?? progress.length} subscriptions against your policy. Nothing needs attention right now.
        </p>
      )}
      {progress.length > 0 && !running && !error && !foundNothing && (
        <p className="reviewing-done">Review complete — taking you to the dashboard.</p>
      )}
    </section>
  );
}