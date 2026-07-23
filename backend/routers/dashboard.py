from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta, timezone
from database import get_db
import models, schemas
from auth import get_current_user, require_agent_or_admin

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _naive(dt):
    """Return naive UTC datetime, stripping tzinfo if present."""
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


@router.get("", response_model=schemas.DashboardMetrics)
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    now = datetime.utcnow()
    first_day_this_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    first_day_last_month = (first_day_this_month - timedelta(days=1)).replace(day=1)

    base_q = db.query(models.Ticket).filter(models.Ticket.deleted_at.is_(None))

    total = base_q.count()

    # Por estado
    statuses = db.query(models.TicketStatus).filter(models.TicketStatus.is_active == True).all()
    tickets_by_status = {}
    open_tickets = 0
    pending_tickets = 0
    resolved_tickets = 0

    for st in statuses:
        count = base_q.filter(models.Ticket.status_id == st.id).count()
        tickets_by_status[st.name] = {"count": count, "color": st.color}
        if st.name.lower() in ["abierto", "open"]:
            open_tickets = count
        elif st.name.lower() in ["pendiente", "pending"]:
            pending_tickets = count
        elif st.name.lower() in ["resuelto", "resolved", "cerrado", "closed"]:
            resolved_tickets = count

    # Por prioridad
    priorities = ["low", "medium", "high", "critical"]
    tickets_by_priority = {}
    for p in priorities:
        tickets_by_priority[p] = base_q.filter(models.Ticket.priority == p).count()

    # Por agente
    agents = db.query(models.User).filter(
        models.User.role.in_([models.UserRole.agent, models.UserRole.admin, models.UserRole.supervisor]),
        models.User.is_active == True,
    ).all()
    tickets_by_agent = []
    for agent in agents:
        count = base_q.filter(models.Ticket.assigned_to_id == agent.id).count()
        tickets_by_agent.append({"agent": agent.name, "count": count, "agent_id": agent.id})
    tickets_by_agent.sort(key=lambda x: x["count"], reverse=True)

    # Tickets este mes / mes anterior
    tickets_this_month = base_q.filter(models.Ticket.created_at >= first_day_this_month).count()
    tickets_last_month = base_q.filter(
        models.Ticket.created_at >= first_day_last_month,
        models.Ticket.created_at < first_day_this_month,
    ).count()

    # Tiempo promedio de resolución (horas)
    resolved_tickets_q = db.query(models.Ticket).filter(models.Ticket.deleted_at.is_(None), models.Ticket.closed_at.isnot(None))
    avg_hours = None
    resolved_list = resolved_tickets_q.all()
    if resolved_list:
        total_hours = sum(
            (t.closed_at - t.created_at).total_seconds() / 3600
            for t in resolved_list
            if t.closed_at and t.created_at
        )
        avg_hours = round(total_hours / len(resolved_list), 1)

    # Últimos 10 tickets
    recent = base_q.order_by(models.Ticket.created_at.desc()).limit(10).all()

    # SLA metrics
    tomorrow = now + timedelta(hours=24)
    open_q = base_q.filter(models.Ticket.closed_at.is_(None))
    with_sla = open_q.filter(models.Ticket.sla_deadline.isnot(None))

    sla_overdue_count = with_sla.filter(
        models.Ticket.sla_deadline < now,
        models.Ticket.sla_paused_at.is_(None),
    ).count()

    sla_at_risk_count = with_sla.filter(
        models.Ticket.sla_deadline >= now,
        models.Ticket.sla_deadline <= tomorrow,
        models.Ticket.sla_paused_at.is_(None),
    ).count()

    sla_ok_count = with_sla.filter(
        models.Ticket.sla_deadline > tomorrow,
        models.Ticket.sla_paused_at.is_(None),
    ).count()

    sla_paused_count = with_sla.filter(
        models.Ticket.sla_paused_at.isnot(None),
    ).count()

    resolved_with_sla = db.query(models.Ticket).filter(
        models.Ticket.deleted_at.is_(None),
        models.Ticket.sla_deadline.isnot(None),
        models.Ticket.closed_at.isnot(None),
    ).all()
    if resolved_with_sla:
        sla_met = sum(
            1 for t in resolved_with_sla
            if t.closed_at and t.sla_deadline and _naive(t.closed_at) <= _naive(t.sla_deadline)
        )
        sla_compliance_rate = round(sla_met / len(resolved_with_sla) * 100, 1)
    else:
        sla_compliance_rate = None

    sla_overdue_tickets = (
        with_sla
        .filter(
            models.Ticket.sla_deadline < now,
            models.Ticket.sla_paused_at.is_(None),
        )
        .order_by(models.Ticket.sla_deadline.asc())
        .limit(5)
        .all()
    )

    return schemas.DashboardMetrics(
        total_tickets=total,
        open_tickets=open_tickets,
        pending_tickets=pending_tickets,
        resolved_tickets=resolved_tickets,
        tickets_by_status=tickets_by_status,
        tickets_by_priority=tickets_by_priority,
        tickets_by_agent=tickets_by_agent,
        recent_tickets=recent,
        avg_resolution_hours=avg_hours,
        tickets_this_month=tickets_this_month,
        tickets_last_month=tickets_last_month,
        sla_overdue=sla_overdue_count,
        sla_at_risk=sla_at_risk_count,
        sla_ok=sla_ok_count,
        sla_paused=sla_paused_count,
        sla_compliance_rate=sla_compliance_rate,
        sla_overdue_tickets=sla_overdue_tickets,
    )
