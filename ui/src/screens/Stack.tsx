import { useState, type FormEvent } from "react";
import { fmtCompact } from "../api";
import type { Subscription } from "../types";

interface StackProps {
  importing: boolean;
  error: string | null;
  onImport: (subs: Subscription[]) => Promise<void>;
}

function makeSubscription(form: HTMLFormElement): Subscription {
  const data = new FormData(form);
  const seatsPurchased = Number(data.get("seatsPurchased"));
  const seatsActive = Number(data.get("seatsActive"));
  const pricePerSeat = seatsPurchased > 0 && data.get("annualCost") ? Number(data.get("annualCost")) / seatsPurchased : null;
  const today = new Date();
  return {
    id: String(data.get("id") ?? "").toLowerCase().trim(),
    vendorName: String(data.get("vendorName") ?? "").trim(),
    category: String(data.get("category") ?? "").trim(),
    billingModel: "seat_based",
    status: "active",
    contractStart: today.toISOString(),
    contractEnd: today.toISOString(),
    renewalDate: String(data.get("renewalDate") ?? ""),
    billingCycle: "annual",
    annualCost: Number(data.get("annualCost")),
    currentPeriodCost: Number(data.get("annualCost")),
    renewalCost: null,
    seatsPurchased: seatsPurchased > 0 ? seatsPurchased : null,
    seatsActive: seatsActive > 0 ? seatsActive : null,
    pricePerSeat: pricePerSeat !== null && Number.isFinite(pricePerSeat) ? Math.round(pricePerSeat) : null,
    priceIncreasePct: null,
    autoRenew: true,
    usageMetric: null,
    notes: "",
  };
}

export default function StackSetup({ importing, error, onImport }: StackProps) {
  const [drafts, setDrafts] = useState<Subscription[]>([]);
  const [jsonValue, setJsonValue] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const addRow = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const sub = makeSubscription(e.currentTarget);
    setDrafts((prev) => [...prev.filter((s) => s.id !== sub.id), sub]);
    e.currentTarget.reset();
  };

  const removeRow = (id: string): void => {
    setDrafts((prev) => prev.filter((s) => s.id !== id));
  };

  const importJson = (): void => {
    if (!jsonValue.trim()) {
      setParseError("Paste a JSON array of subscriptions first.");
      return;
    }
    setParseError(null);
    try {
      const parsed = JSON.parse(jsonValue) as unknown;
      const array = Array.isArray(parsed) ? parsed : [parsed];
      if (array.length === 0) {
        setParseError("The JSON array is empty.");
        return;
      }
      void onImport(array as Subscription[]);
    } catch (err) {
      setParseError(`Invalid JSON: ${(err as Error).message}`);
    }
  };

  const importDrafts = (): void => {
    if (drafts.length === 0) {
      setParseError("Add at least one tool first (or paste JSON).");
      return;
    }
    setParseError(null);
    void onImport(drafts);
  };

  return (
    <section className="panel setup-panel">
      <div className="panel-head">
        <h2>Your Stack</h2>
        <span className="panel-note">step 2 of 3 · validated by the same endpoint the mock walkthrough uses</span>
      </div>

      <h3>Add tools one at a time</h3>
      <form className="setup-form setup-form-grid" onSubmit={addRow}>
        <label>
          Tool id
          <input type="text" name="id" required placeholder="figma" />
        </label>
        <label>
          Vendor name
          <input type="text" name="vendorName" required placeholder="Figma" />
        </label>
        <label>
          Category
          <input type="text" name="category" required placeholder="Design" />
        </label>
        <label>
          Annual cost (USD)
          <input type="number" name="annualCost" required min={1} step={1} placeholder="9600" />
        </label>
        <label>
          Seats purchased
          <input type="number" name="seatsPurchased" min={1} placeholder="16" />
        </label>
        <label>
          Seats active
          <input type="number" name="seatsActive" min={0} placeholder="6" />
        </label>
        <label>
          Renewal date
          <input type="date" name="renewalDate" required />
        </label>
        <div className="setup-form-actions">
          <button className="btn-secondary" type="submit">
            Add tool
          </button>
        </div>
      </form>

      {drafts.length > 0 && (
        <div className="draft-list">
          <div className="draft-list-head">
            <h3>Added ({drafts.length})</h3>
            <span className="panel-note">seat_based · annual billing</span>
          </div>
          <table className="stack-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Category</th>
                <th>Annual</th>
                <th>Seats</th>
                <th>Renewal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="mono">{s.id}</span> — {s.vendorName}
                  </td>
                  <td>{s.category}</td>
                  <td className="num">{fmtCompact(s.annualCost)}</td>
                  <td className="num">
                    {s.seatsActive}/{s.seatsPurchased}
                  </td>
                  <td className="num">{s.renewalDate.slice(0, 10)}</td>
                  <td>
                    <button className="btn-link" onClick={() => removeRow(s.id)}>
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="setup-inline">
            <button className="btn-primary" disabled={importing} onClick={importDrafts}>
              {importing ? "Importing…" : "Save this stack"}
            </button>
          </div>
        </div>
      )}

      <div className="or-divider">or</div>

      <h3>Paste your stack as JSON</h3>
      <p className="setup-hint">
        A JSON array matching the <span className="mono">Subscription[]</span> shape — same input the /api/stack/import
        endpoint already validates. Primary path for the demo video and for anyone testing whether this actually works.
      </p>
      <textarea
        className="setup-json"
        spellCheck={false}
        placeholder='[{"id":"figma","vendorName":"Figma","category":"Design","billingModel":"seat_based","annualCost":9600,"seatsPurchased":16,"seatsActive":6,"renewalDate":"2026-10-01"}, ...]'
        value={jsonValue}
        onChange={(e) => setJsonValue(e.target.value)}
      />
      <div className="setup-inline">
        <button className="btn-secondary" disabled={importing || !jsonValue.trim()} onClick={importJson}>
          {importing ? "Importing…" : "Import JSON stack"}
        </button>
      </div>

      {(error || parseError) && <p className="setup-error">⚠ {error ?? parseError}</p>}
    </section>
  );
}