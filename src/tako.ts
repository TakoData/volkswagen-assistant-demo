import type { TakoAnswer, TakoCard } from "./types";

const ANSWER_URL = "https://tako.com/api/v1/answer";
const PROXY_URL = process.env.EXPO_PUBLIC_TAKO_PROXY_URL?.trim().replace(/\/$/, "") || "";
const DEMO_ACCESS_TOKEN = process.env.EXPO_PUBLIC_DEMO_ACCESS_TOKEN?.trim() || "";

export const usesHostedRelay = Boolean(PROXY_URL);

const normalizeCard = (card: Record<string, unknown>, index: number): TakoCard => {
  const embedUrl = String(card.embed_url ?? card.embedUrl ?? "");
  const sources = Array.isArray(card.sources)
    ? card.sources.map((source) => {
      if (typeof source === "string") return source;
      if (source && typeof source === "object") {
        const record = source as Record<string, unknown>;
        return String(record.source_name ?? record.name ?? "Data source");
      }
      return String(source);
    })
    : [];
  return {
    id: String(card.id ?? card.card_id ?? card.cardId ?? `card-${index}`),
    title: String(card.title ?? "Knowledge card"),
    embedUrl,
    imageUrl: card.image_url ? String(card.image_url) : undefined,
    webpageUrl: card.webpage_url ? String(card.webpage_url) : undefined,
    description: card.description ? String(card.description) : undefined,
    sources,
  };
};

export const toGlanceableUrl = (embedUrl: string): string => {
  if (!embedUrl) return "";
  try {
    const url = new URL(embedUrl);
    url.searchParams.set("glanceable", "true");
    url.searchParams.set("dark_mode", "true");
    return url.toString();
  } catch {
    const separator = embedUrl.includes("?") ? "&" : "?";
    return `${embedUrl}${separator}glanceable=true&dark_mode=true`;
  }
};

export async function askTako(query: string, apiKey?: string | null): Promise<TakoAnswer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    if (!usesHostedRelay && !apiKey) {
      throw new Error("Assistant setup is incomplete. Ask the demo administrator for help.");
    }

    const response = await fetch(usesHostedRelay ? `${PROXY_URL}/answer` : ANSWER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(usesHostedRelay
          ? (DEMO_ACCESS_TOKEN ? { Authorization: `Bearer ${DEMO_ACCESS_TOKEN}` } : {})
          : { "X-API-Key": apiKey as string }),
      },
      body: JSON.stringify({
        query,
        effort: "fast",
        locale: "en-US",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin",
        output_settings: { image_dark_mode: true },
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(usesHostedRelay
          ? "This demo build is no longer authorized. Ask the demo administrator for a fresh build."
          : "That API key was not accepted. Ask the demo administrator to check it.");
      }
      if (response.status === 402) {
        throw new Error("This API key is out of credits. Add credits or use another key.");
      }
      throw new Error(payload?.error_message ?? payload?.error ?? `The answer service returned ${response.status}.`);
    }

    return {
      answer: String(payload.answer ?? "I couldn't find a spoken answer."),
      cards: Array.isArray(payload.cards) ? payload.cards.map(normalizeCard) : [],
      requestId: payload.request_id ? String(payload.request_id) : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}
