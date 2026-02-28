import React from 'react'
import { useParams, Link } from 'react-router-dom'

// Placeholder for SessionReplay component - will be implemented according to your replay page spec
export const SessionReplay: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>()

  if (!sessionId) {
    return <div>Session not found</div>
  }

  return (
    <div className="mindpad-dashboard">
      <div className="mindpad-nav">
        <Link to="/dashboard" className="mindpad-nav-logo">
          <svg className="mindpad-icon-lg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 4L13 5V7C13 8.66 14.34 10 16 10H21ZM7 14C7 15.66 8.34 17 10 17H14C15.66 17 17 15.66 17 14V12H7V14ZM3 14V16C3 17.66 4.34 19 6 19H18C19.66 19 21 17.66 21 16V14C21 12.34 19.66 11 18 11H6C4.34 11 3 12.34 3 14Z"/>
          </svg>
          <span>MindPad</span>
        </Link>
        
        <Link to={`/session/${sessionId}`} className="mindpad-btn-ghost">
          Open Session
        </Link>
      </div>

      <div className="mindpad-container">
        <div className="mindpad-page-header">
          <h1 className="mindpad-page-title">Session Replay</h1>
          <p className="mindpad-page-subtitle">Review your learning session</p>
        </div>

        <div className="mindpad-empty-state">
          <svg className="mindpad-empty-state-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
          </svg>
          <h3 className="mindpad-empty-state-title">Replay functionality coming soon</h3>
          <p className="mindpad-empty-state-subtitle">
            This will show the session playback with keypoints, timeline, and transcript.
          </p>
          
          <Link to={`/session/${sessionId}`} className="mindpad-btn-primary">
            <svg className="mindpad-icon-sm" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
            Back to Session
          </Link>
        </div>
      </div>
    </div>
  )
}