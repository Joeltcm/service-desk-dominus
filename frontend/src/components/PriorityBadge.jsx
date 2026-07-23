import React from 'react'

const PRIORITY_CONFIG = {
  low:      { label: 'Baja',     className: 'bg-gray-100 text-gray-700' },
  medium:   { label: 'Media',    className: 'bg-blue-100 text-blue-700' },
  high:     { label: 'Alta',     className: 'bg-orange-100 text-orange-700' },
  critical: { label: 'Crítica',  className: 'bg-red-100 text-red-700' },
}

export default function PriorityBadge({ priority }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium
  return (
    <span className={`badge ${cfg.className}`}>{cfg.label}</span>
  )
}
