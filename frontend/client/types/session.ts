export interface Session {
  id: string
  topic: string
  goal?: string
  mode: 'guided' | 'socratic' | 'challenge'
  level: 'beginner' | 'intermediate' | 'advanced'
  persona: SessionPersonaId
  status: string
  summary?: string
  lastActive: Date
  duration: number // in minutes
  thumbnail?: string
  createdAt: Date
  updatedAt: Date
  checkpointCount: number
  milestoneCount: number
}

export type SessionPersonaId = 'professor' | 'coach' | 'challenger'

export interface NewSessionData {
  topic: string
  goal?: string
  mode: 'guided' | 'socratic' | 'challenge'
  level: 'beginner' | 'intermediate' | 'advanced'
  persona: SessionPersonaId
}

export interface Keypoint {
  id: string
  timestamp: number // in seconds
  title: string
  type: 'intro' | 'diagram' | 'correction' | 'practice' | 'recap'
}

export interface SessionReplay {
  sessionId: string
  keypoints: Keypoint[]
  transcript: TranscriptLine[]
  duration: number
}

export interface TranscriptLine {
  timestamp: number
  speaker: 'MindPad' | 'User'
  text: string
  isKeypoint?: boolean
  keypointTitle?: string
}