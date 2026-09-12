import { fmtUsd } from "../api";
import { useCountUp } from "../director/useCountUp";

interface Props {
  totalSavings: number;
  approvedCount: number;
}

export function SavingsCounter({ totalSavings, approvedCount }: Props) {
  const animated = useCountUp(totalSavings);
  return (
    <div className="savings-hero" role="group" aria-label="Total savings">
      <span className="savings-label">SAVINGS</span>
      <span className="savings-value">{fmtUsd(animated)}/yr</span>
      <span className="savings-sub">
        {approvedCount} {approvedCount === 1 ? "action" : "actions"} approved
      </span>
    </div>
  );
}