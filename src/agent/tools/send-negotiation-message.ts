import type { Offer, SendMessageResult } from "../../types/index.js";

export interface SendNegotiationOptions {
  round: number;
  buyerCurrentPrice: number;
}

export function sandboxBaseUrl(): string {
  const port = process.env.SANDBOX_PORT ?? "3001";
  return `http://127.0.0.1:${port}`;
}

const REQUEST_TIMEOUT_MS = 5000;

interface SandboxResponse {
  status: string;
  response: string;
  offer: Offer | null;
}

export async function sendNegotiationMessage(
  vendorId: string,
  message: string,
  buyerOfferPrice: number,
  options: Partial<SendNegotiationOptions> = {}
): Promise<SendMessageResult> {
  const body = {
    message,
    round: options.round ?? 1,
    buyerCurrentPrice: options.buyerCurrentPrice ?? buyerOfferPrice,
    buyerOfferPrice,
  };

  let res: Response;
  try {
    res = await fetch(`${sandboxBaseUrl()}/vendor/${encodeURIComponent(vendorId)}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as Error).name;
    return { status: "error", error: name === "TimeoutError" ? "timeout" : "sandbox_unreachable" };
  }

  if (!res.ok) {
    return { status: "error", error: "vendor_rejected" };
  }

  const data = JSON.parse(await res.text()) as SandboxResponse;
  if (data.status !== "success") {
    return { status: "error", error: "vendor_rejected" };
  }

  return { status: "success", response: data.response, offer: data.offer };
}