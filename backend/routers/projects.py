from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone

import models, schemas
from database import get_db
from auth import get_current_user, require_agent_or_admin

router = APIRouter(prefix="/api/projects", tags=["projects"])

_RESOLVED = {"resuelto", "resolved", "cerrado", "closed"}


def _enrich(project: models.Project, db: Session) -> schemas.ProjectOut:
    tickets = db.query(models.Ticket).filter(
        models.Ticket.project_id == project.id,
        models.Ticket.deleted_at.is_(None),
    ).all()
    total = len(tickets)
    resolved = sum(1 for t in tickets if (t.status_rel.name or "").lower() in _RESOLVED)

    # Weighted progress: use weights when all tickets have one assigned
    weighted = [t for t in tickets if t.project_weight is not None]
    if weighted and len(weighted) == total and total > 0:
        total_w    = sum(t.project_weight for t in tickets)
        resolved_w = sum(t.project_weight for t in tickets if (t.status_rel.name or "").lower() in _RESOLVED)
        progress = round(resolved_w / total_w * 100) if total_w else 0
    else:
        progress = round(resolved / total * 100) if total else 0

    out = schemas.ProjectOut.model_validate(project)
    out.total_tickets = total
    out.resolved_tickets = resolved
    out.progress = progress
    return out


@router.get("", response_model=List[schemas.ProjectOut])
def list_projects(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    q = db.query(models.Project).filter(models.Project.deleted_at.is_(None))
    if search:
        q = q.filter(models.Project.name.ilike(f"%{search}%"))
    if status:
        q = q.filter(models.Project.status == status)
    projects = q.order_by(models.Project.created_at.desc()).all()
    return [_enrich(p, db) for p in projects]


@router.post("", response_model=schemas.ProjectOut)
def create_project(
    data: schemas.ProjectCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    project = models.Project(**data.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    # Aviso a admin/supervisor (campana + push) de proyecto nuevo — solo it_support.
    try:
        from notify import notify_admins
        notify_admins(
            db, "🗂️ Nuevo proyecto", project.name or "",
            url="/projects", kind="proyecto", exclude_user_id=current_user.id,
        )
        db.commit()
    except Exception:
        db.rollback()
    return _enrich(project, db)


@router.get("/{project_id}", response_model=schemas.ProjectOut)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    project = db.query(models.Project).filter(
        models.Project.id == project_id,
        models.Project.deleted_at.is_(None),
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    return _enrich(project, db)


@router.put("/{project_id}", response_model=schemas.ProjectOut)
def update_project(
    project_id: int,
    data: schemas.ProjectUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    project = db.query(models.Project).filter(
        models.Project.id == project_id,
        models.Project.deleted_at.is_(None),
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return _enrich(project, db)


@router.delete("/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    project = db.query(models.Project).filter(
        models.Project.id == project_id,
        models.Project.deleted_at.is_(None),
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    project.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


@router.get("/{project_id}/tickets", response_model=List[schemas.TicketListItem])
def list_project_tickets(
    project_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    project = db.query(models.Project).filter(
        models.Project.id == project_id,
        models.Project.deleted_at.is_(None),
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    return db.query(models.Ticket).filter(
        models.Ticket.project_id == project_id,
        models.Ticket.deleted_at.is_(None),
    ).order_by(models.Ticket.created_at.desc()).all()


@router.post("/{project_id}/tickets/{ticket_id}")
def link_ticket(
    project_id: int,
    ticket_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    project = db.query(models.Project).filter(
        models.Project.id == project_id, models.Project.deleted_at.is_(None)
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    ticket = db.query(models.Ticket).filter(
        models.Ticket.id == ticket_id, models.Ticket.deleted_at.is_(None)
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    ticket.project_id = project_id
    db.commit()
    return {"ok": True}


@router.delete("/{project_id}/tickets/{ticket_id}")
def unlink_ticket(
    project_id: int,
    ticket_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    ticket = db.query(models.Ticket).filter(
        models.Ticket.id == ticket_id,
        models.Ticket.project_id == project_id,
    ).first()
    if not ticket:
        raise HTTPException(status_code=404)
    ticket.project_id = None
    ticket.project_weight = None
    db.commit()
    return {"ok": True}


@router.put("/{project_id}/tickets/{ticket_id}/weight")
def set_ticket_weight(
    project_id: int,
    ticket_id: int,
    data: dict,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    """Asigna o elimina el peso porcentual de un ticket dentro de un proyecto."""
    ticket = db.query(models.Ticket).filter(
        models.Ticket.id == ticket_id,
        models.Ticket.project_id == project_id,
        models.Ticket.deleted_at.is_(None),
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado en este proyecto")
    weight = data.get("weight")
    if weight is None:
        ticket.project_weight = None
    else:
        try:
            w = float(weight)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="El peso debe ser un número")
        if w < 0 or w > 100:
            raise HTTPException(status_code=400, detail="El peso debe estar entre 0 y 100")
        ticket.project_weight = w
    db.commit()
    return {"ok": True, "ticket_id": ticket_id, "weight": ticket.project_weight}
