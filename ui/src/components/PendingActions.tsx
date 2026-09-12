interface Props {
  pendingCount: number;
}

export function PendingActions({ pendingCount }: Props) {
  if (pendingCount === 0) {
    return <div className="pending-actions resolved">All actions resolved</div>;
  }
  return (
    <div className="pending-actions">
      {pendingCount} {pendingCount === 1 ? "action" : "actions"} need your approval
    </div>
  );
}