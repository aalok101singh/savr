import type { Offer } from "../types/index.js";

export interface VendorPolicy {
  vendorId: string;
  vendorName: string;
  reservationPrice: number;
  seats: number;
  discountSchedule: number[];
  terms: string[];
  maxRounds: number;
}

export const VENDOR_POLICIES: Record<string, VendorPolicy> = {
  notion: {
    vendorId: "notion",
    vendorName: "Notion",
    reservationPrice: 8400,
    seats: 20,
    discountSchedule: [10, 15, 18, 20, 22],
    terms: [
      "Annual billing",
      "2-year commitment, annual billing",
      "2-year commitment, annual billing",
      "2-year commitment, annual billing",
      "2-year commitment, annual billing",
    ],
    maxRounds: 5,
  },
};

export function resolveVendorPolicy(vendorId: string): VendorPolicy | undefined {
  return VENDOR_POLICIES[vendorId];
}

export interface CounterResult {
  totalAnnual: number;
  pricePerSeat: number;
  terms: string;
}

export function counterForRound(
  policy: VendorPolicy,
  buyerCurrentPrice: number,
  round: number,
  discountBonusPct = 0
): CounterResult {
  const index = Math.min(Math.max(round, 1), policy.maxRounds) - 1;
  const discount = policy.discountSchedule[index] + (discountBonusPct || 0);
  let totalAnnual = Math.round((buyerCurrentPrice * (100 - discount)) / 100);
  if (totalAnnual < policy.reservationPrice) {
    totalAnnual = policy.reservationPrice;
  }
  const pricePerSeat = policy.seats > 0 ? Math.round(totalAnnual / policy.seats) : 0;
  return { totalAnnual, pricePerSeat, terms: policy.terms[index] };
}

export function competitorEvidenceBonus(message: string): number {
  const hasCompetitorEvidence = /\bcompetitor\b[^0-9]{0,40}\d{3,}/i.test(message ?? "");
  return hasCompetitorEvidence ? 2 : 0;
}

export function toOffer(counter: CounterResult, seats: number, expiresAt: string): Offer {
  return {
    pricePerSeat: counter.pricePerSeat,
    totalAnnual: counter.totalAnnual,
    seatsIncluded: seats,
    terms: counter.terms,
    expiresAt,
  };
}

export function offerForAcceptance(policy: VendorPolicy, buyerOfferPrice: number, expiresAt: string): Offer {
  return {
    pricePerSeat: policy.seats > 0 ? Math.round(buyerOfferPrice / policy.seats) : 0,
    totalAnnual: buyerOfferPrice,
    seatsIncluded: policy.seats,
    terms: policy.terms[0],
    expiresAt,
  };
}