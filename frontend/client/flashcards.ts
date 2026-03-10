export type FlashcardStatus = "idle" | "creating" | "active";

export type FlashcardActionType =
  | "flashcards.create"
  | "flashcards.next"
  | "flashcards.reveal_answer"
  | "flashcards.end";

export interface FlashcardCard {
  id: string;
  front: string;
  back: string;
}

export interface FlashcardDeck {
  id?: string;
  title?: string;
  cards: FlashcardCard[];
}

export interface FlashcardState {
  status: FlashcardStatus;
  deck: FlashcardDeck | null;
  currentIndex: number;
  isAnswerRevealed: boolean;
}

export interface FlashcardAction {
  type: FlashcardActionType;
  status?: string;
  requestId?: string;
  jobId?: string;
  payload?: unknown;
}

export const EMPTY_FLASHCARD_STATE: FlashcardState = {
  status: "idle",
  deck: null,
  currentIndex: 0,
  isAnswerRevealed: false,
};

const FLASHCARD_ACTION_TYPES = new Set<FlashcardActionType>([
  "flashcards.create",
  "flashcards.next",
  "flashcards.reveal_answer",
  "flashcards.end",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getRecordValue<T = unknown>(
  record: Record<string, unknown>,
  keys: string[],
): T | undefined {
  for (const key of keys) {
    if (key in record) return record[key] as T;
  }
  return undefined;
}

function parseJsonCandidate(input: string): unknown {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!fencedMatch?.[1]) return null;
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      return null;
    }
  }
}

function normalizeCard(input: unknown, index: number): FlashcardCard | null {
  if (!isRecord(input)) return null;

  const front = asNonEmptyString(getRecordValue(input, ["front", "question"]));
  const back = asNonEmptyString(getRecordValue(input, ["back", "answer"]));

  if (!front || !back) return null;

  return {
    id: asNonEmptyString(input.id) ?? `flashcard-${index}`,
    front,
    back,
  };
}

function normalizeDeck(input: unknown): FlashcardDeck | null {
  if (!isRecord(input)) return null;

  const cardsInput = getRecordValue<unknown>(input, [
    "cards",
    "deck",
    "flashcards",
    "items",
  ]);

  if (Array.isArray(cardsInput)) {
    const cards = cardsInput
      .map((card, index) => normalizeCard(card, index))
      .filter((card): card is FlashcardCard => card !== null);

    if (cards.length === 0) return null;

    return {
      id: asNonEmptyString(input.id) ?? asNonEmptyString(input.deck_id),
      title: asNonEmptyString(input.title) ?? asNonEmptyString(input.deck_title),
      cards,
    };
  }

  if (isRecord(cardsInput)) {
    const nestedCards = getRecordValue<unknown>(cardsInput, [
      "cards",
      "flashcards",
      "items",
    ]);

    if (!Array.isArray(nestedCards)) return null;

    const cards = nestedCards
      .map((card, index) => normalizeCard(card, index))
      .filter((card): card is FlashcardCard => card !== null);

    if (cards.length === 0) return null;

    return {
      id:
        asNonEmptyString(cardsInput.id) ??
        asNonEmptyString(cardsInput.deck_id) ??
        asNonEmptyString(input.id),
      title:
        asNonEmptyString(cardsInput.title) ??
        asNonEmptyString(cardsInput.deck_title) ??
        asNonEmptyString(input.title),
      cards,
    };
  }

  return null;
}

function normalizeActionCandidate(candidate: unknown): FlashcardAction | null {
  if (!isRecord(candidate)) return null;

  const directType = asNonEmptyString(candidate.type);
  if (directType && FLASHCARD_ACTION_TYPES.has(directType as FlashcardActionType)) {
    return {
      type: directType as FlashcardActionType,
      status: asNonEmptyString(candidate.status),
      requestId: asNonEmptyString(candidate.request_id) ?? asNonEmptyString(candidate.requestId),
      jobId: asNonEmptyString(candidate.job_id) ?? asNonEmptyString(candidate.jobId),
      payload: getRecordValue(candidate, ["payload", "data", "deck", "flashcards"]),
    };
  }

  const nestedAction = getRecordValue<unknown>(candidate, [
    "action",
    "frontend_action",
    "frontendAction",
  ]);
  if (nestedAction) return normalizeActionCandidate(nestedAction);

  return null;
}

