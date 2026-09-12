import { useCallback, useRef, useState } from "react";
import { fetchAutopilotStatus, fmtUsd, getJson, postJson, sessionReset, timeOfDay, type AutopilotStatus } from "./api";
import { useSSE } from "./hooks/useSSE";
import { useDemoDirector } from "./director/useDemoDirector";
import { hydrateFrames } from "./director/hydrate";
import type { DirectorFrame } from "./director/types";
import type {
  AgentStatusState,
  AutopilotCheckEvent,
  Company,
  DecisionAction,
  DecisionCard,
  DecisionPackage,
  GuardianProgressEvent,
  NegotiationState,
  Policy,
  Subscription,
} from "./types";
import { SavingsCounter } from "./components/SavingsCounter";
import { PendingActions } from "./components/PendingActions";
import { StackOverview } from "./components/StackOverview";
import { GuardianFeed } from "./components/GuardianFeed";
import { NegotiationLog } from "./components/NegotiationLog";
import { DecisionCardView } from "./components/DecisionCardView";
import { PolicyView } from "./components/PolicyView";
import { DemoControls } from "./components/DemoControls";
import { PhaseBar } from "./components/PhaseBar";
import { ActivityLog } from "./components/ActivityLog";
import Landing from "./screens/Landing";
import CompanyForm from "./screens/Company";
import StackSetup from "./screens/Stack";
import Reviewing from "./screens/Reviewing";

interface Snapshot {
  subs: Subscription[];
  pkgs: DecisionPackage[];
  cards: DecisionCard[];
  saved: { totalSavings: number; approvedCount: number; lastAction: string | null };
  pol: Policy;
  stat: AgentStatusState;
  neg: NegotiationState | null;
}

interface RunSummary {
  mode: "mock" | "live";
  checkedSubscriptions: number;
  flaggedPackages: number;
  cardsPending: number;
}

type Screen = "landing" | "company" | "stack" | "reviewing" | "dashboard";
type ReviewOutcome = "pending" | "all-clear" | "actions";

