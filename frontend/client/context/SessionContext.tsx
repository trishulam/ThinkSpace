import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import {
  completeSession as completeSessionRequest,
  createSession as createSessionRequest,
  listSessions,
} from "../api/sessions";
import { NewSessionData, Session } from "../types/session";
import { DEFAULT_SESSION_PERSONA } from "../config/personas";

interface SessionContextType {
  sessions: Session[];
  isLoading: boolean;
  error: string | null;
  refreshSessions: () => Promise<void>;
  getSession: (sessionId: string) => Session | undefined;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  createSession: (sessionData: NewSessionData) => Promise<Session>;
  completeSession: (sessionId: string) => Promise<Session>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

interface SessionProviderProps {
  children: ReactNode;
}

const DEMO_USER_ID = "demo-user";
const SESSION_CACHE_KEY = "thinkspace:session-cache";

let cachedSessionsMemory: Session[] | null = null;
let sessionsRequestPromise: Promise<Session[]> | null = null;

type StoredSession = Omit<Session, "lastActive" | "createdAt" | "updatedAt" | "persona"> & {
  persona?: Session["persona"];
  lastActive: string;
  createdAt: string;
  updatedAt: string;
};

const hydrateStoredSession = (session: StoredSession): Session => ({
  ...session,
  persona: session.persona ?? DEFAULT_SESSION_PERSONA,
  lastActive: new Date(session.lastActive),
  createdAt: new Date(session.createdAt),
  updatedAt: new Date(session.updatedAt),
});

const readCachedSessions = (): Session[] => {
  if (cachedSessionsMemory) {
    return cachedSessionsMemory;
  }

  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) {
      return [];
    }

    const storedSessions = JSON.parse(raw) as StoredSession[];
    cachedSessionsMemory = storedSessions.map(hydrateStoredSession);
    return cachedSessionsMemory;
  } catch {
    return [];
  }
};

const persistCachedSessions = (sessions: Session[]): void => {
  cachedSessionsMemory = sessions;

  if (typeof window === "undefined") {
    return;
  }

  try {
    const storedSessions: StoredSession[] = sessions.map((session) => ({
      ...session,
      lastActive: session.lastActive.toISOString(),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    }));

    window.localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(storedSessions));
  } catch {
    // Ignore cache persistence failures and keep using in-memory state.
  }
};

export const SessionProvider: React.FC<SessionProviderProps> = ({ children }) => {
  const [sessions, setSessions] = useState<Session[]>(() => readCachedSessions());
  const [isLoading, setIsLoading] = useState(() => readCachedSessions().length === 0);
  const [error, setError] = useState<string | null>(null);

  const refreshSessions = useCallback(async () => {
    if (sessions.length === 0) {
      setIsLoading(true);
    }

    const request = sessionsRequestPromise ?? listSessions(DEMO_USER_ID);
    sessionsRequestPromise = request;

    try {
      const nextSessions = await request;
      persistCachedSessions(nextSessions);
      setSessions(nextSessions);
      setError(null);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load sessions");
    } finally {
      if (sessionsRequestPromise === request) {
        sessionsRequestPromise = null;
      }
      setIsLoading(false);
    }
  }, [sessions.length]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const getSession = useCallback(
    (sessionId: string): Session | undefined => {
      return sessions.find((session) => session.id === sessionId);
    },
    [sessions]
  );

  const updateSession = useCallback((sessionId: string, updates: Partial<Session>) => {
    setSessions((previous) =>
      previous.map((session) =>
        session.id === sessionId
          ? { ...session, ...updates, updatedAt: new Date() }
          : session
      )
    );
  }, []);

  const createSession = useCallback(async (sessionData: NewSessionData) => {
    try {
      const createdSession = await createSessionRequest({
        ...sessionData,
        userId: DEMO_USER_ID,
      });
      setSessions((previous) => {
        const nextSessions = [createdSession, ...previous];
        persistCachedSessions(nextSessions);
        return nextSessions;
      });
      setError(null);
      return createdSession;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create session");
      throw err;
    }
  }, []);

  const completeSession = useCallback(async (sessionId: string) => {
    try {
      const completedSession = await completeSessionRequest(sessionId);
      setSessions((previous) => {
        const nextSessions = previous.map((session) =>
          session.id === sessionId ? completedSession : session
        );
        persistCachedSessions(nextSessions);
        return nextSessions;
      });
      setError(null);
      return completedSession;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete session");
      throw err;
    }
  }, []);

  const value = useMemo<SessionContextType>(
    () => ({
      sessions,
      isLoading,
      error,
      refreshSessions,
      getSession,
      updateSession,
      createSession,
      completeSession,
    }),
    [
      sessions,
      isLoading,
      error,
      refreshSessions,
      getSession,
      updateSession,
      createSession,
      completeSession,
    ]
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  )
}

export const useSession = (): SessionContextType => {
  const context = useContext(SessionContext)
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}

export const useSessionById = (sessionId: string): Session | undefined => {
  const { getSession } = useSession()
  return getSession(sessionId)
}