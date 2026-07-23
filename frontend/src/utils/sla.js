// Total allowed minutes per priority: critical=4h, high=9h, medium=27h, low=45h
export const SLA_TOTAL = { critical: 240, high: 540, medium: 1620, low: 2700 }

export function getSLAInfo(ticket) {
  const resolved = ticket.status_rel?.is_closed || !!ticket.closed_at
  // A resolved ticket has no running deadline, so it's treated like a paused one:
  // remaining time comes from the accumulated sla_elapsed_minutes, not now-vs-deadline.
  const paused = !!ticket.sla_paused_at || resolved
  const total = SLA_TOTAL[ticket.priority] || 1620

  if (paused) {
    const remaining = total - (ticket.sla_elapsed_minutes || 0)
    // Backend sends naive datetime strings (no timezone suffix); without forcing 'Z'
    // here, JS would parse them as local time instead of UTC.
    const deadline = ticket.sla_deadline
      ? new Date(ticket.sla_deadline + (ticket.sla_deadline.endsWith('Z') ? '' : 'Z'))
      : null
    return { paused: true, resolved, breached: remaining <= 0, remaining_min: Math.max(remaining, 0), deadline }
  }

  if (!ticket.sla_deadline) return null
  const deadline = new Date(ticket.sla_deadline + (ticket.sla_deadline.endsWith('Z') ? '' : 'Z'))
  const diff = Math.floor((deadline - new Date()) / 60000)
  return { paused: false, resolved: false, breached: diff <= 0, remaining_min: Math.max(diff, 0), deadline }
}

export function fmtSlaRemaining(min) {
  if (min <= 0) return 'Vencido'
  if (min < 60) return `${min}m`
  if (min < 1440) return `${Math.floor(min / 60)}h ${min % 60}m`
  return `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`
}
