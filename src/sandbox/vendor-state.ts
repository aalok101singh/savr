import type { Offer } from "../types/index.js";

export interface ReceivedMessage {
  message: string;
  round: number;
  buyerCurrentPrice: number;
  buyerOfferPrice: number;
}

export interface VendorNegotiationState {
  vendorId: string;
  buyerCurrentPrice: number | null;
  roundsCompleted: number;
  currentOffer: { totalAnnual: number; terms: string } | null;
  status: "idle" | "negotiating" | "accepted" | "max_rounds";
  responses: Record<string, unknown>;
  lastBuyerOfferPrices: number[];
  receivedMessages: ReceivedMessage[];
}

const vendorStates = new Map<string, VendorNegotiationState>();

export function getVendorState(vendorId: string): VendorNegotiationState {
  let state = vendorStates.get(vendorId);
  if (!state) {
    state = {
      vendorId,
      buyerCurrentPrice: null,
      roundsCompleted: 0,
      currentOffer: null,
      status: "idle",
      responses: {},
      lastBuyerOfferPrices: [],
      receivedMessages: [],
    };
    vendorStates.set(vendorId, state);
  }
  return state;
}

export function resetVendorState(vendorId: string): void {
  vendorStates.delete(vendorId);
}

export function resetAllVendorState(): void {
  vendorStates.clear();
}

export function idempotencyKey(round: number, buyerOfferPrice: number): string {
  return `${round}:${buyerOfferPrice}`;
}

export function hasCachedResponse(state: VendorNegotiationState, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.responses, key);
}

export function cachedResponse(state: VendorNegotiationState, key: string): unknown {
  return state.responses[key];
}

export function trailingIdenticalOfferCount(state: VendorNegotiationState, buyerOfferPrice: number): number {
  let count = 0;
  for (let i = state.lastBuyerOfferPrices.length - 1; i >= 0; i--) {
    if (state.lastBuyerOfferPrices[i] === buyerOfferPrice) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

export function recordRound(
  state: VendorNegotiationState,
  round: number,
  buyerOfferPrice: number,
  offer: Offer
): void {
  state.roundsCompleted = Math.max(state.roundsCompleted, round);
  state.currentOffer = { totalAnnual: offer.totalAnnual, terms: offer.terms };
  state.lastBuyerOfferPrices.push(buyerOfferPrice);
}

export function recordReceivedMessage(state: VendorNegotiationState, received: ReceivedMessage): void {
  state.receivedMessages.push(received);
}

export function setNegotiationStatus(state: VendorNegotiationState, status: VendorNegotiationState["status"]): void {
  state.status = status;
}