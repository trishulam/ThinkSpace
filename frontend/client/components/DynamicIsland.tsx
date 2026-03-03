import React from 'react'
import type { ConnectionState, TalkingState } from '../types/agent-live'

interface DynamicIslandProps {
  connectionState: ConnectionState
  talkingState: TalkingState
}

export const DynamicIsland: React.FC<DynamicIslandProps> = ({
  connectionState,
  talkingState,
}) => {
  const getIslandContent = () => {
    switch (connectionState) {
      case 'connecting':
        return (
          <div className="dynamic-island-content connecting">
            <div className="connection-dot disconnecting"></div>
          </div>
        )
      case 'connected':
        return (
          <div className="dynamic-island-content connected">
            <div className={`voice-visualizer ${talkingState}`}>
              {talkingState === 'thinking' ? (
                <>
                  <div className="thinking-dot"></div>
                  <div className="thinking-dot"></div>
                  <div className="thinking-dot"></div>
                </>
              ) : (
                <>
                  <div className="voice-bar user-bar"></div>
                  <div className="voice-bar user-bar"></div>
                  <div className="voice-bar user-bar"></div>
                  <div className="voice-bar user-bar"></div>
                  <div className="voice-bar center-bar"></div>
                  <div className="voice-bar center-bar"></div>
                  <div className="voice-bar agent-bar"></div>
                  <div className="voice-bar agent-bar"></div>
                  <div className="voice-bar agent-bar"></div>
                  <div className="voice-bar agent-bar"></div>
                </>
              )}
            </div>
            <div className="connection-dot connected"></div>
          </div>
        )
      case 'disconnecting':
        return (
          <div className="dynamic-island-content disconnecting">
            <div className="connection-dot disconnecting"></div>
          </div>
        )
      default:
        return (
          <div className="dynamic-island-content idle">
            <div className="connection-dot idle"></div>
          </div>
        )
    }
  }

  return (
    <div className={`dynamic-island ${connectionState}`}>
      {getIslandContent()}
    </div>
  )
}
