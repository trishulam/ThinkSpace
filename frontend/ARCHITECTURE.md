# Tldraw Agent Template - Complete Architecture Documentation

## Table of Contents
- [Overview](#overview)
- [System Architecture](#system-architecture)
- [End-to-End Data Flow](#end-to-end-data-flow)
- [Core Components](#core-components)
- [Action System](#action-system)
- [Prompt System](#prompt-system)
- [Mode System](#mode-system)
- [Extension Guide](#extension-guide)
- [Development Setup](#development-setup)

## Overview

The Tldraw Agent Template is a sophisticated AI agent system built on top of Tldraw (a collaborative drawing canvas) that enables natural language interaction with visual content. Users can chat with an AI agent that understands the canvas, can see what's drawn, and can create, modify, and organize visual elements through conversation.

### Key Features
- **Visual Understanding**: AI can analyze canvas content and spatial relationships
- **Natural Language Interface**: Chat-based interaction with drawing operations
- **Real-time Streaming**: Actions execute as the AI generates them
- **Multi-Model Support**: Works with OpenAI, Anthropic, and Google models
- **Extensible Architecture**: Easy to add new actions, prompts, and behaviors
- **Context Awareness**: Tracks user selections, viewport, and conversation history

## System Architecture

### Infrastructure Stack
```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                          │
├─────────────────────┬───────────────────────────────────────┤
│   Cloudflare Pages  │         Cloudflare Workers            │
│   (Static Assets)   │      (Durable Objects + AI API)      │
│                     │                                       │
│   React Frontend    │        AgentDurableObject             │
│   + Tldraw Canvas   │        + AgentService                 │
│                     │        + Multi-AI Provider           │
└─────────────────────┴───────────────────────────────────────┘
```

### Architecture Layers

#### 1. **Frontend Layer (React + Tldraw)**
- **Main App**: [`client/App.tsx`](client/App.tsx) - Root component integrating Tldraw with agent system
- **Canvas Integration**: Tldraw provides collaborative drawing with shapes, tools, and real-time updates
- **Chat Interface**: [`client/components/ChatPanel.tsx`](client/components/ChatPanel.tsx) - User interaction panel
- **Custom Tools**: Context selection tools for targeting specific areas/shapes
- **Visual Overlays**: Highlights and indicators showing agent focus areas

#### 2. **Agent Core System**
```
TldrawAgentApp (App-level coordinator)
└── TldrawAgent (Individual agent instance)
    ├── AgentActionManager (Executes AI decisions)
    ├── AgentChatManager (Conversation history)
    ├── AgentContextManager (User selections/focus)
    ├── AgentRequestManager (Streaming & scheduling)
    ├── AgentModeManager (Behavior state machine)
    ├── AgentTodoManager (Task planning)
    └── Other specialized managers...
```

#### 3. **Backend Layer (Cloudflare Workers)**
- **Worker Entry**: [`worker/worker.ts`](worker/worker.ts) - Routes requests to durable objects
- **Durable Objects**: [`worker/do/AgentDurableObject.ts`](worker/do/AgentDurableObject.ts) - Stateful compute at the edge
- **AI Service**: [`worker/do/AgentService.ts`](worker/do/AgentService.ts) - Multi-provider AI integration
- **Prompt Building**: Server-side prompt assembly and system prompt generation

#### 4. **Shared Type System**
- **Action Schemas**: [`shared/schema/AgentActionSchemas.ts`](shared/schema/AgentActionSchemas.ts) - Zod validation for AI actions
- **Prompt Definitions**: [`shared/schema/PromptPartDefinitions.ts`](shared/schema/PromptPartDefinitions.ts) - Modular prompt components
- **Type Safety**: Runtime validation with automatic TypeScript type generation

## End-to-End Data Flow

### 1. User Interaction → Request Creation
```
User types in chat → ChatPanel.handleSubmit() → AgentInput creation
```

**Details**:
- User message captured from [`ChatInput`](client/components/ChatInput.tsx)
- Combined with current viewport bounds, selected shapes, context items
- Creates [`AgentInput`](shared/types/AgentInput.ts) with source: 'user'

### 2. Request Processing → Prompt Assembly
```
AgentInput → agent.prompt() → preparePrompt() → AgentPrompt
```

**Details**:
- [`TldrawAgent.prompt()`](client/agent/TldrawAgent.ts) initiates request processing
- [`preparePrompt()`](client/agent/TldrawAgent.ts) assembles full prompt from current mode's parts
- Each [`PromptPartUtil`](client/parts/) generates its portion (shapes, history, context, etc.)
- Parts prioritized and combined into complete [`AgentPrompt`](shared/types/AgentPrompt.ts)

### 3. Worker Communication
```
Client → POST /stream → AgentDurableObject → AgentService
```

**Details**:
- [`streamAgentActions()`](client/agent/TldrawAgent.ts) sends POST to `/stream` endpoint
- [`worker/routes/stream.ts`](worker/routes/stream.ts) routes to appropriate durable object
- Each user gets isolated [`AgentDurableObject`](worker/do/AgentDurableObject.ts) instance
- Request handled by [`AgentService.stream()`](worker/do/AgentService.ts)

### 4. AI Processing
```
AgentPrompt → buildSystemPrompt() + buildMessages() → AI API → Streaming response
```

**Details**:
- [`buildSystemPrompt()`](worker/prompt/buildSystemPrompt.ts) creates comprehensive system instructions
- [`buildMessages()`](worker/prompt/buildMessages.ts) formats conversation history
- Multi-provider support (OpenAI, Anthropic, Google) via AI SDK
- Streaming JSON response with action objects

### 5. Action Streaming & Parsing
```
AI Stream → closeAndParseJson() → Server-Sent Events → Client
```

**Details**:
- [`closeAndParseJson()`](worker/do/closeAndParseJson.ts) handles partial JSON parsing
- Actions streamed as Server-Sent Events: `data: {"_type": "create", "shape": {...}}`
- Client receives streaming [`AgentAction`](shared/types/AgentAction.ts) objects
- Both incomplete (in-progress) and complete actions handled

### 6. Action Execution
```
Streaming Actions → sanitizeAction() → applyAction() → Canvas Updates
```

**Details**:
- [`requestAgentActions()`](client/agent/TldrawAgent.ts) receives action stream
- Each action processed by corresponding [`AgentActionUtil`](client/actions/AgentActionUtil.ts):
  - [`sanitizeAction()`](client/actions/AgentActionUtil.ts) validates and transforms input
  - [`applyAction()`](client/actions/AgentActionUtil.ts) executes on Tldraw editor
- Changes tracked as diffs for undo/redo support
- Canvas updates automatically via Tldraw's reactive system

### 7. UI Updates & Continuation
```
Action Completion → Chat History Update → Mode Transitions → Potential Scheduling
```

**Details**:
- [`ChatHistory`](client/components/chat-history/ChatHistory.tsx) shows actions in real-time
- Completed actions trigger mode system evaluation
- Agent may schedule follow-up work via [`agent.schedule()`](client/agent/TldrawAgent.ts)
- Process repeats for multi-turn interactions

## Core Components

### TldrawAgentApp
**File**: [`client/agent/TldrawAgentApp.ts`](client/agent/TldrawAgentApp.ts)

App-level coordinator managing multiple agents and shared concerns:
- **Agent Lifecycle**: Creation, tracking, and cleanup of agent instances
- **Persistence**: Auto-save and restore of agent state and conversation history
- **Global Settings**: Model selection, debug flags, shared configuration

```typescript
class TldrawAgentApp {
  agents: AgentAppAgentsManager      // Agent lifecycle
  persistence: AgentAppPersistenceManager  // State saving/loading
  
  constructor(editor: Editor, options: { onError: (e: any) => void })
  dispose(): void
  reset(): void
}
```

### TldrawAgent
**File**: [`client/agent/TldrawAgent.ts`](client/agent/TldrawAgent.ts)

Core agent instance with specialized managers:

```typescript
class TldrawAgent {
  // Core managers
  actions: AgentActionManager        // Execute AI decisions on canvas
  chat: AgentChatManager            // Conversation history management
  context: AgentContextManager      // User selections and focus areas
  requests: AgentRequestManager     // Streaming and request scheduling
  mode: AgentModeManager           // Behavior state machine
  todos: AgentTodoManager          // Task planning and tracking
  
  // Key methods
  async prompt(input: AgentInput): Promise<void>
  async request(input: AgentInput): Promise<void>
  schedule(input: AgentInput): void
  cancel(): void
  reset(): void
}
```

### Agent Managers

#### AgentActionManager
**File**: [`client/agent/managers/AgentActionManager.ts`](client/agent/managers/AgentActionManager.ts)
- Executes AI-generated actions on the Tldraw editor
- Manages action utilities and mode-specific action filtering
- Tracks diffs for undo/redo support

#### AgentChatManager  
**File**: [`client/agent/managers/AgentChatManager.ts`](client/agent/managers/AgentChatManager.ts)
- Stores conversation history as [`ChatHistoryItem[]`](shared/types/ChatHistoryItem.ts)
- Handles prompts, actions, and continuation data
- Provides reactive access for UI updates

#### AgentContextManager
**File**: [`client/agent/managers/AgentContextManager.ts`](client/agent/managers/AgentContextManager.ts)
- Tracks user-selected context items (shapes, areas, points)
- Manages context highlighting and visual feedback
- Provides context data for prompt assembly

#### AgentRequestManager
**File**: [`client/agent/managers/AgentRequestManager.ts`](client/agent/managers/AgentRequestManager.ts)  
- Handles active requests and streaming state
- Manages request scheduling for multi-turn workflows
- Provides cancellation and abort functionality

#### AgentModeManager
**File**: [`client/agent/managers/AgentModeManager.ts`](client/agent/managers/AgentModeManager.ts)
- Implements behavior state machine via [`AgentModeDefinitions`](client/modes/AgentModeDefinitions.ts)
- Controls available prompt parts and actions per mode
- Handles mode transitions and lifecycle events

## Action System

The action system enables the AI to perform operations on the Tldraw canvas through structured, validated actions.

### Action Architecture
```
AI generates action → Schema validation → Sanitization → Execution → Diff tracking
```

### Available Actions (25+ types)

#### Creation Actions
- **`create`**: Create new shapes (rectangles, circles, text, etc.)
- **`pen`**: Draw freeform lines and paths

#### Modification Actions  
- **`update`**: Modify existing shape properties
- **`move`**: Reposition shapes with anchor points
- **`resize`**: Scale shapes with origin-based transforms
- **`rotate`**: Rotate shapes around pivot points
- **`label`**: Change text content of shapes

#### Organization Actions
- **`align`**: Align shapes along axes (top, bottom, left, right, center)
- **`distribute`**: Evenly space shapes horizontally or vertically  
- **`stack`**: Stack shapes with consistent gaps
- **`bringToFront`** / **`sendToBack`**: Manage layer ordering

#### Navigation Actions
- **`setMyView`**: Change agent's viewport to focus on specific areas

#### Communication Actions
- **`message`**: Send messages to the user
- **`think`**: Show reasoning and thought process

#### Workflow Actions  
- **`review`**: Schedule follow-up work to review results
- **`addDetail`**: Plan additional detail work
- **`update-todo-list`**: Manage task lists

### Action Implementation

Each action type has a dedicated utility class extending [`AgentActionUtil`](client/actions/AgentActionUtil.ts):

```typescript
// Example: CreateActionUtil
class CreateActionUtil extends AgentActionUtil<CreateAction> {
  static type = 'create' as const
  
  // Validate and transform action before execution
  sanitizeAction(action: Streaming<CreateAction>, helpers: AgentHelpers): Streaming<CreateAction> | null
  
  // Execute the action on the canvas
  applyAction(action: Streaming<CreateAction>, helpers: AgentHelpers): void
  
  // Provide info for chat history display  
  getInfo(action: Streaming<CreateAction>): Partial<ChatHistoryInfo> | null
}
```

### Action Registration
Actions are automatically registered via [`registerActionUtil()`](client/actions/AgentActionUtil.ts):

```typescript
export const CreateActionUtil = registerActionUtil(
  class CreateActionUtil extends AgentActionUtil<CreateAction> {
    // Implementation...
  }
)
```

## Prompt System

The prompt system assembles comprehensive prompts from modular, reusable parts.

### Prompt Architecture
```
AgentRequest → Mode determines parts → PromptPartUtils generate content → AgentPrompt
```

### Available Prompt Parts

#### Canvas Content Parts
- **`blurryShapes`**: Shapes visible in current viewport
- **`peripheralShapes`**: Shape clusters outside main view
- **`selectedShapes`**: User-selected shapes
- **`screenshot`**: Visual canvas state

#### Context Parts  
- **`contextItems`**: User-selected focus areas, shapes, or points
- **`userViewportBounds`**: User's current view area
- **`agentViewportBounds`**: Agent's current view area

#### History & State Parts
- **`chatHistory`**: Previous conversation and actions
- **`userActionHistory`**: Recent user changes to canvas
- **`todoList`**: Current task list

#### Metadata Parts
- **`time`**: Current timestamp
- **`canvasLints`**: Visual issues detected on canvas
- **`messages`**: Current user message(s)
- **`data`**: Retrieved data from previous actions

### Prompt Part Implementation

Each part type has a utility class extending [`PromptPartUtil`](client/parts/PromptPartUtil.ts):

```typescript
// Example: BlurryShapesPartUtil  
class BlurryShapesPartUtil extends PromptPartUtil<BlurryShapesPart> {
  async getPart(request: AgentRequest, helpers: AgentHelpers): Promise<BlurryShapesPart | null> {
    const shapes = await this.getShapesInBounds(request.bounds)
    return { type: 'blurryShapes', shapes }
  }
}
```

### Priority System
Parts are assembled by priority (-∞ to +∞) ensuring consistent prompt structure:
- **Chat History**: -∞ (first)  
- **Canvas Content**: -70 to -40
- **Context**: -55
- **Current Message**: +∞ (last)

## Mode System

The mode system controls agent behavior through a state machine defined in [`client/modes/AgentModeDefinitions.ts`](client/modes/AgentModeDefinitions.ts).

### Mode Structure
```typescript
interface AgentModeDefinition {
  type: string
  active: boolean                    // Can agent take actions?
  parts: PromptPart['type'][]       // Available prompt parts
  actions: AgentAction['_type'][]   // Available actions  
  
  // Lifecycle hooks
  onPromptStart?(agent: TldrawAgent, request: AgentRequest): void
  onPromptEnd?(agent: TldrawAgent, request: AgentRequest): void  
  onPromptCancel?(agent: TldrawAgent, request: AgentRequest): void
}
```

### Mode Transitions
Modes can transition based on:
- User input patterns
- Action completion
- Error conditions
- External triggers

The mode system enables different agent personalities or specialized behaviors for different contexts.

## Extension Guide

### Adding New Actions

1. **Define Schema** in [`shared/schema/AgentActionSchemas.ts`](shared/schema/AgentActionSchemas.ts):
```typescript
export const MyNewAction = z
  .object({
    _type: z.literal('myNew'),
    parameter1: z.string(),
    parameter2: z.number(),
  })
  .meta({ 
    title: 'My New Action',
    description: 'Description of what this action does'
  })

export type MyNewAction = z.infer<typeof MyNewAction>
```

2. **Create Action Util** in [`client/actions/MyNewActionUtil.ts`](client/actions/):
```typescript
export const MyNewActionUtil = registerActionUtil(
  class MyNewActionUtil extends AgentActionUtil<MyNewAction> {
    static override type = 'myNew' as const

    override sanitizeAction(action: Streaming<MyNewAction>, helpers: AgentHelpers) {
      // Validate and transform action
      return action
    }

    override applyAction(action: Streaming<MyNewAction>, helpers: AgentHelpers) {
      // Execute action on canvas
      const { parameter1, parameter2 } = action
      // Implementation...
    }
  }
)
```

3. **Auto-registration**: The action is automatically available once the util is imported.

### Adding New Prompt Parts

1. **Define Part Type** in [`shared/schema/PromptPartDefinitions.ts`](shared/schema/PromptPartDefinitions.ts):
```typescript
export interface MyNewPart {
  type: 'myNew'
  data: SomeDataType[]
}

export const MyNewPartDefinition: PromptPartDefinition<MyNewPart> = {
  type: 'myNew',
  priority: -60,
  buildContent: ({ data }) => {
    return [`Here's the data: ${JSON.stringify(data)}`]
  }
}
```

2. **Create Part Util** in [`client/parts/MyNewPartUtil.ts`](client/parts/):
```typescript
export class MyNewPartUtil extends PromptPartUtil<MyNewPart> {
  async getPart(request: AgentRequest, helpers: AgentHelpers): Promise<MyNewPart | null> {
    const data = await this.gatherSomeData(request)
    return { type: 'myNew', data }
  }
  
  private async gatherSomeData(request: AgentRequest): Promise<SomeDataType[]> {
    // Implementation...
  }
}
```

3. **Auto-registration**: The part is automatically available once the util is imported.

### Adding New Modes

1. **Define Mode** in [`client/modes/AgentModeDefinitions.ts`](client/modes/AgentModeDefinitions.ts):
```typescript
const MyNewMode: AgentModeDefinition = {
  type: 'myNew',
  active: true,
  parts: ['blurryShapes', 'chatHistory', 'messages'], // Available prompt parts
  actions: ['create', 'update', 'message'],            // Available actions
  
  onPromptStart(agent, request) {
    // Mode entry logic
  },
  
  onPromptEnd(agent, request) {
    // Determine next mode or schedule follow-up
  }
}
```

2. **Add to Mode Chart** in [`client/modes/AgentModeChart.ts`](client/modes/AgentModeChart.ts):
```typescript
export const AGENT_MODE_CHART: Record<AgentModeType, AgentModeDefinition> = {
  // ... existing modes
  'myNew': MyNewMode,
}
```

## Development Setup

### Prerequisites
- Node.js 18+
- Cloudflare account (for deployment)
- API keys for AI providers (OpenAI, Anthropic, and/or Google)

### Local Development
```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Add your API keys to .env

# Start development server
npm run dev
```

### Deployment
```bash
# Build and deploy to Cloudflare
npm run build
npx wrangler deploy
```

### Environment Variables
Set these in your Cloudflare Worker environment or local `.env`:
- `OPENAI_API_KEY`: OpenAI API key
- `ANTHROPIC_API_KEY`: Anthropic API key  
- `GOOGLE_API_KEY`: Google AI API key

### Key Files for Development
- **Configuration**: [`wrangler.toml`](wrangler.toml), [`vite.config.ts`](vite.config.ts)
- **Main App**: [`client/App.tsx`](client/App.tsx)
- **Agent Core**: [`client/agent/TldrawAgent.ts`](client/agent/TldrawAgent.ts)
- **Worker Entry**: [`worker/worker.ts`](worker/worker.ts)
- **Action Registry**: [`client/actions/`](client/actions/)
- **Prompt Registry**: [`client/parts/`](client/parts/)

This architecture provides a solid foundation for building sophisticated AI agents that can understand and manipulate visual content through natural language interaction.