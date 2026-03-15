import type { SessionPersonaId } from "../types/session";

export type SessionPersonaOption = {
  id: SessionPersonaId;
  label: string;
  helper: string;
  voiceLabel: string;
};

export const DEFAULT_SESSION_PERSONA: SessionPersonaId = "professor";

export const SESSION_PERSONAS: SessionPersonaOption[] = [
  {
    id: "professor",
    label: "Professor",
    helper: "Warm, scholarly, and structured.",
    voiceLabel: "Sadaltager",
  },
  {
    id: "coach",
    label: "Coach",
    helper: "Encouraging, practical, and momentum-oriented.",
    voiceLabel: "Sulafat",
  },
  {
    id: "challenger",
    label: "Challenger",
    helper: "Rigorous, probing, and intellectually demanding.",
    voiceLabel: "Kore",
  },
];

export function isSessionPersonaId(value: string | null | undefined): value is SessionPersonaId {
  return SESSION_PERSONAS.some((persona) => persona.id === value);
}

export function getSessionPersonaOption(personaId: SessionPersonaId): SessionPersonaOption {
  return SESSION_PERSONAS.find((persona) => persona.id === personaId) ?? SESSION_PERSONAS[0];
}
