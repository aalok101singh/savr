import type { ActivityItem } from "../director/types";

const KIND_LABEL: Record<ActivityItem["kind"], string> = {
  guardian: "guardian",
  message: "negotiation",
  card: "decision",
  approval: "you",
  savings: "savings",
  status: "agent",
  error: "error",
};

interface Props {
  activity: ActivityItem[];
}

export function ActivityLog({ activity }: Props) {
  const visible = activity.slice(-10).reverse();
  return (
    <div className="activity-log" aria-label="Activity log">
      <h2>Activity</h2>
      {visible.length === 0 && <p className="muted">Your procurement agent is standing by.</p>}
      <ol className="activity-list">
        {visible.map((item) => (
          <li key={item.id} className={`activity-item activity-${item.kind}`}>
            <span className="activity-kind mono">{KIND_LABEL[item.kind]}</span>
            <span className="activity-text">{item.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}