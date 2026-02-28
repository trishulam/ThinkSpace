import React from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle }) => {
  return (
    <div className="mindpad-page-header">
      <h1 className="mindpad-page-title">{title}</h1>
      {subtitle && (
        <p className="mindpad-page-subtitle">{subtitle}</p>
      )}
    </div>
  )
}