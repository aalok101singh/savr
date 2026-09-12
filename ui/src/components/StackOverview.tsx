import type { DecisionAction, Subscription } from "../types";
import { fmtCompact, monthDay } from "../api";

interface Props {
  subscriptions: Subscription[];
  actionsBySub: Record<string, DecisionAction>;
  pendingSubs: Set<string>;
}

function priorityOf(
  sub: Subscription,
  pendingSubs: Set<string>,
  actionsBySub: Record<string, DecisionAction>
): number {
  if (pendingSubs.has(sub.id)) return 0;
  if (actionsBySub[sub.id]) return 1;
  return 2;
}

export function StackOverview({ subscriptions, actionsBySub, pendingSubs }: Props) {
  const sorted = subscriptions
    .slice()
    .sort(
      (a, b) =>
        priorityOf(a, pendingSubs, actionsBySub) - priorityOf(b, pendingSubs, actionsBySub) ||
        a.renewalDate.localeCompare(b.renewalDate)
    );
  return (
    <section className="panel" aria-label="Stack Overview">
      <div className="panel-head">
        <h2>Stack Overview</h2>
        <span className="panel-note mono">14 subscriptions</span>
      </div>
      <table className="stack-table">
        <thead>
          <tr>
            <th>Vendor</th>
            <th>Category</th>
            <th className="num">Cost</th>
            <th className="num">Seats</th>
            <th className="num">Renew</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((sub) => {
            const action = actionsBySub[sub.id];
            const active = sub.status === "active";
            const statusLabel = action ?? sub.status;
            const seats =
              sub.seatsPurchased === null
                ? "usage"
                : `${sub.seatsActive}/${sub.seatsPurchased}`;
            const pendingRow = pendingSubs.has(sub.id);
            const needsAttention = pendingRow || Boolean(action);
            return (
              <tr
                key={sub.id}
                className={`${pendingRow ? "row-pending" : ""} ${needsAttention ? "row-attention" : ""}`}
              >
                <td>{sub.vendorName}</td>
                <td>{sub.category}</td>
                <td className="num">{fmtCompact(sub.annualCost)}</td>
                <td className="num">{seats}</td>
                <td className="num">{monthDay(sub.renewalDate)}</td>
                <td>
                  <span className={`badge badge-${sub.status}`}>
                    {active ? statusLabel : sub.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}