import React, { useState } from 'react'
import { NewSessionData } from '../types/session'
import { DEFAULT_SESSION_PERSONA, SESSION_PERSONAS } from '../config/personas'

interface NewSessionModalProps {
  isOpen: boolean
  onClose: () => void
  onCreateSession: (data: NewSessionData) => Promise<void> | void
  isSubmitting?: boolean
}

const XIcon: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
  </svg>
)

export const NewSessionModal: React.FC<NewSessionModalProps> = ({
  isOpen,
  onClose,
  onCreateSession,
  isSubmitting = false
}) => {
  const [formData, setFormData] = useState<NewSessionData>({
    topic: '',
    goal: '',
    mode: 'guided',
    level: 'beginner',
    persona: DEFAULT_SESSION_PERSONA
  })

  const [errors, setErrors] = useState<{ topic?: string }>({})

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validation
    const newErrors: { topic?: string } = {}
    if (!formData.topic.trim()) {
      newErrors.topic = 'Topic is required'
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    // Create session
    await onCreateSession({
      ...formData,
      topic: formData.topic.trim(),
      goal: formData.goal?.trim() || undefined
    })

    setFormData({
      topic: '',
      goal: '',
      mode: 'guided',
      level: 'beginner',
      persona: DEFAULT_SESSION_PERSONA
    })
    setErrors({})
  }

  const handleCancel = () => {
    setFormData({
      topic: '',
      goal: '',
      mode: 'guided',
      level: 'beginner',
      persona: DEFAULT_SESSION_PERSONA
    })
    setErrors({})
    onClose()
  }

  const handleInputChange = (field: keyof NewSessionData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // Clear error when user starts typing
    if (errors[field as keyof typeof errors]) {
      setErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  if (!isOpen) return null

  return (
    <div className="ts-session-modal-overlay" onClick={isSubmitting ? undefined : handleCancel}>
      <div className="ts-session-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ts-session-modal-header">
          <div className="ts-session-modal-title-block">
            <p className="ts-session-modal-kicker">New Session</p>
            <h2 className="ts-session-modal-title">Start a learning session</h2>
            <p className="ts-session-modal-subtitle">
              Choose a topic, set your goal, and pick how ThinkSpace should guide the session.
            </p>
          </div>
          <button
            onClick={handleCancel}
            className="ts-session-modal-close"
            type="button"
            disabled={isSubmitting}
            aria-label="Close modal"
          >
            <XIcon className="ts-session-modal-close-icon" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="ts-session-modal-content">
            <div className="ts-session-form-group">
              <label htmlFor="topic" className="ts-session-form-label">
                Topic *
              </label>
              <input
                id="topic"
                type="text"
                className={`ts-session-form-input ${errors.topic ? 'ts-session-form-input-error' : ''}`}
                placeholder="e.g. Backpropagation in Neural Networks"
                value={formData.topic}
                onChange={(e) => handleInputChange('topic', e.target.value)}
                autoFocus
                disabled={isSubmitting}
              />
              {errors.topic && (
                <span className="ts-session-form-error-text">{errors.topic}</span>
              )}
            </div>

            <div className="ts-session-form-group">
              <label htmlFor="goal" className="ts-session-form-label">
                Goal
              </label>
              <input
                id="goal"
                type="text"
                className="ts-session-form-input"
                placeholder="Understand gradient flow intuitively"
                value={formData.goal}
                onChange={(e) => handleInputChange('goal', e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="ts-session-form-group">
              <label className="ts-session-form-label">Mode</label>
              <div className="ts-session-segmented-control">
                <button
                  type="button"
                  className={`ts-session-segmented-option ${formData.mode === 'guided' ? 'active' : ''}`}
                  onClick={() => handleInputChange('mode', 'guided')}
                  disabled={isSubmitting}
                >
                  Guided
                </button>
                <button
                  type="button"
                  className={`ts-session-segmented-option ${formData.mode === 'socratic' ? 'active' : ''}`}
                  onClick={() => handleInputChange('mode', 'socratic')}
                  disabled={isSubmitting}
                >
                  Socratic
                </button>
                <button
                  type="button"
                  className={`ts-session-segmented-option ${formData.mode === 'challenge' ? 'active' : ''}`}
                  onClick={() => handleInputChange('mode', 'challenge')}
                  disabled={isSubmitting}
                >
                  Challenge
                </button>
              </div>
            </div>

            <div className="ts-session-form-group">
              <label htmlFor="persona" className="ts-session-form-label">
                Persona
              </label>
              <div className="ts-session-select">
                <select
                  id="persona"
                  value={formData.persona}
                  onChange={(e) => handleInputChange('persona', e.target.value as NewSessionData['persona'])}
                  disabled={isSubmitting}
                >
                  {SESSION_PERSONAS.map((persona) => (
                    <option key={persona.id} value={persona.id}>
                      {persona.label} - {persona.helper}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="ts-session-form-group">
              <label htmlFor="level" className="ts-session-form-label">
                Level
              </label>
              <div className="ts-session-select">
                <select
                  id="level"
                  value={formData.level}
                  onChange={(e) => handleInputChange('level', e.target.value as 'beginner' | 'intermediate' | 'advanced')}
                  disabled={isSubmitting}
                >
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </div>
            </div>
          </div>

          <div className="ts-session-modal-actions">
            <button
              type="button"
              className="ts-home-secondary-btn"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="ts-home-primary-btn"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}