import type { DirectorPhase } from "../director/types";

interface Props {
  phase: DirectorPhase;
  pendingCount: number;
}

const STEPS: Array<{ key: string; label: string }> = [
  { key: "guardian", label: "Guardian" },
  { key: "negotiating", label: "Negotiating" },
  { key: "approval", label: "Approval" },
  { key: "resolved", label: "Resolved" },
];

function stepIndex(phase: DirectorPhase): number {
  if (phase === "idle") return -1;
  if (phase === "error") return -1;
  if (phase === "guardian") return 0;
  if (phase === "negotiating") return 1;
  if (phase === "approval") return 2;
  if (phase === "resolved") return 3;
  return -1;
}

export function PhaseBar({ phase, pendingCount }: Props) {
  const active = stepIndex(phase);
  return (
    <div className="phase-bar" aria-label={`Story phase: ${phase}`}>
      {active < 0 && (
        <span className="phase-note">
          {phase === "error" ? "Something went wrong mid-run" : "Agents idle — nothing to do yet"}
        </span>
      )}
      {STEPS.map((step, i) => {
        const state =
          active < 0
            ? "inactive"
            : i < active
              ? "done"
              : i === active
                ? "active"
                : "inactive";
        return (
          <div key={step.key} className={`phase-step phase-${state}`}>
            <span className="phase-dot" />
            <span className="phase-label">{step.label}</span>
            {i < STEPS.length - 1 && <span className="phase-connector" />}
          </div>
        );
      })}
      {phase === "approval" && pendingCount > 0 && (
        <span className="phase-pending">({pendingCount} need you)</span>
      )}
    </div>
  );
}