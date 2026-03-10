export type FlashcardStatus = "idle" | "creating" | "active";

export type FlashcardActionType =
  | "flashcards.begin"
  | "flashcards.show"
  | "flashcards.next"
  | "flashcards.reveal_answer"
  | "flashcards.clear";

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
  jobId: string | null;
}

export interface FlashcardAction {
  type: FlashcardActionType;
  status?: string;
  requestId?: string;
  jobId?: string;
  payload?: unknown;
}

export interface FlashcardActionApplicationResult {
  nextState: FlashcardState;
  applied: boolean;
  summary: string;
}

export const EMPTY_FLASHCARD_STATE: FlashcardState = {
  status: "idle",
  deck: null,
  currentIndex: 0,
  isAnswerRevealed: false,
  jobId: null,
};

const FLASHCARD_ACTION_TYPES = new Set<FlashcardActionType>([
  "flashcards.begin",
  "flashcards.show",
  "flashcards.next",
  "flashcards.reveal_answer",
  "flashcards.clear",
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
    case "flashcards.begin":
      return {
        ...EMPTY_FLASHCARD_STATE,
        status: "creating",
        jobId: action.jobId ?? state.jobId,
      };

    case "flashcards.show": {
      if (action.status === "failed") return EMPTY_FLASHCARD_STATE;

      const deck = deckFromPayload(action.payload);
      if (!deck) {
        return state;
      }

      const lastIndex = deck.cards.length - 1;
      const requestedIndex = getCurrentIndexFromPayload(action.payload) ?? 0;
      const currentIndex = Math.min(Math.max(requestedIndex, 0), lastIndex);

      return {
        status: "active",
        deck,
        currentIndex,
        isAnswerRevealed: getRevealStateFromPayload(action.payload) ?? false,
        jobId: action.jobId ?? state.jobId,
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

    case "flashcards.clear":
      return EMPTY_FLASHCARD_STATE;

    default:
      return state;
  }
}

export function applyFlashcardAction(
  state: FlashcardState,
  action: FlashcardAction,
): FlashcardActionApplicationResult {
  if (!FLASHCARD_ACTION_TYPES.has(action.type)) {
    return {
      nextState: state,
      applied: false,
      summary: `Unsupported flashcard action: ${action.type}`,
    };
  }

  if (action.type === "flashcards.begin") {
    if (
      state.status === "active" &&
      state.jobId != null &&
      action.jobId != null &&
      state.jobId === action.jobId
    ) {
      return {
        nextState: state,
        applied: false,
        summary: "Ignored stale flashcard loading action",
      };
    }

    if (
      state.status === "creating" &&
      state.jobId != null &&
      action.jobId != null &&
      state.jobId === action.jobId
    ) {
      return {
        nextState: state,
        applied: false,
        summary: "Flashcards are already entering the creating state",
      };
    }

    return {
      nextState: reduceFlashcardState(state, action),
      applied: true,
      summary: "Entered flashcard creating state",
    };
  }

  if (action.type === "flashcards.show") {
    if (
      state.status === "active" &&
      state.jobId != null &&
      action.jobId != null &&
      state.jobId === action.jobId
    ) {
      const incomingDeck = deckFromPayload(action.payload);
      if (!incomingDeck) {
        return {
          nextState: state,
          applied: false,
          summary: "Ignored stale flashcard loading action",
        };
      }
    }

    const nextState = reduceFlashcardState(state, action);
    if (action.status === "failed") {
      return {
        nextState,
        applied: true,
        summary: "Cleared flashcards after failed show action",
      };
    }

    const deck = deckFromPayload(action.payload);
    if (!deck) {
      return {
        nextState: state,
        applied: false,
        summary: "Flashcard deck payload was missing from flashcards.show",
      };
    }
    return {
      nextState,
      applied: true,
      summary: `Displayed flashcard deck with ${deck.cards.length} cards`,
    };
  }

  if (action.type === "flashcards.next") {
    if (!state.deck) {
      return {
        nextState: state,
        applied: false,
        summary: "Cannot advance flashcards without an active deck",
      };
    }

    const nextState = reduceFlashcardState(state, action);
    if (nextState.currentIndex === state.currentIndex) {
      return {
        nextState,
        applied: false,
        summary: "Already at the last flashcard",
      };
    }

    return {
      nextState,
      applied: true,
      summary: `Advanced to flashcard ${nextState.currentIndex + 1}`,
    };
  }

  if (action.type === "flashcards.reveal_answer") {
    if (!state.deck) {
      return {
        nextState: state,
        applied: false,
        summary: "Cannot reveal an answer without an active deck",
      };
    }
    if (state.isAnswerRevealed) {
      return {
        nextState: state,
        applied: false,
        summary: "Flashcard answer is already revealed",
      };
    }

    return {
      nextState: reduceFlashcardState(state, action),
      applied: true,
      summary: "Revealed the current flashcard answer",
    };
  }

  if (action.type === "flashcards.clear") {
    if (state.status === "idle") {
      return {
        nextState: state,
        applied: false,
        summary: "No active flashcards to clear",
      };
    }

    return {
      nextState: reduceFlashcardState(state, action),
      applied: true,
      summary: "Cleared the active flashcard session",
    };
  }

  return {
    nextState: state,
    applied: false,
    summary: `Unsupported flashcard action: ${action.type}`,
  };
}
