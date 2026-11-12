from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
from database import get_db
import models, schemas
from auth import get_current_user, require_agent_or_admin
from business_hours import add_business_minutes, elapsed_business_minutes, SLA_MINUTES, PAUSE_STATUSES
from audit_helper import log_action


def _sla_minutes(priority: str, db: Session) -> int:
    """Read SLA minutes from AppSetting, fall back to hardcoded defaults."""
    key = f"sla_{priority}" if priority else None
    if key:
        row = db.query(models.AppSetting).filter_by(key=key).first()
        if row and row.value:
            try:
                return int(row.value)
            except (ValueError, TypeError):
                pass
    return SLA_MINUTES.get(priority, SLA_MINUTES["medium"])


class BulkDeleteRequest(BaseModel):
    ids: List[int]

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


def _client_can_access_ticket(ticket: models.Ticket, current_user: models.User, db: Session) -> bool:
    """Returns True if a client user is allowed to see this ticket.
    Mirrors the list-endpoint logic: own tickets OR same-company tickets."""
    if current_user.role != models.UserRole.client:
        return True
    if ticket.client_id == current_user.id:
        return True
    if current_user.company:
        company_ids = [
            r[0] for r in db.query(models.User.id).filter(
                func.lower(models.User.company) == current_user.company.lower(),
                models.User.is_active == True,
            ).all()
        ]
        return ticket.client_id in company_ids
    return False


def _pause_sla_for_trash(ticket: models.Ticket) -> None:
    """Pause the SLA clock when a ticket is sent to trash, so deleted time
    doesn't count against it. No-op if already paused (e.g. Resuelto)."""
    if ticket.sla_paused_at:
        return
    now = datetime.utcnow()
    if ticket.sla_last_resume:
        elapsed = elapsed_business_minutes(ticket.sla_last_resume, now)
        ticket.sla_elapsed_minutes = (ticket.sla_elapsed_minutes or 0) + elapsed
    ticket.sla_paused_at = now


def _resume_sla_from_trash(ticket: models.Ticket, db: Session) -> None:
    """Resume the SLA clock on restore from trash, unless the ticket's
    current status is itself a pause status (e.g. Resuelto)."""
    if not ticket.sla_paused_at:
        return
    status_name = ticket.status_rel.name if ticket.status_rel else None
    if status_name in PAUSE_STATUSES:
        return
    now = datetime.utcnow()
    total = _sla_minutes(ticket.priority, db)
    remaining = max(total - (ticket.sla_elapsed_minutes or 0), 0)
    ticket.sla_deadline = add_business_minutes(now, remaining)
    ticket.sla_paused_at = None
    ticket.sla_last_resume = now


_RESOLVED_STATUS_NAMES = {"resuelto", "resolved", "cerrado", "closed"}


def _is_resolved_status(name) -> bool:
    return (name or "").strip().lower() in _RESOLVED_STATUS_NAMES


def _maybe_autoassign(db: Session, ticket: models.Ticket, current_user: models.User, reason: str) -> None:
    """Auto-asigna el ticket al staff que actúa (responde/resuelve), SOLO si está sin asignar.
    Nunca 'roba' un ticket ya asignado ni asigna a un cliente. Deja traza en la línea de tiempo."""
    if current_user.role == models.UserRole.client:
        return
    if ticket.assigned_to_id is not None:
        return
    ticket.assigned_to_id = current_user.id
    db.add(models.TicketTimeline(
        ticket_id=ticket.id,
        user_id=current_user.id,
        content=f"Ticket autoasignado a {current_user.name} al {reason}",
        entry_type="assignment",
    ))


