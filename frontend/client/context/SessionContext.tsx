import React, { createContext, useContext, useState, ReactNode } from 'react'
import { Session } from '../types/session'

interface SessionContextType {
  sessions: Session[]
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  getSession: (sessionId: string) => Session | undefined
  updateSession: (sessionId: string, updates: Partial<Session>) => void
  createSession: (sessionData: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => Session
}

const SessionContext = createContext<SessionContextType | undefined>(undefined)

interface SessionProviderProps {
  children: ReactNode
}

// Mock sessions data - in real app this would come from API/database
const initialSessions: Session[] = [
  {
    id: '1',
    topic: 'Backpropagation in Neural Networks',
    goal: 'Understand gradient flow intuitively',
    mode: 'guided',
    level: 'intermediate',
    lastActive: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    duration: 48,
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000)
  },
  {
    id: '2',
    topic: 'React State Management Patterns',
    goal: 'Master advanced state patterns and best practices',
    mode: 'socratic',
    level: 'advanced',
    lastActive: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    duration: 72,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
  },
  {
    id: '3',
    topic: 'Quantum Computing Basics',
    mode: 'challenge',
    level: 'beginner',
    lastActive: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 1 week ago
    duration: 35,
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
    updatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  }
]

export const SessionProvider: React.FC<SessionProviderProps> = ({ children }) => {
  const [sessions, setSessions] = useState<Session[]>(initialSessions)

  const getSession = (sessionId: string): Session | undefined => {
    return sessions.find(session => session.id === sessionId)
  }

  const updateSession = (sessionId: string, updates: Partial<Session>) => {
    setSessions(prev => prev.map(session => 
      session.id === sessionId 
        ? { ...session, ...updates, updatedAt: new Date() }
        : session
    ))
  }

  const createSession = (sessionData: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Session => {
    const newSession: Session = {
      ...sessionData,
      id: Date.now().toString(),
      createdAt: new Date(),
      updatedAt: new Date()
    }
    
    setSessions(prev => [newSession, ...prev])
    return newSession
  }

  const value: SessionContextType = {
    sessions,
    setSessions,
    getSession,
    updateSession,
    createSession
  }

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