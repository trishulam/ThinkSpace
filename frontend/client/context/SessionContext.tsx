import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { createSession as createSessionRequest, listSessions } from "../api/sessions";
import { NewSessionData, Session } from "../types/session";

interface SessionContextType {
  sessions: Session[];
  isLoading: boolean;
  error: string | null;
  refreshSessions: () => Promise<void>;
  getSession: (sessionId: string) => Session | undefined;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  createSession: (sessionData: NewSessionData) => Promise<Session>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

interface SessionProviderProps {
  children: ReactNode;
}

const DEMO_USER_ID = "demo-user";

export const SessionProvider: React.FC<SessionProviderProps> = ({ children }) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextSessions = await listSessions(DEMO_USER_ID);
      setSessions(nextSessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load sessions");
    } finally {
      setIsLoading(false);
    }
  }, []);

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
      setSessions((previous) => [createdSession, ...previous]);
      setError(null);
      return createdSession;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create session");
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
    }),
    [
      sessions,
      isLoading,
      error,
      refreshSessions,
      getSession,
      updateSession,
      createSession,
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