# ── Categories ────────────────────────────────────────
@router.get("/categories", response_model=List[schemas.CategoryOut])
def list_categories(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(models.TicketCategory).filter(
        models.TicketCategory.is_active == True
    ).order_by(models.TicketCategory.name).all()


@router.post("/categories", response_model=schemas.CategoryOut)
def create_category(data: schemas.CategoryCreate, db: Session = Depends(get_db), _=Depends(require_agent_or_admin)):
    cat = models.TicketCategory(**data.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/categories/{cat_id}", response_model=schemas.CategoryOut)
def update_category(cat_id: int, data: schemas.CategoryCreate, db: Session = Depends(get_db), _=Depends(require_agent_or_admin)):
    cat = db.query(models.TicketCategory).filter(models.TicketCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    for k, v in data.model_dump().items():
        setattr(cat, k, v)
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db), _=Depends(require_agent_or_admin)):
    cat = db.query(models.TicketCategory).filter(models.TicketCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    cat.is_active = False
    db.commit()
    return {"ok": True}


# ── Statuses ──────────────────────────────────────────
@router.get("/statuses", response_model=List[schemas.StatusOut])
def list_statuses(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(models.TicketStatus).filter(
        models.TicketStatus.is_active == True
    ).order_by(models.TicketStatus.name).all()


@router.post("/statuses", response_model=schemas.StatusOut)
def create_status(data: schemas.StatusCreate, db: Session = Depends(get_db), _=Depends(require_agent_or_admin)):
    status = models.TicketStatus(**data.model_dump())
    db.add(status)
    db.commit()
    db.refresh(status)
    return status


@router.put("/statuses/{status_id}", response_model=schemas.StatusOut)
def update_status(status_id: int, data: schemas.StatusCreate, db: Session = Depends(get_db), _=Depends(require_agent_or_admin)):
    st = db.query(models.TicketStatus).filter(models.TicketStatus.id == status_id).first()
    if not st:
        raise HTTPException(status_code=404, detail="Estado no encontrado")
    for k, v in data.model_dump().items():
        setattr(st, k, v)
    db.commit()
    db.refresh(st)
    return st


@router.delete("/statuses/{status_id}")
def delete_status(status_id: int, db: Session = Depends(get_db), _=Depends(require_agent_or_admin)):
    st = db.query(models.TicketStatus).filter(models.TicketStatus.id == status_id).first()
    if not st:
        raise HTTPException(status_code=404, detail="Estado no encontrado")
    if st.is_default:
        raise HTTPException(status_code=400, detail="No se puede eliminar el estado por defecto")
    st.is_active = False
    db.commit()
    return {"ok": True}


# ── Tickets ───────────────────────────────────────────
@router.get("", response_model=List[schemas.TicketListItem])
def list_tickets(
    status_id: Optional[int] = Query(None),
    priority: Optional[str] = Query(None),
    assigned_to_id: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.Ticket).filter(models.Ticket.deleted_at.is_(None))

    if current_user.role == models.UserRole.client:
        if current_user.company:
            company_ids = [
                r[0] for r in db.query(models.User.id).filter(
                    func.lower(models.User.company) == current_user.company.lower(),
                    models.User.is_active == True,
                ).all()
            ]
            q = q.filter(models.Ticket.client_id.in_(company_ids))
        else:
            q = q.filter(models.Ticket.client_id == current_user.id)

    if status_id:
        q = q.filter(models.Ticket.status_id == status_id)
    if priority:
        q = q.filter(models.Ticket.priority == priority)
    if assigned_to_id:
        q = q.filter(models.Ticket.assigned_to_id == assigned_to_id)
    if client_id and current_user.role != models.UserRole.client:
        q = q.filter(models.Ticket.client_id == client_id)
    if category:
        q = q.filter(models.Ticket.category == category)
    if search:
        search_filters = [
            models.Ticket.title.ilike(f"%{search}%"),
            models.Ticket.description.ilike(f"%{search}%"),
        ]
        if search.lstrip("#").isdigit():
            search_filters.append(models.Ticket.id == int(search.lstrip("#")))
        # Buscar por cliente (tabla users, campo client_id)
        client_ids = [r[0] for r in db.query(models.User.id).filter(
            or_(
                models.User.name.ilike(f"%{search}%"),
                models.User.company.ilike(f"%{search}%"),
                models.User.email.ilike(f"%{search}%"),
            )
        ).all()]
        if client_ids:
            search_filters.append(models.Ticket.client_id.in_(client_ids))
        # Buscar por contacto (tabla contacts, campo contact_id — tickets importados de FD)
        contact_ids = [r[0] for r in db.query(models.Contact.id).filter(
            or_(
                models.Contact.name.ilike(f"%{search}%"),
                models.Contact.company.ilike(f"%{search}%"),
                models.Contact.email.ilike(f"%{search}%"),
            )
        ).all()]
        if contact_ids:
            search_filters.append(models.Ticket.contact_id.in_(contact_ids))
        # Buscar por nombre del agente asignado
        agent_ids = [r[0] for r in db.query(models.User.id).filter(
            models.User.name.ilike(f"%{search}%"),
            models.User.role.in_(["agent", "admin", "supervisor", "superadmin"]),
        ).all()]
        if agent_ids:
            search_filters.append(models.Ticket.assigned_to_id.in_(agent_ids))
        q = q.filter(or_(*search_filters))
    if tag:
        q = q.filter(models.Ticket.tags.ilike(f"%{tag}%"))

    offset = (page - 1) * limit
    return q.order_by(models.Ticket.created_at.desc()).offset(offset).limit(limit).all()


@router.post("", response_model=schemas.TicketOut)
def create_ticket(
    data: schemas.TicketCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role == models.UserRole.client:
        data.client_id = current_user.id

    status = db.query(models.TicketStatus).filter(models.TicketStatus.id == data.status_id).first()
    if not status:
        raise HTTPException(status_code=400, detail="Estado no válido")

    # Vertical it_support: 'Cargador' y 'Categoría' son obligatorios.
    import os
    if os.getenv("PRODUCT_VERTICAL", "mps") == "it_support":
        # Los mantenimientos no llevan cargador (es un concepto de soporte de equipos).
        is_maint_req = (data.category or "").strip().lower() == "mantenimiento"
        if not is_maint_req and not (data.charger and data.charger.strip()):
            raise HTTPException(status_code=422, detail="El campo 'Cargador' es obligatorio")
        if not (data.category and data.category.strip()):
            raise HTTPException(status_code=422, detail="El campo 'Categoría' es obligatorio")

    ticket_data = data.model_dump()
    if not ticket_data.get("location"):
        client = db.query(models.User).filter(models.User.id == ticket_data["client_id"]).first()
        if client and client.address:
            ticket_data["location"] = client.address
    # Solicitud de mantenimiento: el cliente debe dar contacto y ubicación (obligatorios).
    is_maint = (ticket_data.get("category") or "").strip().lower() == "mantenimiento"
    if is_maint and current_user.role == models.UserRole.client:
        required = [
            ("nombre de contacto", ticket_data.get("maint_contact_name")),
            ("correo", ticket_data.get("maint_contact_email")),
            ("teléfono", ticket_data.get("maint_contact_phone")),
            ("ubicación", ticket_data.get("location")),
        ]
        missing = [label for label, val in required if not (val or "").strip()]
        if missing:
            raise HTTPException(status_code=422, detail="Faltan datos obligatorios: " + ", ".join(missing))
    ticket = models.Ticket(**ticket_data)
    ticket.created_by_id = current_user.id
    db.add(ticket)
    db.flush()
    if is_maint:
        ticket.maint_number = next_maint_number(db)

    # Calcular SLA deadline según prioridad y horario hábil
    now = datetime.utcnow()
    sla_min = _sla_minutes(ticket.priority, db)
    if status.name in PAUSE_STATUSES:
        ticket.sla_paused_at = now
        ticket.sla_elapsed_minutes = 0
    else:
        ticket.sla_deadline = add_business_minutes(now, sla_min)
        ticket.sla_last_resume = now
        ticket.sla_elapsed_minutes = 0

    entry = models.TicketTimeline(
        ticket_id=ticket.id,
        user_id=current_user.id,
        content="Ticket creado",
        entry_type="system",
    )
    db.add(entry)
    db.commit()
    db.refresh(ticket)

    # Mantenimiento: campana + push al staff (superadmin/admin/supervisor/agente).
    if is_maint:
        try:
            from notify import notify_roles
            cname = ticket.client.name if ticket.client else "Cliente"
            notify_roles(
                db,
                [models.UserRole.superadmin, models.UserRole.admin, models.UserRole.supervisor, models.UserRole.agent],
                f"🔧 Solicitud de mantenimiento: {cname}",
                ticket.title or "",
                url=f"/tickets/{ticket.id}", kind="maintenance",
                exclude_user_id=current_user.id,
            )
            db.commit()
        except Exception:
            db.rollback()

    # Aviso al agente asignado al crear (campana + push), salvo autoasignación.
    if ticket.assigned_to_id and ticket.assigned_to_id != current_user.id:
        try:
            from notify import create_notification
            create_notification(
                db, ticket.assigned_to_id,
                f"🎯 Te asignaron el ticket #{ticket.id}",
                ticket.title or "",
                url=f"/tickets/{ticket.id}", kind="ticket_assigned",
            )
            db.commit()
        except Exception:
            db.rollback()

    from routers.settings import try_send_ticket_open_email, try_send_new_ticket_to_agents
    background_tasks.add_task(try_send_ticket_open_email, ticket.id)
    background_tasks.add_task(try_send_new_ticket_to_agents, ticket.id)

    def _push_new_ticket(ticket_id: int, client_name: str, title: str, creator_id: int):
        import os
        from database import SessionLocal
        _db = SessionLocal()
        try:
            if os.getenv("PRODUCT_VERTICAL", "mps") == "it_support":
                # Campana in-app + push a superadmin/admin/supervisor/agente.
                from notify import notify_admins
                notify_admins(_db, f"🎫 Nuevo ticket de {client_name}", title,
                              url=f"/tickets/{ticket_id}", kind="ticket",
                              exclude_user_id=creator_id, include_agents=True)
                _db.commit()
            else:
                from push_helper import notify_agents
                notify_agents(_db, f"🎫 Nuevo ticket de {client_name}", title, f"/tickets/{ticket_id}", exclude_user_id=creator_id)
        finally:
            _db.close()
    if not is_maint:  # el mantenimiento ya avisó a su staff arriba (evita push duplicado)
        background_tasks.add_task(_push_new_ticket, ticket.id, ticket.client.name if ticket.client else "Cliente", ticket.title, current_user.id)

    return ticket


def _get_maint_ticket(db: Session, ticket_id: int) -> models.Ticket:
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id, models.Ticket.deleted_at.is_(None)).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    if (ticket.category or "").strip().lower() != "mantenimiento":
        raise HTTPException(status_code=400, detail="Este ticket no es de mantenimiento")
    return ticket


def _as_utc(dt: datetime) -> datetime:
    """Fechas sin zona se interpretan como hora de Panamá; se guardan en UTC."""
    from zoneinfo import ZoneInfo
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("America/Panama"))
    return dt.astimezone(timezone.utc)


@router.post("/{ticket_id}/maint-confirm", response_model=schemas.TicketOut)
def maint_confirm(
    ticket_id: int,
    data: schemas.MaintConfirmIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    """Confirma un mantenimiento: fija fecha/rango, asigna técnico, agenda la visita
    (calendario + Programado) y avisa al cliente por campana y correo."""
    from routers.calendar import create_ticket_visit
    from routers.settings import try_send_maintenance_confirmed_email, _fmt_panama
    ticket = _get_maint_ticket(db, ticket_id)
    already = db.query(models.TicketVisit).filter(
        models.TicketVisit.ticket_id == ticket.id, models.TicketVisit.status == "scheduled").count()
    if already:
        raise HTTPException(status_code=400, detail="Este mantenimiento ya está confirmado. Usa reprogramar.")

    start = _as_utc(data.scheduled_at)
    end = _as_utc(data.confirmed_end) if data.confirmed_end else start + timedelta(minutes=data.duration_minutes)
    if end <= start:
        raise HTTPException(status_code=400, detail="La fecha de fin debe ser posterior al inicio")

    if data.equipment is not None:
        ticket.maint_equipment = data.equipment
    if data.location and data.location.strip():
        ticket.location = data.location.strip()
    # Técnico obligatorio: debe ser un usuario activo de staff (admin, supervisor o agente).
    tech = db.query(models.User).filter(models.User.id == data.assigned_to_id).first()
    if not tech or not tech.is_active or tech.role not in (
            models.UserRole.admin, models.UserRole.supervisor, models.UserRole.agent):
        raise HTTPException(status_code=400, detail="Asigna un técnico válido (admin, supervisor o agente activo)")
    ticket.assigned_to_id = tech.id
    ticket.maint_confirmed_start = start
    ticket.maint_confirmed_end = end
    ticket.duration_minutes = data.duration_minutes
    db.commit()

    # Visita en la Agenda. El correo de reagendado se descarta (BackgroundTasks propio
    # no ejecutado): el correo de mantenimiento es el único aviso al contacto.
    create_ticket_visit(
        schemas.CalendarVisitCreate(
            ticket_id=ticket.id, scheduled_at=start, duration_minutes=data.duration_minutes,
            location=ticket.location, subject=ticket.title, notes=data.notes,
        ),
        BackgroundTasks(), db, current_user,
    )
    db.refresh(ticket)

    try:
        from notify import create_notification
        create_notification(
            db, ticket.client_id,
            "🛠️ Mantenimiento confirmado",
            f"Atención programada: {_fmt_panama(start)} → {_fmt_panama(end)}",
            url=f"/tickets/{ticket.id}", kind="maintenance",
        )
        db.commit()
    except Exception:
        db.rollback()
    # Aviso al técnico asignado (campana + push).
    if ticket.assigned_to_id:
        try:
            from notify import create_notification as _notify
            _notify(db, ticket.assigned_to_id, "Mantenimiento asignado",
                    f"{ticket.title} · {_fmt_panama(start)} → {_fmt_panama(end)}",
                    url=f"/tickets/{ticket.id}", kind="maintenance")
            db.commit()
        except Exception:
            db.rollback()
    background_tasks.add_task(try_send_maintenance_confirmed_email, ticket.id, False)
    return ticket


@router.post("/{ticket_id}/maint-reschedule", response_model=schemas.TicketOut)
def maint_reschedule(
    ticket_id: int,
    data: schemas.MaintRescheduleIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    """Reprograma o extiende un mantenimiento ya confirmado: mueve la visita del calendario,
    deja constancia en la línea de tiempo, avisa al cliente y reenvía el correo."""
    from routers.calendar import reschedule_ticket_visit
    from routers.settings import try_send_maintenance_confirmed_email, _fmt_panama
    ticket = _get_maint_ticket(db, ticket_id)
    visit = db.query(models.TicketVisit).filter(
        models.TicketVisit.ticket_id == ticket.id, models.TicketVisit.status == "scheduled",
    ).order_by(models.TicketVisit.scheduled_at.desc()).first()
    if not visit:
        raise HTTPException(status_code=400, detail="Aún no hay una fecha confirmada para reprogramar")

    start = _as_utc(data.scheduled_at)
    end = _as_utc(data.confirmed_end) if data.confirmed_end else start + timedelta(minutes=data.duration_minutes)
    if end <= start:
        raise HTTPException(status_code=400, detail="La fecha de fin debe ser posterior al inicio")

    reschedule_ticket_visit(
        visit.id,
        schemas.CalendarVisitUpdate(scheduled_at=start, duration_minutes=data.duration_minutes, location=ticket.location),
        db, current_user,
    )
    old = _fmt_panama(ticket.maint_confirmed_start)
    ticket.maint_confirmed_start = start
    ticket.maint_confirmed_end = end
    ticket.duration_minutes = data.duration_minutes
    detalle = f" Motivo: {data.reason.strip()}" if data.reason and data.reason.strip() else ""
    db.add(models.TicketTimeline(
        ticket_id=ticket.id, user_id=current_user.id, entry_type="calendar",
        content=f"Mantenimiento reprogramado de {old} a {_fmt_panama(start)} → {_fmt_panama(end)}.{detalle}",
    ))
    db.commit()
    db.refresh(ticket)

    try:
        from notify import create_notification
        create_notification(
            db, ticket.client_id, "🛠️ Mantenimiento reprogramado",
            f"Nueva atención: {_fmt_panama(start)} → {_fmt_panama(end)}",
            url=f"/tickets/{ticket.id}", kind="maintenance",
        )
        db.commit()
    except Exception:
        db.rollback()
    background_tasks.add_task(try_send_maintenance_confirmed_email, ticket.id, True)
    return ticket


def next_maint_number(db: Session) -> str:
    """Número propio de mantenimientos: MANT-0001, MANT-0002… (independiente de los tickets)."""
    rows = db.query(models.Ticket.maint_number).filter(models.Ticket.maint_number.isnot(None)).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    return f"MANT-{(max(nums) if nums else 0) + 1:04d}"


_next_folio = next_maint_number


def _maint_report_payload(ticket: models.Ticket) -> dict:
    import json as _json
    def _load(s, default):
        try:
            return _json.loads(s) if s else default
        except Exception:
            return default
    return {
        "id": ticket.id,
        "title": ticket.title,
        "folio": ticket.maint_report_folio,
        "maint_type": ticket.maint_type,
        "equipment": _load(ticket.maint_equipment, []),
        "location": ticket.location,
        "requested_date": ticket.maint_requested_date.isoformat() if ticket.maint_requested_date else None,
        "confirmed_start": ticket.maint_confirmed_start.isoformat() if ticket.maint_confirmed_start else None,
        "confirmed_end": ticket.maint_confirmed_end.isoformat() if ticket.maint_confirmed_end else None,
        "technician": ticket.assigned_agent.name if ticket.assigned_agent else None,
        "client": {"name": ticket.client.name if ticket.client else "", "company": ticket.client.company if ticket.client else ""},
        "contact": {"name": ticket.maint_contact_name, "email": ticket.maint_contact_email, "phone": ticket.maint_contact_phone},
        "work_done": ticket.maint_work_done,
        "observations": ticket.maint_observations,
        "recommendations": ticket.maint_recommendations,
        "checklist": _load(ticket.maint_checklist, []),
        "client_signature": ticket.maint_client_signature,
        "client_sign_name": ticket.maint_client_sign_name,
        "client_sign_at": ticket.maint_client_sign_at.isoformat() if ticket.maint_client_sign_at else None,
    }


@router.get("/{ticket_id}/maint-report")
def get_maint_report(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Datos del informe técnico. Staff o el cliente dueño del ticket."""
    from routers.system import maint_feature_on
    ticket = _get_maint_ticket(db, ticket_id)
    if current_user.role == models.UserRole.client:
        if ticket.client_id != current_user.id:
            raise HTTPException(status_code=403, detail="No autorizado")
        if not maint_feature_on(db, "tech_report"):
            raise HTTPException(status_code=404, detail="El informe técnico no está disponible")
    return _maint_report_payload(ticket)


@router.put("/{ticket_id}/maint-report")
def save_maint_report(
    ticket_id: int,
    data: schemas.MaintReportIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    """Guarda el informe técnico y asigna folio (la primera vez). Registra la firma del cliente."""
    from routers.system import maint_feature_on
    if not maint_feature_on(db, "tech_report"):
        raise HTTPException(status_code=403, detail="El informe técnico está desactivado en la configuración")
    ticket = _get_maint_ticket(db, ticket_id)
    if data.work_done is not None:
        ticket.maint_work_done = data.work_done
    if data.observations is not None:
        ticket.maint_observations = data.observations
    if data.recommendations is not None:
        ticket.maint_recommendations = data.recommendations
    if data.checklist is not None and maint_feature_on(db, "checklist"):
        ticket.maint_checklist = data.checklist
    if data.client_signature and maint_feature_on(db, "client_signature"):
        ticket.maint_client_signature = data.client_signature
        ticket.maint_client_sign_name = (data.client_sign_name or ticket.maint_contact_name or "").strip() or None
        ticket.maint_client_sign_at = datetime.now(timezone.utc)
    new_folio = not ticket.maint_report_folio
    if new_folio:
        # El folio del informe es el mismo número del mantenimiento.
        ticket.maint_report_folio = ticket.maint_number or next_maint_number(db)
        ticket.maint_number = ticket.maint_report_folio
    db.add(models.TicketTimeline(
        ticket_id=ticket.id, user_id=current_user.id, entry_type="system",
        content=(f"Informe técnico {ticket.maint_report_folio} generado" if new_folio else
                 f"Informe técnico {ticket.maint_report_folio} actualizado"),
    ))
    db.commit()
    db.refresh(ticket)
    return _maint_report_payload(ticket)


@router.post("/{ticket_id}/maint-report/email")
def email_maint_report(
    ticket_id: int,
    data: schemas.MaintEmailIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    """Envía el informe técnico (PDF generado en el navegador) al contacto del mantenimiento."""
    import base64 as _b64
    from routers.settings import send_maintenance_report_email
    from routers.system import maint_feature_on
    if not maint_feature_on(db, "tech_report"):
        raise HTTPException(status_code=403, detail="El informe técnico está desactivado en la configuración")
    ticket = _get_maint_ticket(db, ticket_id)
    if not ticket.maint_report_folio:
        raise HTTPException(status_code=400, detail="Guarda el informe antes de enviarlo")
    try:
        pdf = _b64.b64decode(data.pdf_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="PDF inválido")
    filename = f"{ticket.maint_report_folio}.pdf"
    ok, msg = send_maintenance_report_email(db, ticket, pdf, filename)
    if not ok:
        raise HTTPException(status_code=503, detail=msg)
    db.add(models.TicketTimeline(
        ticket_id=ticket.id, user_id=current_user.id, entry_type="system",
        content=f"Informe técnico {ticket.maint_report_folio} enviado al contacto ({ticket.maint_contact_email or 'correo del cliente'})",
    ))
    db.commit()
    return {"ok": True, "message": msg}


@router.get("/assigned-counts")
def assigned_counts(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """Conteo de tickets ABIERTOS (no resueltos/cerrados): 'mine' = asignados a mí, 'all' = todos.
    Se usa para el badge del menú (agente ve los suyos; admin/supervisor ven el global)."""
    resolved_ids = [s.id for s in db.query(models.TicketStatus).filter(
        func.lower(models.TicketStatus.name).in_(_RESOLVED_STATUS_NAMES)).all()]
    base = db.query(models.Ticket).filter(models.Ticket.deleted_at.is_(None))
    if resolved_ids:
        base = base.filter(~models.Ticket.status_id.in_(resolved_ids))
    all_open = base.count()
    mine_open = base.filter(models.Ticket.assigned_to_id == current_user.id).count()
    return {"mine": mine_open, "all": all_open}


@router.get("/{ticket_id}", response_model=schemas.TicketOut)
def get_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    if not _client_can_access_ticket(ticket, current_user, db):
        raise HTTPException(status_code=403, detail="Sin acceso a este ticket")

    result = schemas.TicketOut.model_validate(ticket)
    if ticket.parent_id:
        parent = db.query(models.Ticket).filter(models.Ticket.id == ticket.parent_id).first()
        result.parent = schemas.TicketRef.model_validate(parent) if parent else None
    children = db.query(models.Ticket).filter(models.Ticket.parent_id == ticket_id).all()
    result.children = [schemas.TicketRef.model_validate(c) for c in children]
    return result


class LinkRequest(BaseModel):
    parent_id: int


@router.post("/{ticket_id}/link")
def link_ticket(
    ticket_id: int,
    data: LinkRequest,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    if data.parent_id == ticket_id:
        raise HTTPException(status_code=400, detail="Un ticket no puede ser su propio padre")
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    parent = db.query(models.Ticket).filter(models.Ticket.id == data.parent_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Ticket primario no encontrado")
    if parent.parent_id == ticket_id:
        raise HTTPException(status_code=400, detail="Referencia circular: ese ticket ya está vinculado a este")
    ticket.parent_id = data.parent_id
    db.commit()
    return {"ok": True}


@router.delete("/{ticket_id}/link")
def unlink_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    ticket.parent_id = None
    db.commit()
    return {"ok": True}


@router.put("/{ticket_id}", response_model=schemas.TicketOut)
def update_ticket(
    ticket_id: int,
    data: schemas.TicketUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    if current_user.role == models.UserRole.client:
        if ticket.client_id != current_user.id:
            raise HTTPException(status_code=403, detail="Solo puedes modificar tus propios tickets")
    elif not _client_can_access_ticket(ticket, current_user, db):
        raise HTTPException(status_code=403, detail="Sin acceso a este ticket")

    old_status_id = ticket.status_id
    old_assigned = ticket.assigned_to_id

    update_data = data.model_dump(exclude_none=True)
    if current_user.role == models.UserRole.client:
        update_data.pop('client_id', None)
    for k, v in update_data.items():
        setattr(ticket, k, v)
    # Un ticket recategorizado como mantenimiento recibe su número propio.
    if (ticket.category or "").strip().lower() == "mantenimiento" and not ticket.maint_number:
        ticket.maint_number = next_maint_number(db)

    # 'assigned_to_id' explícito a null debe DESASIGNAR (exclude_none lo omitiría).
    if 'assigned_to_id' in data.model_fields_set and current_user.role != models.UserRole.client:
        ticket.assigned_to_id = data.assigned_to_id

    # Track status change for post-commit email
    _old_status_name = None
    _new_status_name = None

    # Registrar cambios en la línea de tiempo
    if data.status_id and data.status_id != old_status_id:
        new_status = db.query(models.TicketStatus).filter(models.TicketStatus.id == data.status_id).first()
        old_status = db.query(models.TicketStatus).filter(models.TicketStatus.id == old_status_id).first()
        _old_status_name = old_status.name if old_status else "?"
        _new_status_name = new_status.name if new_status else "?"
        entry = models.TicketTimeline(
            ticket_id=ticket.id,
            user_id=current_user.id,
            content=f"Estado cambiado de '{_old_status_name}' a '{_new_status_name}'",
            entry_type="status_change",
        )
        db.add(entry)
        if new_status and new_status.name.lower() in ["resuelto", "resolved", "cerrado", "closed", "entregado"]:
            was_closed = ticket.closed_at is not None
            ticket.closed_at = datetime.now(timezone.utc)
            # Auto-asignación al resolver: si está sin asignar, el que resuelve lo toma.
            _maybe_autoassign(db, ticket, current_user, "resolver")
            # Atención de un plan de mantenimiento: avanza la recurrencia (solo al cerrar por primera vez).
            if ticket.maint_plan_id and not was_closed:
                from routers.maintenance import advance_plan_after_service
                advance_plan_after_service(db, ticket)

        # SLA: pausar o reanudar según el nuevo estado
        now = datetime.utcnow()
        old_paused = old_status and old_status.name in PAUSE_STATUSES
        new_paused = new_status and new_status.name in PAUSE_STATUSES
        if not old_paused and new_paused:
            # Pausar: acumular minutos hábiles transcurridos desde el último inicio
            if ticket.sla_last_resume:
                elapsed = elapsed_business_minutes(ticket.sla_last_resume, now)
                ticket.sla_elapsed_minutes = (ticket.sla_elapsed_minutes or 0) + elapsed
            ticket.sla_paused_at = now
        elif old_paused and not new_paused:
            # Reanudar: recalcular deadline desde ahora con el tiempo restante
            total = _sla_minutes(ticket.priority, db)
            remaining = max(total - (ticket.sla_elapsed_minutes or 0), 0)
            ticket.sla_deadline = add_business_minutes(now, remaining)
            ticket.sla_paused_at = None
            ticket.sla_last_resume = now

    if data.assigned_to_id is not None and data.assigned_to_id != old_assigned:
        agent = db.query(models.User).filter(models.User.id == data.assigned_to_id).first()
        entry = models.TicketTimeline(
            ticket_id=ticket.id,
            user_id=current_user.id,
            content=f"Ticket asignado a {agent.name if agent else 'agente'}",
            entry_type="assignment",
        )
        db.add(entry)
        # Aviso al agente asignado (campana + push), salvo autoasignación.
        if data.assigned_to_id != current_user.id:
            try:
                from notify import create_notification
                create_notification(
                    db, data.assigned_to_id,
                    f"🎯 Te asignaron el ticket #{ticket.id}",
                    ticket.title or "",
                    url=f"/tickets/{ticket.id}", kind="ticket_assigned",
                )
            except Exception:
                pass

    db.commit()
    db.refresh(ticket)

    if _old_status_name and _new_status_name:
        from routers.settings import try_send_status_change_email
        background_tasks.add_task(try_send_status_change_email, ticket.id, _old_status_name, _new_status_name, current_user.name)

    return ticket


@router.delete("/{ticket_id}")
def delete_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    ticket = db.query(models.Ticket).filter(
        models.Ticket.id == ticket_id,
        models.Ticket.deleted_at.is_(None),
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    ticket.deleted_at = datetime.now(timezone.utc)
    _pause_sla_for_trash(ticket)
    log_action(db, current_user, "delete", "ticket", ticket.id, ticket.title)
    db.commit()
    return {"ok": True}


@router.post("/bulk-delete")
def bulk_delete_tickets(
    data: BulkDeleteRequest,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    if not data.ids:
        return {"ok": True, "deleted": 0}
    now = datetime.now(timezone.utc)
    tickets = db.query(models.Ticket).filter(
        models.Ticket.id.in_(data.ids),
        models.Ticket.deleted_at.is_(None),
    ).all()
    for t in tickets:
        t.deleted_at = now
        _pause_sla_for_trash(t)
        log_action(db, None, "delete", "ticket", t.id, t.title)
    db.commit()
    return {"ok": True, "deleted": len(tickets)}


# ── Timeline ──────────────────────────────────────────
@router.get("/{ticket_id}/timeline", response_model=List[schemas.TimelineOut])
def get_timeline(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    if not _client_can_access_ticket(ticket, current_user, db):
        raise HTTPException(status_code=403)

    q = db.query(models.TicketTimeline).filter(models.TicketTimeline.ticket_id == ticket_id)
    if current_user.role == models.UserRole.client:
        q = q.filter(models.TicketTimeline.is_internal == False)
    return q.order_by(models.TicketTimeline.created_at).all()


@router.post("/{ticket_id}/timeline", response_model=schemas.TimelineOut)
def add_timeline_entry(
    ticket_id: int,
    data: schemas.TimelineCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    if not _client_can_access_ticket(ticket, current_user, db):
        raise HTTPException(status_code=403)

    # Optional status change alongside the comment
    status_changed = False
    old_status_name = new_status_name = ""
    if data.new_status_id and current_user.role != models.UserRole.client:
        old_status_name = ticket.status_rel.name if ticket.status_rel else "—"
        ticket.status_id = data.new_status_id
        db.flush()
        db.refresh(ticket)
        new_status_name = ticket.status_rel.name if ticket.status_rel else "—"
        status_changed = True
        status_entry = models.TicketTimeline(
            ticket_id=ticket_id,
            user_id=current_user.id,
            content=f"Estado cambiado de «{old_status_name}» a «{new_status_name}»",
            entry_type="status_change",
            is_internal=False,
        )
        db.add(status_entry)

    bcc = (data.bcc_email or "").strip() or None
    cc = (data.cc_email or "").strip() or (ticket.cc_email or "").strip() or None

    entry = models.TicketTimeline(
        ticket_id=ticket_id,
        user_id=current_user.id,
        content=data.content,
        entry_type=data.entry_type,
        is_internal=data.is_internal if current_user.role != models.UserRole.client else False,
    )

    if data.entry_type == "comment" and not entry.is_internal:
        import json
        meta = {}
        if cc:
            meta["cc"] = cc
        if bcc:
            meta["bcc"] = bcc
        if meta:
            entry.metadata_json = json.dumps(meta)

    db.add(entry)

    # Auto-asignación: si el staff responde (comentario público) o resuelve, y el ticket
    # está sin asignar, se le asigna. No reasigna si ya tiene agente.
    is_public_comment = (data.entry_type == "comment" and not entry.is_internal)
    resolved_now = status_changed and _is_resolved_status(new_status_name)
    if is_public_comment or resolved_now:
        _maybe_autoassign(db, ticket, current_user, "resolver" if resolved_now else "responder")

    db.commit()
    db.refresh(entry)

    if status_changed:
        from routers.settings import try_send_status_change_email, try_notify_agents_of_activity
        comment_for_email = entry.content if (entry.entry_type == "comment" and not entry.is_internal) else None
        background_tasks.add_task(try_send_status_change_email, ticket_id, old_status_name, new_status_name, current_user.name, comment_content=comment_for_email, bcc_email=bcc)
        status_detail = f"«{old_status_name}» → «{new_status_name}»"
        if comment_for_email:
            status_detail += f"\n\n{comment_for_email}"
        background_tasks.add_task(try_notify_agents_of_activity, ticket_id, current_user.id, "status_change", status_detail)
    elif entry.entry_type == "comment" and not entry.is_internal:
        from routers.settings import try_send_comment_email, try_notify_agents_of_activity
        background_tasks.add_task(try_send_comment_email, ticket_id, entry.content, current_user.name, bcc_email=bcc, cc_email=cc, attachment_ids=data.attachment_ids or [], attach_invoice_pdfs=data.attach_invoice_pdfs)
        event = "client_comment" if current_user.role == models.UserRole.client else "comment"
        background_tasks.add_task(try_notify_agents_of_activity, ticket_id, current_user.id, event, entry.content)

        if current_user.role == models.UserRole.client:
            def _push_client_comment(t_id: int, client_name: str, content: str, commenter_id: int):
                from database import SessionLocal
                from push_helper import notify_agents
                _db = SessionLocal()
                try:
                    preview = content[:80] + ("…" if len(content) > 80 else "")
                    notify_agents(_db, f"💬 Comentario de {client_name}", preview, f"/tickets/{t_id}", exclude_user_id=commenter_id)
                finally:
                    _db.close()
            background_tasks.add_task(_push_client_comment, ticket_id, current_user.name, entry.content, current_user.id)

    return entry


@router.delete("/{ticket_id}/timeline/{entry_id}", status_code=204)
def delete_timeline_entry(
    ticket_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    entry = db.query(models.TicketTimeline).filter(
        models.TicketTimeline.id == entry_id,
        models.TicketTimeline.ticket_id == ticket_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Comentario no encontrado")
    if entry.entry_type != "comment":
        raise HTTPException(status_code=400, detail="Solo se pueden eliminar comentarios")
    is_owner = entry.user_id == current_user.id
    is_admin = current_user.role in (models.UserRole.admin, models.UserRole.supervisor, models.UserRole.superadmin)
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403)
    db.delete(entry)
    db.commit()


# ── Time Tracking ─────────────────────────────────────────────────────────
@router.get("/{ticket_id}/time-logs", response_model=List[schemas.TimeLogOut])
def list_time_logs(
    ticket_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    return db.query(models.TicketTimeLog).filter(
        models.TicketTimeLog.ticket_id == ticket_id
    ).order_by(models.TicketTimeLog.created_at.desc()).all()


@router.post("/{ticket_id}/time-logs", response_model=schemas.TimeLogOut)
def add_time_log(
    ticket_id: int,
    data: schemas.TimeLogCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    if data.minutes <= 0:
        raise HTTPException(status_code=400, detail="Los minutos deben ser positivos")
    log = models.TicketTimeLog(
        ticket_id=ticket_id,
        user_id=current_user.id,
        minutes=data.minutes,
        description=data.description,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.delete("/{ticket_id}/time-logs/{log_id}", status_code=204)
def delete_time_log(
    ticket_id: int,
    log_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    log = db.query(models.TicketTimeLog).filter(
        models.TicketTimeLog.id == log_id,
        models.TicketTimeLog.ticket_id == ticket_id,
    ).first()
    if not log:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    if log.user_id != current_user.id and current_user.role not in (models.UserRole.admin, models.UserRole.supervisor, models.UserRole.superadmin):
        raise HTTPException(status_code=403)
    db.delete(log)
    db.commit()


# ── CSAT Survey ───────────────────────────────────────────────────────────
class CsatRequest(BaseModel):
    rating: int
    comment: Optional[str] = None


@router.post("/{ticket_id}/csat")
def submit_csat(
    ticket_id: int,
    data: CsatRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if data.rating < 1 or data.rating > 5:
        raise HTTPException(status_code=400, detail="La calificación debe ser entre 1 y 5")
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404)
    if current_user.role != models.UserRole.client or ticket.client_id != current_user.id:
        raise HTTPException(status_code=403, detail="Solo el cliente puede calificar")
    if ticket.csat_rating is not None:
        raise HTTPException(status_code=400, detail="Ya has enviado una calificación")
    ticket.csat_rating = data.rating
    ticket.csat_comment = data.comment
    ticket.csat_submitted_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}
