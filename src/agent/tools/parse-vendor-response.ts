import type { ParseVendorResponseResult } from "../../types/index.js";

export function parseVendorResponse(rawResponse: string): ParseVendorResponseResult {
  try {
    const obj = JSON.parse(rawResponse);
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      return { status: "parse_failure", reason: "Input is not a JSON object." };
    }
    const pricePerSeat = obj.pricePerSeat;
    const totalAnnual = obj.totalAnnual;
    const seatsIncluded = obj.seatsIncluded;
    const terms = obj.terms;
    const expiresAt = obj.expiresAt;
    const requiredMissing = (
      [
        ["pricePerSeat", pricePerSeat],
        ["totalAnnual", totalAnnual],
        ["seatsIncluded", seatsIncluded],
        ["terms", terms],
        ["expiresAt", expiresAt],
      ] as const
    )
      .filter(([, v]) => v === undefined || v === null || v === "")
      .map(([k]) => k);
    if (requiredMissing.length > 0) {
      return {
        status: "parse_failure",
        reason: `Missing required fields: ${requiredMissing.join(", ")}.`,
      };
    }
    if (
      typeof pricePerSeat !== "number" ||
      typeof totalAnnual !== "number" ||
      typeof seatsIncluded !== "number" ||
      typeof terms !== "string" ||
      typeof expiresAt !== "string" ||
      Number.isNaN(Date.parse(expiresAt))
    ) {
      return { status: "parse_failure", reason: "Fields present but invalid types or date format." };
    }
    return {
      status: "success",
      offer: { pricePerSeat, totalAnnual, seatsIncluded, terms, expiresAt },
    };
  } catch {
    return { status: "parse_failure", reason: "Input is not valid JSON." };
  }
}