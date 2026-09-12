interface LandingProps {
  onMock: () => void;
  onSetup: () => void;
  busy: boolean;
}

export default function Landing({ onMock, onSetup, busy }: LandingProps) {
  return (
    <div className="landing">
      <section className="landing-hero">
        <p className="landing-kicker">Autonomous procurement for companies that don't have a procurement team</p>
        <h1>SAVR</h1>
        <p className="landing-tagline">
          It watches your software stack, decides what needs attention, acts within your policies, negotiates when it
          can, and only asks you when a real decision is yours to make.
        </p>
      </section>

      <section className="landing-cards">
        <div className="panel landing-card">
          <span className="landing-label">canned walkthrough</span>
          <h2>Try the Mock Demo</h2>
          <p>
            Acme Corp's stack — 14 tools, 2 renewals worth acting on, and the full story from Guardian to negotiation
            to the savings counter. Instant, deterministic, zero cost. Watch the whole thing in one go.
          </p>
          <button className="btn-primary btn-wide" disabled={busy} onClick={onMock}>
            Run the Mock Demo
          </button>
        </div>

        <div className="panel landing-card">
          <span className="landing-label">the real product</span>
          <h2>Set Up Your Company</h2>
          <p>
            Bring your own company and stack — entered by hand or imported as JSON. Guardian reasons over your real
            data, live, and tells you what it found.
          </p>
          <button className="btn-primary btn-wide" disabled={busy} onClick={onSetup}>
            Set Up Your Company
          </button>
        </div>
      </section>

      <p className="landing-foot muted">
        Humans define the rules. Agents run the work. <span className="mono">mock = deterministic</span> ·{" "}
        <span className="mono">live = real reasoning on real data</span>
      </p>
    </div>
  );
}