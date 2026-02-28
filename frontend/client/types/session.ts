export interface Session {
  id: string
  topic: string
  goal?: string
  mode: 'guided' | 'socratic' | 'challenge'
  level: 'beginner' | 'intermediate' | 'advanced'
  lastActive: Date
  duration: number // in minutes
  thumbnail?: string
  createdAt: Date
  updatedAt: Date
}

export interface NewSessionData {
  topic: string
  goal?: string
  mode: 'guided' | 'socratic' | 'challenge'
  level: 'beginner' | 'intermediate' | 'advanced'
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