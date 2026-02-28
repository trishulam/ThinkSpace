import React, { useState, useEffect } from 'react'

interface DynamicIslandProps {
  isConnected: boolean
  isConnecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting'
type TalkingState = 'none' | 'agent' | 'user' | 'thinking'

export const DynamicIsland: React.FC<DynamicIslandProps> = ({
  isConnected,
  isConnecting,
  onConnect,
  onDisconnect,
}) => {
  const [state, setState] = useState<ConnectionState>('idle')
  const [talkingState, setTalkingState] = useState<TalkingState>('none')
  const [showTestButtons, setShowTestButtons] = useState(true)
  const [showFlashcard, setShowFlashcard] = useState(false)
  const [flashcardAnimating, setFlashcardAnimating] = useState(false)

  useEffect(() => {
    if (isConnecting) {
      setState('connecting')
    } else if (isConnected) {
      setState('connected')
    } else {
      setState('idle')
    }
  }, [isConnected, isConnecting])

  // Simulate talking states for demonstration
  useEffect(() => {
    if (state === 'connected') {
      const interval = setInterval(() => {
        const random = Math.random()
        if (random < 0.25) {
          setTalkingState('thinking')
        } else if (random < 0.5) {
          setTalkingState('agent')
        } else if (random < 0.75) {
          setTalkingState('user')
        } else {
          setTalkingState('none')
        }
      }, 3000) // Change talking state every 3 seconds

      return () => clearInterval(interval)
    } else {
      setTalkingState('none')
    }
  }, [state])

  const getIslandContent = () => {
    switch (state) {
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

  const handleConnect = () => {
    setState('connecting')
    onConnect()
  }

  const handleDisconnect = () => {
    setState('disconnecting')
    onDisconnect()
  }

  const handleThinking = () => {
    setTalkingState('thinking')
    // Auto-reset after 3 seconds
    setTimeout(() => {
      setTalkingState('none')
    }, 3000)
  }

  const handleFlashcard = () => {
    if (!isConnected) return
    
    setFlashcardAnimating(true)
    // Start animation from island
    setTimeout(() => {
      setShowFlashcard(true)
      setFlashcardAnimating(false)
    }, 1000) // Animation duration
    
    // Auto-hide after 6 seconds
    setTimeout(() => {
      setShowFlashcard(false)
    }, 7000)
  }

  return (
    <>
      {/* Dynamic Island */}
      <div className={`dynamic-island ${state}`}>
        {getIslandContent()}
      </div>

      {/* Animated Flashcard */}
      {(showFlashcard || flashcardAnimating) && (
        <div className={`flashcard-container ${flashcardAnimating ? 'animating' : 'visible'}`}>
          <div className="flashcard">
            <div className="flashcard-header">
              <div className="flashcard-icon">🧠</div>
              <div className="flashcard-title">AI Knowledge Card</div>
            </div>
            <div className="flashcard-content">
              <h3>Machine Learning Fundamentals</h3>
              <p>Neural networks are computational models inspired by biological neural networks. They consist of interconnected nodes (neurons) that process and transmit information.</p>
              <div className="flashcard-tags">
                <span className="tag">AI</span>
                <span className="tag">Machine Learning</span>
                <span className="tag">Neural Networks</span>
              </div>
            </div>
            <div className="flashcard-footer">
              <button className="flashcard-action">Learn More</button>
              <button className="flashcard-dismiss" onClick={() => setShowFlashcard(false)}>×</button>
            </div>
          </div>
        </div>
      )}

      {/* Test Controls */}
      {showTestButtons && (
        <div className="dynamic-island-controls">
          <div className="control-group">
            <button
              onClick={handleConnect}
              disabled={isConnected || isConnecting}
              className="test-btn connect-btn"
            >
              Connect
            </button>
            <button
              onClick={handleDisconnect}
              disabled={!isConnected || isConnecting}
              className="test-btn disconnect-btn"
            >
              Disconnect
            </button>
            <button
              onClick={handleThinking}
              disabled={!isConnected || isConnecting}
              className="test-btn thinking-btn"
            >
              AI Thinking
            </button>
            <button
              onClick={handleFlashcard}
              disabled={!isConnected || isConnecting}
              className="test-btn flashcard-btn"
            >
              Send Flashcard
            </button>
            <button
              onClick={() => setShowTestButtons(false)}
              className="test-btn hide-btn"
            >
              Hide Controls
            </button>
          </div>
        </div>
      )}

      {/* Hidden state toggle */}
      {!showTestButtons && (
        <div className="show-controls-hint" onClick={() => setShowTestButtons(true)}>
          <span>Show Test Controls</span>
        </div>
      )}
    </>
  )
}