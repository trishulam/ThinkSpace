import React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useCallback, useMemo, useState } from 'react'
import { useSession } from '../context/SessionContext'
import {
	DefaultSizeStyle,
	ErrorBoundary,
	TLComponents,
	Tldraw,
	TldrawOverlays,
	TldrawUiToastsProvider,
	TLUiOverrides,
} from 'tldraw'
import { TldrawAgentApp } from '../agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
} from '../agent/TldrawAgentAppProvider'
import { ChatPanel } from '../components/ChatPanel'
import { ChatPanelFallback } from '../components/ChatPanelFallback'
import { CustomHelperButtons } from '../components/CustomHelperButtons'
import { AgentViewportBoundsHighlights } from '../components/highlights/AgentViewportBoundsHighlights'
import { AllContextHighlights } from '../components/highlights/ContextHighlights'
import { TargetAreaTool } from '../tools/TargetAreaTool'
import { TargetShapeTool } from '../tools/TargetShapeTool'
import { DynamicIsland } from '../components/DynamicIsland'

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue('s')

// Custom tools for picking context items
const tools = [TargetShapeTool, TargetAreaTool]

// Custom Toolbar component with back button
const CustomToolbar = () => {
  const handleBackToDashboard = () => {
    window.location.href = '/#/dashboard'
  }

  return (
    <div className="tldraw-custom-toolbar">
      <button
        onClick={handleBackToDashboard}
        className="tldraw-back-button"
        title="Back to Dashboard"
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
      </button>
    </div>
  )
}

const overrides: TLUiOverrides = {
  tools: (editor, tools) => {
    return {
      ...tools,
      'target-area': {
        id: 'target-area',
        label: 'Pick Area',
        kbd: 'c',
        icon: 'tool-frame',
        onSelect() {
          editor.setCurrentTool('target-area')
        },
      },
      'target-shape': {
        id: 'target-shape',
        label: 'Pick Shape',
        kbd: 's',
        icon: 'tool-frame',
        onSelect() {
          editor.setCurrentTool('target-shape')
        },
      },
    }
  },
}

export const SessionCanvas: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [app, setApp] = useState<TldrawAgentApp | null>(null)
  
  // AI Voice Agent Connection State
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  
  // Get session data from context
  const { getSession } = useSession()
  const session = sessionId ? getSession(sessionId) : undefined

  const handleUnmount = useCallback(() => {
    setApp(null)
  }, [])

  // AI Voice Agent Connection Handlers
  const handleConnect = useCallback(() => {
    setIsConnecting(true)
    // Simulate connection process
    setTimeout(() => {
      setIsConnected(true)
      setIsConnecting(false)
    }, 2000) // 2 second connection simulation
  }, [])

  const handleDisconnect = useCallback(() => {
    setIsConnecting(true)
    // Simulate disconnection process
    setTimeout(() => {
      setIsConnected(false)
      setIsConnecting(false)
    }, 1000) // 1 second disconnection simulation
  }, [])

  // Custom components to visualize what the agent is doing
  // These use TldrawAgentAppContextProvider to access the app/agent
  const components: TLComponents = useMemo(() => {
    return {
      HelperButtons: () =>
        app && (
          <TldrawAgentAppContextProvider app={app}>
            <CustomHelperButtons />
          </TldrawAgentAppContextProvider>
        ),
      Overlays: () => (
        <>
          <TldrawOverlays />
          {app && (
            <TldrawAgentAppContextProvider app={app}>
              <AgentViewportBoundsHighlights />
              <AllContextHighlights />
            </TldrawAgentAppContextProvider>
          )}
        </>
      ),
    }
  }, [app])

  if (!sessionId) {
    return <div>Session not found</div>
  }

  return (
    <>
      <TldrawUiToastsProvider>
        <div className="tldraw-agent-container">
          <div className="tldraw-canvas">
            <Tldraw
              persistenceKey={`session-${sessionId}`}
              tools={tools}
              overrides={overrides}
              components={components}
            >
              <TldrawAgentAppProvider onMount={setApp} onUnmount={handleUnmount} />
            </Tldraw>
          </div>
          <ErrorBoundary fallback={ChatPanelFallback}>
            {app && (
              <TldrawAgentAppContextProvider app={app}>
                <ChatPanel />
              </TldrawAgentAppContextProvider>
            )}
          </ErrorBoundary>
        </div>
      </TldrawUiToastsProvider>
      
      <CustomToolbar />
      
      {/* Dynamic Island for AI Voice Agent */}
      <DynamicIsland
        isConnected={isConnected}
        isConnecting={isConnecting}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />
    </>
  )
}