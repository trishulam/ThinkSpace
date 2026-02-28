import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { TopNavigation } from '../components/TopNavigation'
import { PageHeader } from '../components/PageHeader'
import { SessionCard } from '../components/SessionCard'
import { EmptyState } from '../components/EmptyState'
import { NewSessionModal } from '../components/NewSessionModal'
import { NewSessionData } from '../types/session'

export const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { sessions, createSession } = useSession()
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Simulate loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 500)

    return () => clearTimeout(timer)
  }, [])

  const handleNewSession = () => {
    setIsNewSessionModalOpen(true)
  }

  const handleCreateSession = (data: NewSessionData) => {
    const newSession = createSession({
      ...data,
      lastActive: new Date(),
      duration: 0
    })
    
    // Navigate directly to the new session
    navigate(`/session/${newSession.id}`)
  }

  const handleResumeSession = (sessionId: string) => {
    navigate(`/session/${sessionId}`)
  }

  const handleReplaySession = (sessionId: string) => {
    navigate(`/session/${sessionId}/replay`)
  }

  if (isLoading) {
    return (
      <div className="mindpad-dashboard">
        <TopNavigation onNewSession={handleNewSession} />
        <div className="mindpad-container">
          <PageHeader 
            title="Your Sessions" 
            subtitle="Continue learning or start a new topic."
          />
          <div className="mindpad-loading-state">
            <div className="mindpad-loading-text">Loading...</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mindpad-dashboard">
      <TopNavigation onNewSession={handleNewSession} />
      
      <div className="mindpad-container">
        <PageHeader 
          title="Your Sessions" 
          subtitle="Continue learning or start a new topic."
        />

        {sessions.length === 0 ? (
          <EmptyState onCreateSession={handleNewSession} />
        ) : (
          <div className="mindpad-sessions-grid">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onResume={handleResumeSession}
                onReplay={handleReplaySession}
              />
            ))}
          </div>
        )}
      </div>

      <NewSessionModal
        isOpen={isNewSessionModalOpen}
        onClose={() => setIsNewSessionModalOpen(false)}
        onCreateSession={handleCreateSession}
      />
    </div>
  )
}