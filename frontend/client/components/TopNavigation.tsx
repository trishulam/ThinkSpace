import React from "react";
import { Link } from "react-router-dom";

interface TopNavigationProps {
  onPrimaryAction: () => void;
  primaryActionLabel?: string;
  pageTitle?: string;
  pageSubtitle?: string;
  showSearch?: boolean;
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
}

const LogoMark: React.FC = () => (
  <div className="ts-home-nav-logo-mark">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 6.25C6.37 7.37 5.25 9.24 5.25 11.38c0 3.47 3 6.28 6.75 6.28s6.75-2.81 6.75-6.28c0-2.14-1.12-4.01-2.75-5.13" />
      <path d="M9 5.5c.72-.83 1.79-1.25 3-1.25s2.28.42 3 1.25" />
      <path d="M9.75 11.25h4.5" />
      <path d="M12 9v4.5" />
    </svg>
  </div>
);

const PlusIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
  </svg>
);

const SearchIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

const UserIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 12a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z" />
    <path d="M5 20.25a7 7 0 0 1 14 0" />
  </svg>
);

export const TopNavigation: React.FC<TopNavigationProps> = ({
  onPrimaryAction,
  primaryActionLabel = "New Session",
  pageTitle = "Sessions",
  pageSubtitle = "Learn deeply, revisit ideas, and master topics.",
  showSearch = true,
  searchQuery = "",
  onSearchChange,
}) => {
  return (
    <nav className={showSearch ? "ts-home-nav" : "ts-home-nav ts-home-nav--no-search"}>
      <div className="ts-home-nav-brand">
        <Link to="/dashboard" className="ts-home-nav-logo">
          <LogoMark />
          <span>ThinkSpace</span>
        </Link>
        <div className="ts-home-nav-copy">
          <p className="ts-home-nav-title">{pageTitle}</p>
          <p className="ts-home-nav-subtitle">{pageSubtitle}</p>
        </div>
      </div>

      {showSearch ? (
        <label className="ts-home-nav-search" aria-label="Search sessions">
          <span className="ts-home-nav-search-icon">
            <SearchIcon />
          </span>
          <input
            type="search"
            placeholder="Search sessions, summaries, or study materials..."
            value={searchQuery}
            onChange={(event) => onSearchChange?.(event.target.value)}
          />
        </label>
      ) : (
        <div className="ts-home-nav-spacer" aria-hidden="true" />
      )}

      <div className="ts-home-nav-actions">
        <button className="ts-home-primary-btn" onClick={onPrimaryAction} type="button">
          <PlusIcon />
          {primaryActionLabel}
        </button>
        <button className="ts-home-avatar" type="button" aria-label="Open profile">
          <UserIcon />
        </button>
      </div>
    </nav>
  );
};
