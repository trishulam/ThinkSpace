import React from "react";
import { Link } from "react-router-dom";

interface TopNavigationProps {
  onNewSession: () => void;
}

const LogoMark: React.FC = () => (
  <div className="mindpad-nav-logo-mark">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
      <path d="M8 12h8M12 8v8" />
    </svg>
  </div>
);

const PlusIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
  </svg>
);

export const TopNavigation: React.FC<TopNavigationProps> = ({
  onNewSession,
}) => {
  return (
    <nav className="mindpad-nav">
      <Link to="/dashboard" className="mindpad-nav-logo">
        <LogoMark />
        <span>ThinkSpace</span>
      </Link>

      <button
        className="mindpad-btn-primary"
        onClick={onNewSession}
        type="button"
      >
        <PlusIcon />
        New Session
      </button>
    </nav>
  );
};
