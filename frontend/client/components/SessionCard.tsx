import React from 'react'
import { Session } from '../types/session'

interface SessionCardProps {
  session: Session
  onResume: (sessionId: string) => void
  onReplay: (sessionId: string) => void
}

const PlayIcon: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z"/>
  </svg>
)

const ReplayIcon: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
  </svg>
)

const formatLastActive = (date: Date): string => {
  const now = new Date()
  const diffInMilliseconds = now.getTime() - date.getTime()
  const diffInMinutes = Math.floor(diffInMilliseconds / (1000 * 60))
  const diffInHours = Math.floor(diffInMinutes / 60)
  const diffInDays = Math.floor(diffInHours / 24)

  if (diffInMinutes < 60) {
    return `${diffInMinutes} min ago`
  } else if (diffInHours < 24) {
    return `${diffInHours}h ago`
  } else if (diffInDays < 7) {
    return `${diffInDays}d ago`
  } else {
    return date.toLocaleDateString()
  }
}

const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  
  if (hours > 0) {
    return `${hours}h ${mins}m`
  }
  return `${mins}m`
}

export const SessionCard: React.FC<SessionCardProps> = ({
  session,
  onResume,
  onReplay
}) => {
  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation()
    onResume(session.id)
  }

  const handleReplay = (e: React.MouseEvent) => {
    e.stopPropagation()
    onReplay(session.id)
  }

  return (
    <div className="mindpad-session-card">
      <div className="mindpad-session-card-content">
        <div className="mindpad-session-card-header">
          <h3 className="mindpad-session-card-title">{session.topic}</h3>
          {session.goal && (
            <p className="mindpad-session-card-goal">{session.goal}</p>
          )}
        </div>

        <div className="mindpad-session-card-meta">
          <span>Last active: {formatLastActive(session.lastActive)}</span>
          <span>Duration: {formatDuration(session.duration)}</span>
        </div>

        <div className="mindpad-session-card-actions">
          <button
            className="mindpad-btn-ghost mindpad-session-card-btn"
            onClick={handleReplay}
            type="button"
          >
            <ReplayIcon className="mindpad-icon-xs" />
            Replay
          </button>
          
          <button
            className="mindpad-btn-primary mindpad-session-card-btn"
            onClick={handleResume}
            type="button"
          >
            <PlayIcon className="mindpad-icon-xs" />
            Resume
          </button>
        </div>
      </div>
    </div>
  )
}