export function extractFlashcardAction(rawEvent: unknown): FlashcardAction | null {
  const queue: unknown[] = [rawEvent];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || seen.has(current)) continue;
    seen.add(current);

    const directAction = normalizeActionCandidate(current);
    if (directAction) return directAction;

    if (typeof current === "string") {
      const parsed = parseJsonCandidate(current);
      if (parsed != null) queue.push(parsed);
      continue;
    }

    if (!isRecord(current)) continue;

    const content = getRecordValue<unknown>(current, ["content"]);
    const parts = isRecord(content) ? getRecordValue<unknown>(content, ["parts"]) : undefined;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (!isRecord(part)) continue;

        if (part.codeExecutionResult && isRecord(part.codeExecutionResult)) {
          queue.push(part.codeExecutionResult);
          const output = asNonEmptyString(part.codeExecutionResult.output);
          if (output) queue.push(output);
        }

        if (part.text) queue.push(part.text);
      }
    }

    for (const key of [
      "payload",
      "data",
      "result",
      "output",
      "action",
      "frontend_action",
      "frontendAction",
    ]) {
      if (key in current) queue.push(current[key]);
    }
  }

  return null;
}

function deckFromPayload(payload: unknown): FlashcardDeck | null {
  return normalizeDeck(payload);
}

function getCurrentIndexFromPayload(payload: unknown): number | null {
  if (!isRecord(payload)) return null;
  const rawIndex = getRecordValue<unknown>(payload, [
    "currentIndex",
    "current_index",
    "index",
  ]);

  if (typeof rawIndex === "number" && Number.isFinite(rawIndex)) {
    return Math.max(0, Math.floor(rawIndex));
  }

  return null;
}

function getRevealStateFromPayload(payload: unknown): boolean | null {
  if (!isRecord(payload)) return null;
  const rawReveal = getRecordValue<unknown>(payload, [
    "isAnswerRevealed",
    "is_answer_revealed",
    "revealed",
  ]);

  return typeof rawReveal === "boolean" ? rawReveal : null;
}

export function reduceFlashcardState(
  state: FlashcardState,
  action: FlashcardAction,
): FlashcardState {
  switch (action.type) {
    case "flashcards.create": {
      if (action.status === "failed") return EMPTY_FLASHCARD_STATE;

      const deck = deckFromPayload(action.payload);
      if (!deck) {
        return {
          ...EMPTY_FLASHCARD_STATE,
          status: "creating",
        };
      }

      const lastIndex = deck.cards.length - 1;
      const requestedIndex = getCurrentIndexFromPayload(action.payload) ?? 0;
      const currentIndex = Math.min(Math.max(requestedIndex, 0), lastIndex);

      return {
        status: "active",
        deck,
        currentIndex,
        isAnswerRevealed: getRevealStateFromPayload(action.payload) ?? false,
      };
    }

    case "flashcards.reveal_answer":
      if (!state.deck) return state;
      return {
        ...state,
        isAnswerRevealed: true,
      };

    case "flashcards.next": {
      if (!state.deck) return state;

      const requestedIndex = getCurrentIndexFromPayload(action.payload);
      const maxIndex = state.deck.cards.length - 1;
      const nextIndex =
        requestedIndex != null
          ? Math.min(Math.max(requestedIndex, 0), maxIndex)
          : Math.min(state.currentIndex + 1, maxIndex);

      return {
        ...state,
        currentIndex: nextIndex,
        isAnswerRevealed: false,
      };
    }

    case "flashcards.end":
      return EMPTY_FLASHCARD_STATE;

    default:
      return state;
  }
}
