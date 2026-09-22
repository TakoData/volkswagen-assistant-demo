export type TakoCard = {
  id: string;
  title: string;
  embedUrl: string;
  imageUrl?: string;
  webpageUrl?: string;
  description?: string;
  sources: string[];
};

export type TakoAnswer = {
  answer: string;
  cards: TakoCard[];
  requestId?: string;
};

export type AssistantPhase =
  | "off"
  | "armed"
  | "listening"
  | "thinking"
  | "speaking"
  | "complete"
  | "error";
