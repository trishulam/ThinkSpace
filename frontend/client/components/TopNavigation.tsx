import React from 'react'
import { Link } from 'react-router-dom'

interface TopNavigationProps {
  onNewSession: () => void
}

const BrainIcon: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 4L13 5V7C13 8.66 14.34 10 16 10H21ZM7 14C7 15.66 8.34 17 10 17H14C15.66 17 17 15.66 17 14V12H7V14ZM3 14V16C3 17.66 4.34 19 6 19H18C19.66 19 21 17.66 21 16V14C21 12.34 19.66 11 18 11H6C4.34 11 3 12.34 3 14Z"/>
  </svg>
)

const PlusIcon: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
  </svg>
)

export const TopNavigation: React.FC<TopNavigationProps> = ({ onNewSession }) => {
  return (
    <nav className="mindpad-nav">
      <Link to="/dashboard" className="mindpad-nav-logo">
        <BrainIcon />
        <span>MindPad</span>
      </Link>
      
      <button 
        className="mindpad-btn-primary"
        onClick={onNewSession}
        type="button"
      >
        <PlusIcon className="mindpad-icon-sm" />
        New Session
      </button>
    </nav>
  )
}