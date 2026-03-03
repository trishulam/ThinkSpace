import React from 'react'
import { useParams } from 'react-router-dom'
import { useCallback, useMemo, useState } from 'react'
// import { useSession } from '../context/SessionContext'
import {
	DefaultSizeStyle,
	// ErrorBoundary,
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
// Chat panel replaced by AgentSidebar
// import { ChatPanel } from '../components/ChatPanel'
// import { ChatPanelFallback } from '../components/ChatPanelFallback'
import { CustomHelperButtons } from '../components/CustomHelperButtons'
import { AgentViewportBoundsHighlights } from '../components/highlights/AgentViewportBoundsHighlights'
import { AllContextHighlights } from '../components/highlights/ContextHighlights'
import { TargetAreaTool } from '../tools/TargetAreaTool'
import { TargetShapeTool } from '../tools/TargetShapeTool'
import { DynamicIsland } from '../components/DynamicIsland'
import { AgentSidebar } from '../components/AgentSidebar'
import { useAgentWebSocket } from '../hooks/useAgentWebSocket'
import { useAudioWorklets } from '../hooks/useAudioWorklets'

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

  const handleUnmount = useCallback(() => {
    setApp(null)
  }, [])

  // Audio worklets
  const { isAudioActive, startAudio, stopAudio, playAudioChunk, stopPlayback } =
    useAudioWorklets()

  // Agent WebSocket
  const userId = 'demo-user'
  const wsSessionId = sessionId || 'default-session'

  const ws = useAgentWebSocket({
    userId,
    sessionId: wsSessionId,
    onPlayAudio: playAudioChunk,
    onStopPlayback: stopPlayback,
  })

  // Audio start/stop handlers that wire into the WS
  const handleStartAudio = useCallback(() => {
    startAudio((pcmChunk) => {
      ws.sendAudioChunk(pcmChunk)
    })
  }, [startAudio, ws.sendAudioChunk])

  const handleStopAudio = useCallback(() => {
    stopAudio()
  }, [stopAudio])

  // Custom components to visualize what the agent is doing
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
          {/* ChatPanel replaced by live agent sidebar */}
          {/* <ErrorBoundary fallback={ChatPanelFallback}>
            {app && (
              <TldrawAgentAppContextProvider app={app}>
                <ChatPanel />
              </TldrawAgentAppContextProvider>
            )}
          </ErrorBoundary> */}
          <AgentSidebar
            connectionState={ws.connectionState}
            eventLog={ws.eventLog}
            isAudioActive={isAudioActive}
            onConnect={ws.connect}
            onDisconnect={ws.disconnect}
            onSendText={ws.sendText}
            onStartAudio={handleStartAudio}
            onStopAudio={handleStopAudio}
            onClearLog={ws.clearLog}
          />
        </div>
      </TldrawUiToastsProvider>

      <CustomToolbar />

      {/* Dynamic Island for AI Voice Agent */}
      <DynamicIsland
        connectionState={ws.connectionState}
        talkingState={ws.talkingState}
      />
    </>
  )
}
