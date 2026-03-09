import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { TopNavigation } from "../components/TopNavigation";
import { SessionCard } from "../components/SessionCard";
import { EmptyState } from "../components/EmptyState";
import { NewSessionModal } from "../components/NewSessionModal";
import { NewSessionData } from "../types/session";

/* Skeleton rows shown during loading */
const SkeletonRows: React.FC = () => (
  <div className="ts-session-list">
    {[1, 2, 3].map((i) => (
      <div key={i} className="ts-skeleton-row" style={{ position: "relative" }}>
        <div className="ts-skeleton-icon" />
        <div className="ts-skeleton-body">
          <div
            className="ts-skeleton-line ts-skeleton-line--wide"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
          <div
            className="ts-skeleton-line ts-skeleton-line--narrow"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        </div>
      </div>
    ))}
  </div>
);

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { sessions, createSession } = useSession();
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 480);
    return () => clearTimeout(timer);
  }, []);

  const handleNewSession = () => setIsNewSessionModalOpen(true);

  const handleCreateSession = (data: NewSessionData) => {
    const newSession = createSession({
      ...data,
      lastActive: new Date(),
      duration: 0,
    });
    navigate(`/session/${newSession.id}`);
  };

  const handleResumeSession = (sessionId: string) =>
    navigate(`/session/${sessionId}`);
  const handleReplaySession = (sessionId: string) =>
    navigate(`/session/${sessionId}/replay`);

  return (
    <div className="mindpad-dashboard">
      <TopNavigation onNewSession={handleNewSession} />

      <div className="ts-dashboard-body">
        {/* Section header */}
        <div className="ts-section-header">
          <h2 className="ts-section-title">Sessions</h2>
          {!isLoading && sessions.length > 0 && (
            <span className="ts-section-count">{sessions.length}</span>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <SkeletonRows />
        ) : sessions.length === 0 ? (
          <EmptyState onCreateSession={handleNewSession} />
        ) : (
          <div className="ts-session-list">
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
  );
};
