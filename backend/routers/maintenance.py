"""Planes de mantenimiento recurrente (preventivos) y métricas del módulo de mantenimiento.

Un plan guarda la flota del cliente, la frecuencia (meses) y la próxima fecha sugerida.
Cada atención es un ticket de categoría 'Mantenimiento' ligado vía Ticket.maint_plan_id.
Al cerrar esa atención el plan avanza solo (última fecha + frecuencia). El sistema
AVISA cuando la fecha se acerca o vence, pero nunca crea tickets por su cuenta.
"""
import calendar
from collections import Counter
from datetime import date, datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
import models
from auth import require_agent_or_admin

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])

TZ = ZoneInfo("America/Panama")
UPCOMING_DAYS = 30  # ventana de "próximo" en el dashboard


# ── Utilidades de fecha ────────────────────────────────────────────────────────
def _today() -> date:
    return datetime.now(TZ).date()


def _as_panama_date(dt: Optional[datetime]) -> Optional[date]:
    """Fecha local de Panamá. Los datetimes sin zona se asumen UTC (así los guarda la BD)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(TZ).date()


def add_months(d: date, n: int) -> date:
    """Suma n meses respetando el último día del mes destino (31 ene + 1 = 28/29 feb)."""
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def advance_plan_after_service(db: Session, ticket: models.Ticket) -> None:
    """Llamado al cerrar una atención ligada a un plan: avanza la recurrencia."""
    plan = db.query(models.MaintenancePlan).filter(models.MaintenancePlan.id == ticket.maint_plan_id).first()
    if not plan or plan.status != "active":
        return
    done = _as_panama_date(ticket.closed_at) or _today()
    plan.last_service_date = done
    plan.next_suggested_date = add_months(done, plan.frequency_months or 6)
    plan.last_reminder_sent_for = None


def _plan_state(plan: models.MaintenancePlan, today: date, has_open_service: bool) -> str:
    if plan.status == "cancelled":
        return "cancelled"
    if plan.status == "paused":
        return "paused"
    if not plan.next_suggested_date:
        return "ok"
    days = (plan.next_suggested_date - today).days
    if days < 0:
        return "overdue"
    if days <= UPCOMING_DAYS:
        return "upcoming"
    return "ok"


def _plan_dict(plan: models.MaintenancePlan, db: Session, today: date) -> dict:
    import json as _json
    open_services = db.query(func.count(models.Ticket.id)).filter(
        models.Ticket.maint_plan_id == plan.id,
        models.Ticket.deleted_at.is_(None),
        models.Ticket.closed_at.is_(None),
    ).scalar() or 0
    try:
        equipment = _json.loads(plan.equipment or "[]")
    except Exception:
        equipment = []
    days = (plan.next_suggested_date - today).days if plan.next_suggested_date else None
    return {
        "id": plan.id,
        "title": plan.title,
        "client": {"id": plan.client.id, "name": plan.client.name, "company": plan.client.company} if plan.client else None,
        "maint_type": plan.maint_type,
        "equipment": equipment,
        "frequency_months": plan.frequency_months,
        "last_service_date": plan.last_service_date.isoformat() if plan.last_service_date else None,
        "next_suggested_date": plan.next_suggested_date.isoformat() if plan.next_suggested_date else None,
        "days_to_next": days,
        "status": plan.status,
        "state": _plan_state(plan, today, open_services > 0),
        "open_services": open_services,
        "contact_name": plan.contact_name,
        "contact_email": plan.contact_email,
        "contact_phone": plan.contact_phone,
        "location": plan.location,
        "notes": plan.notes,
    }


# ── Esquemas ───────────────────────────────────────────────────────────────────
class PlanIn(BaseModel):
    client_id: Optional[int] = None
    title: str = Field(..., max_length=200)
    equipment: Optional[str] = None                 # JSON [{"type","qty"}] (flota)
    frequency_months: int = Field(6, ge=1, le=60)
    first_service_date: Optional[date] = None       # próxima fecha sugerida (ancla)
    contact_name: Optional[str] = Field(None, max_length=150)
    contact_email: Optional[str] = Field(None, max_length=150)
    contact_phone: Optional[str] = Field(None, max_length=50)
    location: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    from_ticket_id: Optional[int] = None            # crear el plan desde una atención ya confirmada


class PlanUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=200)
    equipment: Optional[str] = None
    frequency_months: Optional[int] = Field(None, ge=1, le=60)
    next_suggested_date: Optional[date] = None
    status: Optional[str] = Field(None, pattern="^(active|paused|cancelled)$")
    contact_name: Optional[str] = Field(None, max_length=150)
    contact_email: Optional[str] = Field(None, max_length=150)
    contact_phone: Optional[str] = Field(None, max_length=50)
    location: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None


# ── Planes ─────────────────────────────────────────────────────────────────────
@router.get("/plans")
def list_plans(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_agent_or_admin),
):
    q = db.query(models.MaintenancePlan).filter(models.MaintenancePlan.deleted_at.is_(None))
    if status:
        q = q.filter(models.MaintenancePlan.status == status)
    today = _today()
    plans = q.order_by(models.MaintenancePlan.next_suggested_date.asc().nullslast()).all()
    return [_plan_dict(p, db, today) for p in plans]


@router.post("/plans", status_code=201)
def create_plan(
    data: PlanIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    """Crea un plan. Con from_ticket_id reutiliza una atención confirmada: la recurrencia
    arranca desde su fecha (próxima = fecha de la atención + frecuencia) y la atención queda ligada."""
    from routers.system import maint_feature_on
    if not maint_feature_on(db, "recurring_plans"):
        raise HTTPException(status_code=403, detail="Los planes recurrentes están desactivados en la configuración")
    ticket = None
    client_id = data.client_id
    if data.from_ticket_id:
        ticket = db.query(models.Ticket).filter(models.Ticket.id == data.from_ticket_id).first()
        if not ticket or (ticket.category or "").lower() != "mantenimiento":
            raise HTTPException(status_code=400, detail="La atención no es de mantenimiento")
        if ticket.maint_plan_id:
            raise HTTPException(status_code=400, detail="Esa atención ya pertenece a un plan")
        client_id = client_id or ticket.client_id
    if not client_id:
        raise HTTPException(status_code=400, detail="Indica el cliente del plan")

    anchor = data.first_service_date
    if ticket and ticket.maint_confirmed_start:
        anchor = add_months(_as_panama_date(ticket.maint_confirmed_start), data.frequency_months)
    if not anchor:
        anchor = add_months(_today(), data.frequency_months)

    plan = models.MaintenancePlan(
        client_id=client_id,
        title=data.title.strip(),
        maint_type="preventivo",
        equipment=data.equipment or (ticket.maint_equipment if ticket else None),
        frequency_months=data.frequency_months,
        next_suggested_date=anchor,
        status="active",
        contact_name=data.contact_name or (ticket.maint_contact_name if ticket else None),
        contact_email=data.contact_email or (ticket.maint_contact_email if ticket else None),
        contact_phone=data.contact_phone or (ticket.maint_contact_phone if ticket else None),
        location=data.location or (ticket.location if ticket else None),
        notes=data.notes,
    )
    db.add(plan)
    db.flush()
    if ticket:
        ticket.maint_plan_id = plan.id
        ticket.maint_suggested_date = anchor
    db.commit()
    db.refresh(plan)
    return _plan_dict(plan, db, _today())


@router.put("/plans/{plan_id}")
def update_plan(
    plan_id: int,
    data: PlanUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_agent_or_admin),
):
    plan = db.query(models.MaintenancePlan).filter(
        models.MaintenancePlan.id == plan_id, models.MaintenancePlan.deleted_at.is_(None)).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    for field in ("title", "equipment", "contact_name", "contact_email", "contact_phone", "location", "notes", "status"):
        val = getattr(data, field)
        if val is not None:
            setattr(plan, field, val.strip() if isinstance(val, str) and field == "title" else val)
    if data.frequency_months is not None:
        plan.frequency_months = data.frequency_months
        # Recalcula la próxima fecha desde la última atención, si ya hubo una.
        if plan.last_service_date:
            plan.next_suggested_date = add_months(plan.last_service_date, plan.frequency_months)
    if data.next_suggested_date is not None:
        plan.next_suggested_date = data.next_suggested_date
        plan.last_reminder_sent_for = None
    db.commit()
    db.refresh(plan)
    return _plan_dict(plan, db, _today())


@router.post("/plans/{plan_id}/crear-servicio")
def create_plan_service(
    plan_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    """Crea la atención preventiva del plan como ticket (el agente luego confirma la fecha)."""
    from routers.tickets import create_ticket
    from schemas import TicketCreate
    plan = db.query(models.MaintenancePlan).filter(
        models.MaintenancePlan.id == plan_id, models.MaintenancePlan.deleted_at.is_(None)).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    if plan.status == "cancelled":
        raise HTTPException(status_code=400, detail="El plan está cancelado")
    status = (db.query(models.TicketStatus).filter(func.lower(models.TicketStatus.name).in_(["abierto", "open", "nuevo"])).first()
              or db.query(models.TicketStatus).order_by(models.TicketStatus.order).first())
    data = TicketCreate(
        title=f"Mantenimiento preventivo: {plan.title}"[:300],
        description=plan.notes or "",
        priority="medium",
        status_id=status.id,
        client_id=plan.client_id,
        category="Mantenimiento",
        location=plan.location,
        maint_type="preventivo",
        maint_equipment=plan.equipment,
        maint_requested_date=plan.next_suggested_date,
        maint_contact_name=plan.contact_name,
        maint_contact_email=plan.contact_email,
        maint_contact_phone=plan.contact_phone,
    )
    ticket = create_ticket(data, BackgroundTasks(), db, current_user)  # sin correos automáticos de apertura
    ticket.maint_plan_id = plan.id
    ticket.maint_suggested_date = plan.next_suggested_date
    db.commit()
    return {"ticket_id": ticket.id}


# ── Dashboard ──────────────────────────────────────────────────────────────────
@router.get("/stats")
def maintenance_stats(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_agent_or_admin),
):
    """Métricas del módulo: próximos sugeridos, vencidos, pendientes, cancelados,
    completados a tiempo vs tarde, y desglose por tipo y cliente."""
    from routers.system import maint_feature_on
    if not maint_feature_on(db, "dashboard"):
        raise HTTPException(status_code=403, detail="El dashboard de mantenimiento está desactivado")
    today = _today()
    plans = db.query(models.MaintenancePlan).filter(models.MaintenancePlan.deleted_at.is_(None)).all()
    active = [p for p in plans if p.status == "active"]
    upcoming = sorted([p for p in active if p.next_suggested_date and 0 <= (p.next_suggested_date - today).days <= UPCOMING_DAYS],
                      key=lambda p: p.next_suggested_date)
    overdue = sorted([p for p in active if p.next_suggested_date and (p.next_suggested_date - today).days < 0],
                     key=lambda p: p.next_suggested_date)

    maint = db.query(models.Ticket).filter(
        models.Ticket.deleted_at.is_(None), func.lower(models.Ticket.category) == "mantenimiento").all()

    def _is_cancelled(t):
        return bool(t.status_rel and "cancel" in (t.status_rel.name or "").lower())

    cancelled_t = [t for t in maint if _is_cancelled(t)]
    closed_t = [t for t in maint if t.closed_at and not _is_cancelled(t)]
    open_t = [t for t in maint if not t.closed_at and not _is_cancelled(t)]

    def _target(t):
        return t.maint_suggested_date or _as_panama_date(t.maint_confirmed_end) or t.maint_requested_date

    on_time, late = [], []
    for t in closed_t:
        tgt = _target(t)
        if not tgt:
            continue
        (on_time if _as_panama_date(t.closed_at) <= tgt else late).append(t)
    rated = len(on_time) + len(late)

    # Vencidos sin atender: plan vencido sin atención abierta ligada.
    open_plan_ids = {t.maint_plan_id for t in open_t if t.maint_plan_id}
    overdue_unattended = [p for p in overdue if p.id not in open_plan_ids]

    by_type = Counter((t.maint_type or "sin tipo") for t in maint)
    by_client = Counter((t.client.name if t.client else "—") for t in maint)

    def _brief_ticket(t):
        return {"id": t.id, "number": t.maint_number or f"#{t.id}", "title": t.title, "client": t.client.name if t.client else "",
                "maint_type": t.maint_type, "status": t.status_rel.name if t.status_rel else ""}

    return {
        "as_of": today.isoformat(),
        "plans": {"active": len(active), "paused": sum(p.status == "paused" for p in plans),
                  "cancelled": sum(p.status == "cancelled" for p in plans)},
        "upcoming": [{"id": p.id, "title": p.title, "next_suggested_date": p.next_suggested_date.isoformat(),
                      "client": p.client.name if p.client else ""} for p in upcoming],
        "overdue": [{"id": p.id, "title": p.title, "next_suggested_date": p.next_suggested_date.isoformat(),
                     "client": p.client.name if p.client else "", "attended": p.id in open_plan_ids} for p in overdue],
        "overdue_unattended": len(overdue_unattended),
        "pending": {"count": len(open_t), "items": [_brief_ticket(t) for t in open_t[:20]]},
        "cancelled": {"plans": sum(p.status == "cancelled" for p in plans), "tickets": len(cancelled_t)},
        "completed": {"total": len(closed_t), "on_time": len(on_time), "late": len(late),
                      "on_time_pct": round(100 * len(on_time) / rated) if rated else None},
        "by_type": dict(by_type),
        "by_client": [{"client": k, "count": v} for k, v in by_client.most_common(5)],
    }
