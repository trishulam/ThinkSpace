import { useEffect, useRef, useState } from "react";
import type { FlashcardState } from "../flashcards";

interface FlashcardPanelProps {
  state: FlashcardState;
}

interface FlashcardCardSnapshot {
  id: string;
  title: string;
  cardNumber: number;
  totalCards: number;
  front: string;
  back: string;
  isAnswerRevealed: boolean;
}

export function FlashcardPanel({ state }: FlashcardPanelProps) {
  const previousIndexRef = useRef<number | null>(null);
  const previousStatusRef = useRef(state.status);
  const currentCardRef = useRef<FlashcardCardSnapshot | null>(null);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cardMotionClass, setCardMotionClass] = useState("");
  const [entryMotionClass, setEntryMotionClass] = useState("");
  const [outgoingCard, setOutgoingCard] = useState<FlashcardCardSnapshot | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (animationTimerRef.current) {
        clearTimeout(animationTimerRef.current);
      }
      if (entryTimerRef.current) {
        clearTimeout(entryTimerRef.current);
      }
    };
  }, []);

  const deck = state.deck;
  const card =
    state.status === "active" && deck?.cards.length
      ? deck.cards[state.currentIndex] ?? deck.cards[0]
      : null;
  const currentCard: FlashcardCardSnapshot | null =
    state.status === "active" && deck && card
      ? {
          id: card.id,
          title: deck.title?.trim() || "Flashcards",
          cardNumber: state.currentIndex + 1,
          totalCards: deck.cards.length,
          front: card.front,
          back: card.back,
          isAnswerRevealed: state.isAnswerRevealed,
        }
      : null;

  useEffect(() => {
    if (state.status !== "active" || !currentCard) {
      previousIndexRef.current = null;
      currentCardRef.current = null;
      setCardMotionClass("");
      setEntryMotionClass("");
      setOutgoingCard(null);
      previousStatusRef.current = state.status;
      return;
    }

    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = state.status;

    if (previousStatus === "creating") {
      setEntryMotionClass(" is-materializing");
      if (entryTimerRef.current) {
        clearTimeout(entryTimerRef.current);
      }
      entryTimerRef.current = setTimeout(() => {
        setEntryMotionClass("");
        entryTimerRef.current = null;
      }, 620);
    }

    const previousIndex = previousIndexRef.current;
    const previousCard = currentCardRef.current;

    if (
      previousIndex != null &&
      previousIndex !== state.currentIndex &&
      previousCard != null
    ) {
      setOutgoingCard(previousCard);
      setCardMotionClass(" is-advancing");

      if (animationTimerRef.current) {
        clearTimeout(animationTimerRef.current);
      }

      animationTimerRef.current = setTimeout(() => {
        setOutgoingCard(null);
        setCardMotionClass("");
        animationTimerRef.current = null;
      }, 480);
    }

    previousIndexRef.current = state.currentIndex;
    currentCardRef.current = currentCard;
  }, [currentCard, state.currentIndex, state.status]);

  const renderCardFace = (
    snapshot: FlashcardCardSnapshot,
    kind: "current" | "outgoing",
  ) => {
    const frontStateClass = snapshot.isAnswerRevealed
      ? " is-hidden-face"
      : " is-active-face";
    const backStateClass = snapshot.isAnswerRevealed
      ? " is-active-face"
      : " is-hidden-face";

    return (
      <div
        className={`flashcard-panel-card flashcard-panel-card--${kind}${
          snapshot.isAnswerRevealed ? " is-revealed" : ""
        }`}
        aria-hidden={kind === "outgoing"}
      >
        <article
          className={`flashcard-panel-face flashcard-panel-face--front${frontStateClass}`}
        >
          <div className="flashcard-panel-meta">
            <span className="flashcard-panel-face-label">{snapshot.title}</span>
            <span className="flashcard-panel-face-count">
              {snapshot.cardNumber} / {snapshot.totalCards}
            </span>
          </div>
          <p className="flashcard-panel-face-copy">{snapshot.front}</p>
          <div className="flashcard-panel-face-hint">Answer hidden</div>
        </article>

        <article
          className={`flashcard-panel-face flashcard-panel-face--back${backStateClass}`}
        >
          <div className="flashcard-panel-meta">
            <span className="flashcard-panel-face-label">{snapshot.title}</span>
            <span className="flashcard-panel-face-count">
              {snapshot.cardNumber} / {snapshot.totalCards}
            </span>
          </div>
          <p className="flashcard-panel-face-copy">{snapshot.back}</p>
          <div className="flashcard-panel-face-hint">Revealed</div>
        </article>
      </div>
    );
  };

  if (state.status === "idle") return null;

  if (state.status === "creating") {
    return (
      <aside className="flashcard-panel-overlay" aria-live="polite">
        <div className="flashcard-loading-card">
          <div className="flashcard-loading-spinner" aria-hidden="true" />
          <div className="flashcard-loading-copy">Creating flashcards...</div>
          <div className="flashcard-loading-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </aside>
    );
  }

  if (!currentCard) return null;

  return (
    <aside className="flashcard-panel-overlay" aria-live="polite">
      <div className="flashcard-panel-scene">
        <div
          key={card.id}
          className={`flashcard-panel-card-shell${entryMotionClass}${cardMotionClass}`}
        >
          {outgoingCard ? renderCardFace(outgoingCard, "outgoing") : null}
          {renderCardFace(currentCard, "current")}
        </div>
      </div>
    </aside>
  );
}