export default function App() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [packages, setPackages] = useState<DecisionPackage[]>([]);
  const [pendingCards, setPendingCards] = useState<DecisionCard[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [status, setStatus] = useState<AgentStatusState>({
    mode: "idle",
    pendingCardId: null,
    currentSubscriptionId: null,
  });
  const [negotiation, setNegotiation] = useState<NegotiationState | null>(null);
  const [recording, setRecording] = useState<DirectorFrame[]>([]);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const [progress, setProgress] = useState<GuardianProgressEvent[]>([]);
  const progressRef = useRef<GuardianProgressEvent[]>([]);

  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [reviewOutcome, setReviewOutcome] = useState<ReviewOutcome>("pending");
  const [autopilotNotice, setAutopilotNotice] = useState<AutopilotCheckEvent | null>(null);
  const [autopilotStatus, setAutopilotStatus] = useState<AutopilotStatus | null>(null);

  const director = useDemoDirector();
  const hydrateDirector = director.hydrate;

  const fetchSnapshot = useCallback(async (): Promise<Snapshot> => {
    const [subs, pkgs, cards, saved, pol, stat] = await Promise.all([
      getJson<Subscription[]>("/api/subscriptions"),
      getJson<DecisionPackage[]>("/api/decisions"),
      getJson<DecisionCard[]>("/api/decisions/pending"),
      getJson<{ totalSavings: number; approvedCount: number; lastAction: string | null }>("/api/savings"),
      getJson<Policy>("/api/policy"),
      getJson<AgentStatusState>("/api/agent/status"),
    ]);
    // Hydrate the negotiation from whatever subscription actually negotiated —
    // the pending NEGOTIATE card first, then the persisted packages — instead of
    // hardcoding a single vendor id.
    const negotiatedIds = [
      ...cards.filter((c) => c.action === "NEGOTIATE").map((c) => c.subscriptionId),
      ...pkgs.filter((p) => p.action === "NEGOTIATE").map((p) => p.subscriptionId),
    ];
    const negSubscriptionId = negotiatedIds[0] ?? "notion";
    const neg = await getJson<NegotiationState>(`/api/negotiation/${encodeURIComponent(negSubscriptionId)}`).catch(() => null);
    return { subs, pkgs, cards, saved, pol, stat, neg };
  }, []);

  const refresh = useCallback(async () => {
    const snap = await fetchSnapshot();
    setSubscriptions(snap.subs);
    setPackages(snap.pkgs);
    setPendingCards(snap.cards);
    setPolicy(snap.pol);
    setStatus(snap.stat);
    setNegotiation(snap.neg);
  }, [fetchSnapshot]);

  const loadRecording = useCallback(async () => {
    try {
      const frames = await getJson<DirectorFrame[]>("/api/demo/recording");
      setRecording(Array.isArray(frames) ? frames : []);
    } catch {
      setRecording([]);
    }
  }, []);

  const enterDashboard = useCallback(async () => {
    await refresh();
    await loadRecording();
    const snap = await fetchSnapshot();
    hydrateDirector(
      hydrateFrames({
        packages: snap.pkgs,
        negotiation: snap.neg,
        cards: snap.cards,
        savings: snap.saved,
        status: snap.stat,
      })
    );
    fetchAutopilotStatus().then(setAutopilotStatus).catch(() => undefined);
    setLoading(false);
    setScreen("dashboard");
  }, [refresh, loadRecording, fetchSnapshot, hydrateDirector]);

  const runLiveDemo = useCallback(async () => {
    setProgress([]);
    progressRef.current = [];
    setErrorBanner(null);
    setRunning(true);
    setReviewOutcome("pending");
    setScreen("reviewing");
    try {
      const result = await postJson<{
        decisionPackages: number;
        cardsPending: number;
        subscriptionsChecked: number;
      }>("/api/demo/run", { mode: "live" });
      const nothingFound = result.decisionPackages === 0;
      setLastRun({
        mode: "live",
        checkedSubscriptions: result.subscriptionsChecked,
        flaggedPackages: result.decisionPackages,
        cardsPending: result.cardsPending,
      });
      setReviewOutcome(nothingFound ? "all-clear" : "actions");
      setRunning(false);
      if (nothingFound) {
        // Hold on the "nothing needs attention" confirmation so it is readable.
        await new Promise((resolve) => setTimeout(resolve, 1600));
      }
      await enterDashboard();
    } catch (err) {
      setErrorBanner((err as Error).message);
      setRunning(false);
      setReviewOutcome("pending");
    }
  }, [enterDashboard]);

  const runMockDemo = useCallback(async () => {
    setErrorBanner(null);
    setRunning(true);
    try {
      const result = await postJson<{
        decisionPackages: number;
        cardsPending: number;
        subscriptionsChecked: number;
      }>("/api/demo/run", { mode: "mock" });
      setLastRun({
        mode: "mock",
        checkedSubscriptions: result.subscriptionsChecked,
        flaggedPackages: result.decisionPackages,
        cardsPending: result.cardsPending,
      });
      setRunning(false);
      await enterDashboard();
    } catch (err) {
      setErrorBanner((err as Error).message);
      setRunning(false);
    }
  }, [enterDashboard]);

  const onSse = useCallback(
    (eventName: string, data: unknown) => {
      if (eventName === "error" && data && typeof data === "object") {
        const err = data as { message?: string };
        if (err.message) setErrorBanner(err.message);
      } else if (eventName === "guardian_progress" && data && typeof data === "object") {
        const event = data as GuardianProgressEvent;
        progressRef.current = [...progressRef.current.filter((p) => p.subscriptionId !== event.subscriptionId || p.status !== "done"), event];
        setProgress([...progressRef.current]);
      } else if (eventName === "autopilot_check" && data && typeof data === "object") {
        const notice = data as AutopilotCheckEvent;
        setAutopilotNotice(notice);
        if (screen === "dashboard") {
          refresh().catch(() => undefined);
        }
      } else if (eventName === "session_reset" && data && typeof data === "object") {
        setLastRun(null);
        setAutopilotNotice(null);
        setReviewOutcome("pending");
        setScreen("company");
        refresh().catch(() => undefined);
      } else if (eventName === "decision_card" || eventName === "savings_update" || eventName === "agent_status") {
        if (eventName === "agent_status" && data && typeof data === "object") {
          setStatus(data as AgentStatusState);
        }
        if (screen === "dashboard") {
          refresh().catch(() => undefined);
        }
      }
    },
    [refresh, screen]
  );

  useSSE(onSse);

  const resetDemo = useCallback(async () => {
    setErrorBanner(null);
    setRunning(true);
    try {
      await postJson("/api/demo/reset");
      await refresh();
      await loadRecording();
      hydrateDirector([]);
      setLastRun(null);
      setAutopilotNotice(null);
      setReviewOutcome("pending");
    } catch (err) {
      setErrorBanner((err as Error).message);
    } finally {
      setRunning(false);
    }
  }, [refresh, loadRecording, hydrateDirector]);

  const startNewCompany = useCallback(async () => {
    setErrorBanner(null);
    try {
      await sessionReset();
      setSubscriptions([]);
      setPackages([]);
      setPendingCards([]);
      setLastRun(null);
      setAutopilotNotice(null);
      setReviewOutcome("pending");
      setErrorBanner(null);
      hydrateDirector([]);
      setScreen("company");
    } catch (err) {
      setErrorBanner((err as Error).message);
    }
  }, [hydrateDirector]);

  const decide = useCallback(
    async (card: DecisionCard, outcome: "approve" | "reject") => {
      setErrorBanner(null);
      try {
        await postJson(`/api/decisions/${encodeURIComponent(card.id)}/${outcome}`);
        await refresh();
        await loadRecording();
      } catch (err) {
        setErrorBanner((err as Error).message);
      }
    },
    [refresh, loadRecording]
  );

  const goLanding = useCallback(() => {
    setScreen("landing");
    setErrorBanner(null);
  }, []);

  if (screen === "landing") {
    return (
      <div className="app">
        <Landing onMock={runMockDemo} onSetup={() => setScreen("company")} busy={running} />
        {errorBanner && <div className="error-banner">⚠ {errorBanner}</div>}
      </div>
    );
  }

  if (screen === "company") {
    return (
      <div className="app">
        <nav className="breadcrumb">
          <button className="btn-link" onClick={goLanding}>
            ← back to start
          </button>
        </nav>
        <CompanyForm saving={running} error={errorBanner} onSave={async (company: Company) => {
          setErrorBanner(null);
          setRunning(true);
          try {
            await postJson("/api/session/company", company);
            setScreen("stack");
          } catch (err) {
            setErrorBanner((err as Error).message);
          } finally {
            setRunning(false);
          }
        }} />
      </div>
    );
  }

  if (screen === "stack") {
    return (
      <div className="app">
        <nav className="breadcrumb">
          <button className="btn-link" onClick={goLanding}>
            ← back to start
          </button>
          {" > "}
          <button className="btn-link" onClick={() => setScreen("company")}>
            company
          </button>
        </nav>
        <StackSetup importing={running} error={errorBanner} onImport={async (subs: Subscription[]) => {
          setErrorBanner(null);
          setRunning(true);
          try {
            await postJson("/api/stack/import", subs);
            runLiveDemo();
          } catch (err) {
            setErrorBanner((err as Error).message);
            setRunning(false);
          }
        }} />
      </div>
    );
  }

  if (screen === "reviewing") {
    return (
      <div className="app">
        <nav className="breadcrumb">
          <button className="btn-link" onClick={goLanding}>
            ← back to start
          </button>
        </nav>
        {autopilotNotice && (
          <div className="autopilot-banner">
            <span className="autopilot-pulse" aria-hidden="true" />
            <span>
              Savr checked your stack on its own at {timeOfDay(autopilotNotice.checkedAt)} —{" "}
              {autopilotNotice.action === "nothing_found"
                ? "nothing flagged."
                : `${autopilotNotice.flaggedPackages} item(s) flagged, ${autopilotNotice.cardsPending} awaiting your review.`}
            </span>
          </div>
        )}
        <Reviewing
          progress={progress}
          running={running}
          error={errorBanner}
          checkedCount={lastRun?.checkedSubscriptions ?? null}
          foundNothing={reviewOutcome === "all-clear"}
        />
        {running && <div className="running-banner">Guardian + negotiator running…</div>}
      </div>
    );
  }

  const actionsBySub: Record<string, DecisionAction> = {};
  for (const pkg of packages) {
    actionsBySub[pkg.subscriptionId] = pkg.action;
  }
  const pendingSubs = new Set(pendingCards.map((c) => c.subscriptionId));
  const pendingCount = pendingCards.length;
  const resolved = director.state.phase === "resolved";
  const showAllClear =
    lastRun?.mode === "live" && lastRun.flaggedPackages === 0 && packages.length === 0;

  return (
    <div className="app">
      <nav className="breadcrumb">
        <button className="btn-link" onClick={goLanding}>
          ← start over
        </button>
        <span className="breadcrumb-sep">·</span>
        <button className="btn-link" onClick={startNewCompany} title="Clear the current company and stack, then set up a different one">
          ↻ different company
        </button>
      </nav>

      {autopilotNotice && (
        <div className="autopilot-banner">
          <span className="autopilot-pulse" aria-hidden="true" />
          <span>
            Savr checked your stack on its own at {timeOfDay(autopilotNotice.checkedAt)} —{" "}
            {autopilotNotice.action === "nothing_found"
              ? "nothing flagged."
              : `${autopilotNotice.flaggedPackages} item(s) flagged, ${autopilotNotice.cardsPending} awaiting your review.`}
          </span>
          <button
            className="btn-link"
            onClick={() => setAutopilotNotice(null)}
            aria-label="Dismiss notice"
          >
            ✕
          </button>
        </div>
      )}

      <header className="app-header">
        <div>
          <h1>
            SAVR <span className="muted">— Acme Corp SaaS Stack</span>
          </h1>
        </div>
        <div className="header-right">
          <span className="autopilot-badge" title="The agent keeps checking this stack on its own">
            <span className="autopilot-pulse" aria-hidden="true" />
            AUTOPILOT
            {autopilotStatus?.lastCheck
              ? ` · last check ${timeOfDay(autopilotStatus.lastCheck.checkedAt)}`
              : autopilotStatus
                ? ` · every ${Math.max(1, Math.round(autopilotStatus.intervalMs / 1000))}s`
                : null}
          </span>
          <span className={`mode-badge mode-${status.mode}`}>
            {status.mode === "waiting_for_approval" ? "awaiting approval" : status.mode}
          </span>
          <span className={`live-badge ${director.live ? "live" : "replay"}`}>
            {director.live ? "● LIVE" : "▶ REPLAY"}
          </span>
          <SavingsCounter
            totalSavings={director.state.savings}
            approvedCount={director.state.approvedCount}
          />
        </div>
      </header>

      <div className="hero-strip">
        <PhaseBar phase={director.state.phase} pendingCount={pendingCount} />
        <PendingActions pendingCount={pendingCount} />
      </div>

      {errorBanner && <div className="error-banner">⚠ {errorBanner}</div>}
      {running && <div className="running-banner">Guardian + negotiator running…</div>}

      {showAllClear && (
        <section className="panel all-clear-panel">
          <p className="all-clear-title">Nothing needs attention</p>
          <p>
            Checked {lastRun.checkedSubscriptions} subscriptions against your policy. The agent
            found no renewals, seat inefficiency, or overlaps worth acting on — it will keep
            checking and let you know the moment anything changes.
          </p>
          <span className="panel-note">Savr runs in the background — this is not a one-shot scan.</span>
        </section>
      )}

      <DemoControls
        running={running}
        replaying={director.replaying}
        recordingAvailable={recording.length > 0}
        onRun={runMockDemo}
        onReset={resetDemo}
        onReplay={() => director.playRecording(recording)}
      />

      <div className="layout">
        <div className="col-main">
          {loading ? (
            <section className="panel" aria-label="Loading">
              <div className="panel-head">
                <h2>Loading stack…</h2>
              </div>
              <div className="skeleton-lines" aria-hidden="true">
                <span className="skeleton" />
                <span className="skeleton" />
                <span className="skeleton" />
                <span className="skeleton" />
                <span className="skeleton" />
              </div>
            </section>
          ) : (
            <>
              <NegotiationLog
                subscriptionId={negotiation?.subscriptionId ?? null}
                maxRounds={negotiation?.maxRounds ?? 5}
                currentPrice={negotiation?.currentPrice ?? null}
                transcript={director.state.transcript}
                rounds={director.state.rounds}
                resolution={director.state.resolution}
                meta={director.state.meta}
                negotiation={negotiation}
              />
              <DecisionCardView
                cards={pendingCards}
                packages={packages}
                onApprove={(c) => decide(c, "approve")}
                onReject={(c) => decide(c, "reject")}
              />
              {director.state.recap.length > 0 && (
                <section className="panel panel-recap" aria-label="What changed">
                  <div className="panel-head">
                    <h2>What changed</h2>
                    <span className="panel-note">savings applied</span>
                  </div>
                  <ul className="recap-list">
                    {director.state.recap.map((item) => (
                      <li key={item.cardId}>
                        <strong>{item.subscriptionId}</strong> {item.action.toLowerCase()} —{" "}
                        {item.realizedSavings > 0
                          ? `→ ${fmtUsd(item.realizedSavings)}/yr realized`
                          : item.summary}
                      </li>
                    ))}
                  </ul>
                  {resolved && (
                    <p className="recap-total">
                      Total: <strong>{fmtUsd(director.state.savings)}/yr</strong> every renewal cycle.
                    </p>
                  )}
                </section>
              )}
              <StackOverview
                subscriptions={subscriptions}
                actionsBySub={actionsBySub}
                pendingSubs={pendingSubs}
              />
            </>
          )}
        </div>
        <div className="col-side">
          <ActivityLog activity={director.state.activity} />
          <GuardianFeed packages={packages} />
          <PolicyView policy={policy} />
        </div>
      </div>
    </div>
  );
}