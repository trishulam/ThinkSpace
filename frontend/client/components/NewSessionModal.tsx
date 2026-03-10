import React, { useState } from 'react'
import { NewSessionData } from '../types/session'

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
    level: 'beginner'
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
      level: 'beginner'
    })
    setErrors({})
  }

  const handleCancel = () => {
    setFormData({
      topic: '',
      goal: '',
      mode: 'guided',
      level: 'beginner'
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
    <div className="mindpad-modal-overlay" onClick={isSubmitting ? undefined : handleCancel}>
      <div className="mindpad-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mindpad-modal-header">
          <h2 className="mindpad-modal-title">Start a New Session</h2>
          <button
            onClick={handleCancel}
            className="mindpad-modal-close"
            type="button"
            disabled={isSubmitting}
          >
            <XIcon className="mindpad-modal-close-icon" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mindpad-modal-content">
            {/* Topic Field */}
            <div className="mindpad-form-group">
              <label htmlFor="topic" className="mindpad-form-label">
                Topic *
              </label>
              <input
                id="topic"
                type="text"
                className={`mindpad-form-input ${errors.topic ? 'mindpad-form-input-error' : ''}`}
                placeholder="e.g. Backpropagation in Neural Networks"
                value={formData.topic}
                onChange={(e) => handleInputChange('topic', e.target.value)}
                autoFocus
                disabled={isSubmitting}
              />
              {errors.topic && (
                <span className="mindpad-form-error-text">{errors.topic}</span>
              )}
            </div>

            {/* Goal Field */}
            <div className="mindpad-form-group">
              <label htmlFor="goal" className="mindpad-form-label">
                Goal
              </label>
              <input
                id="goal"
                type="text"
                className="mindpad-form-input"
                placeholder="Understand gradient flow intuitively"
                value={formData.goal}
                onChange={(e) => handleInputChange('goal', e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            {/* Mode Field */}
            <div className="mindpad-form-group">
              <label className="mindpad-form-label">Mode</label>
              <div className="mindpad-segmented-control">
                <button
                  type="button"
                  className={`mindpad-segmented-option ${formData.mode === 'guided' ? 'active' : ''}`}
                  onClick={() => handleInputChange('mode', 'guided')}
                  disabled={isSubmitting}
                >
                  Guided
                </button>
                <button
                  type="button"
                  className={`mindpad-segmented-option ${formData.mode === 'socratic' ? 'active' : ''}`}
                  onClick={() => handleInputChange('mode', 'socratic')}
                  disabled={isSubmitting}
                >
                  Socratic
                </button>
                <button
                  type="button"
                  className={`mindpad-segmented-option ${formData.mode === 'challenge' ? 'active' : ''}`}
                  onClick={() => handleInputChange('mode', 'challenge')}
                  disabled={isSubmitting}
                >
                  Challenge
                </button>
              </div>
            </div>

            {/* Level Field */}
            <div className="mindpad-form-group">
              <label htmlFor="level" className="mindpad-form-label">
                Level
              </label>
              <div className="mindpad-select">
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

          {/* Modal Actions */}
          <div className="mindpad-modal-actions">
            <button
              type="button"
              className="mindpad-btn-ghost"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="mindpad-btn-primary"
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