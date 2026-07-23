import React from 'react'

export default function StatusBadge({ status }) {
  if (!status) return null
  return (
    <span
      className="badge text-white"
      style={{ backgroundColor: status.color }}
    >
      {status.name}
    </span>
  )
}
