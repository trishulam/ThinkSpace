import React from 'react'
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { SessionProvider } from './context/SessionContext'
import { Dashboard } from './pages/Dashboard'
import { SessionCanvas } from './pages/SessionCanvas'
import { SessionReplay } from './pages/SessionReplay'
import { WidgetPlayground } from './pages/WidgetPlayground'

export const MindPadApp: React.FC = () => {
  return (
    <SessionProvider>
      <Router>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/session/:sessionId" element={<SessionCanvas />} />
          <Route path="/session/:sessionId/session-summary" element={<SessionReplay />} />
          <Route path="/dev/widgets" element={<WidgetPlayground />} />
          <Route path="/canvas" element={<Navigate to="/dashboard" replace />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Router>
    </SessionProvider>
  )
}