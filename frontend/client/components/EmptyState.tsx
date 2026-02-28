import React from 'react'

interface EmptyStateProps {
  onCreateSession: () => void
}

const NotebookIcon: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM7 7H17V9H7V7ZM7 11H17V13H7V11ZM7 15H14V17H7V15Z"/>
  </svg>
)

const PlusIcon: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
  </svg>
)

export const EmptyState: React.FC<EmptyStateProps> = ({ onCreateSession }) => {
  return (
    <div className="mindpad-empty-state">
      <NotebookIcon className="mindpad-empty-state-icon" />
      <h3 className="mindpad-empty-state-title">No sessions yet.</h3>
      <p className="mindpad-empty-state-subtitle">Start your first learning session.</p>
      
      <button 
        className="mindpad-btn-primary"
        onClick={onCreateSession}
        type="button"
      >
        <PlusIcon className="mindpad-icon-sm" />
        Create Session
      </button>
    </div>
  )
}