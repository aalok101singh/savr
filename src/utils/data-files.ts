import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./env.js";
import type {
  Subscription,
  Policy,
  Evidence,
  ProcurementMemory,
  DecisionCard,
  DecisionPackage,
  Company,
} from "../types/index.js";

export function loadJson<T>(file: string): T {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) {
    throw new Error(`Missing data file: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export function loadSubscriptions(): Subscription[] {
  return loadJson<Subscription[]>("subscriptions.json");
}

export function loadPolicy(): Policy {
  return loadJson<Policy>("policy.json");
}

export function loadCompany(): Company {
  return loadJson<Company>("company.json");
}

export function saveCompany(company: Company): void {
  writeFileSync(join(DATA_DIR, "company.json"), JSON.stringify(company, null, 2), "utf-8");
}

export function loadCachedEvidence(): Record<string, Evidence[]> {
  return loadJson<Record<string, Evidence[]>>("cached-evidence.json");
}

export function defaultMemory(): ProcurementMemory {
  return {
    companyId: "acme",
    decisions: [],
    negotiations: [],
    vendorHistory: {},
    policies: [],
  };
}

export function loadMemory(): ProcurementMemory {
  if (!existsSync(join(DATA_DIR, "memory.json"))) {
    const memory = defaultMemory();
    writeFileSync(join(DATA_DIR, "memory.json"), JSON.stringify(memory, null, 2), "utf-8");
    return memory;
  }
  return loadJson<ProcurementMemory>("memory.json");
}

const CARDS_FILE = "cards.json";

export function loadCards(): DecisionCard[] {
  const path = join(DATA_DIR, CARDS_FILE);
  if (!existsSync(path)) {
    return [];
  }
  return JSON.parse(readFileSync(path, "utf-8")) as DecisionCard[];
}

export function saveCards(cards: DecisionCard[]): void {
  writeFileSync(join(DATA_DIR, CARDS_FILE), JSON.stringify(cards, null, 2), "utf-8");
}

export function upsertPendingCard(card: DecisionCard): DecisionCard[] {
  const cards = loadCards().filter(
    (existing) => !(existing.subscriptionId === card.subscriptionId && existing.status === "pending")
  );
  cards.push(card);
  saveCards(cards);
  return cards;
}

export function saveSubscriptions(subscriptions: Subscription[]): void {
  writeFileSync(join(DATA_DIR, "subscriptions.json"), JSON.stringify(subscriptions, null, 2), "utf-8");
}

export function saveMemory(memory: ProcurementMemory): void {
  writeFileSync(join(DATA_DIR, "memory.json"), JSON.stringify(memory, null, 2), "utf-8");
}

const PACKAGES_FILE = "packages.json";

export function loadPackages(): DecisionPackage[] {
  const path = join(DATA_DIR, PACKAGES_FILE);
  if (!existsSync(path)) {
    return [];
  }
  return JSON.parse(readFileSync(path, "utf-8")) as DecisionPackage[];
}

export function savePackages(packages: DecisionPackage[]): void {
  writeFileSync(join(DATA_DIR, PACKAGES_FILE), JSON.stringify(packages, null, 2), "utf-8");
}

const SEED_DIR = join(DATA_DIR, "seed");

export function ensureSeed(): void {
  if (existsSync(join(SEED_DIR, "subscriptions.json"))) return;
  mkdirSync(SEED_DIR, { recursive: true });
  writeFileSync(join(SEED_DIR, "subscriptions.json"), JSON.stringify(loadSubscriptions(), null, 2), "utf-8");
  writeFileSync(join(SEED_DIR, "memory.json"), JSON.stringify(defaultMemory(), null, 2), "utf-8");
  writeFileSync(join(SEED_DIR, "cards.json"), JSON.stringify([], null, 2), "utf-8");
  writeFileSync(join(SEED_DIR, "packages.json"), JSON.stringify([], null, 2), "utf-8");
}

export function seedSubscriptions(): Subscription[] {
  ensureSeed();
  return JSON.parse(readFileSync(join(SEED_DIR, "subscriptions.json"), "utf-8")) as Subscription[];
}

export function seedMemory(): ProcurementMemory {
  ensureSeed();
  return JSON.parse(readFileSync(join(SEED_DIR, "memory.json"), "utf-8")) as ProcurementMemory;
}