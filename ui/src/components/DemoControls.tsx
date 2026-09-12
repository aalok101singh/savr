interface Props {
  running: boolean;
  replaying: boolean;
  recordingAvailable: boolean;
  onRun: () => void;
  onReset: () => void;
  onReplay: () => void;
}

export function DemoControls({ running, replaying, recordingAvailable, onRun, onReset, onReplay }: Props) {
  return (
    <div className="demo-controls">
      <button className="btn-primary" disabled={running || replaying} onClick={onRun}>
        {running ? "Running…" : "Run Demo"}
      </button>
      <button
        className="btn-secondary"
        disabled={running || replaying || !recordingAvailable}
        onClick={onReplay}
        title="Replay the last captured run at narrative timing"
      >
        Replay
      </button>
      <button className="btn-secondary" disabled={running || replaying} onClick={onReset}>
        Reset Demo
      </button>
    </div>
  );
}