import type { FormEvent } from "react";
import type { Company } from "../types";

interface CompanyFormProps {
  initial?: Company;
  saving: boolean;
  error: string | null;
  onSave: (company: Company) => Promise<void>;
}

export default function CompanyForm({ initial, saving, error, onSave }: CompanyFormProps) {
  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const employees = Number(data.get("employees"));
    const annualBudget = Number(data.get("annualBudget"));
    if (!name || !Number.isFinite(employees) || employees <= 0 || !Number.isFinite(annualBudget) || annualBudget <= 0) {
      return;
    }
    void onSave({ name, employees, annualBudget });
  };

  return (
    <section className="panel setup-panel">
      <div className="panel-head">
        <h2>Your Company</h2>
        <span className="panel-note">step 1 of 3 · session only, nothing is stored permanently</span>
      </div>

      <form className="setup-form" onSubmit={handleSubmit}>
        <label>
          Company name
          <input
            type="text"
            name="name"
            required
            defaultValue={initial?.name ?? ""}
            placeholder="e.g. Northwind Labs"
          />
        </label>
        <div className="setup-row">
          <label>
            Employees
            <input type="number" name="employees" required min={1} defaultValue={initial?.employees ?? ""} />
          </label>
          <label>
            Annual SaaS budget (USD)
            <input
              type="number"
              name="annualBudget"
              required
              min={1000}
              step={1000}
              defaultValue={initial?.annualBudget ?? ""}
            />
          </label>
        </div>

        {error && <p className="setup-error">⚠ {error}</p>}

        <button className="btn-primary" disabled={saving} type="submit">
          {saving ? "Saving…" : "Save Company"}
        </button>
      </form>
    </section>
  );
}