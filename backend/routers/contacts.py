from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import datetime, timezone
from database import get_db
import models, schemas
from auth import get_current_user, require_agent_or_admin, require_staff
from audit_helper import log_action

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


def _ticket_count(db: Session, user_id: int) -> int:
    return db.query(func.count(models.Ticket.id)).filter(
        models.Ticket.client_id == user_id
    ).scalar() or 0


@router.get("")
def list_contacts(
    q: Optional[str] = Query(None),
    limit: int = Query(300, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    """Lista unificada: clientes del sistema + contactos manuales."""
    result = []

    # ── Usuarios del sistema (client + agent + ventas) ──
    system_roles = [models.UserRole.client, models.UserRole.agent, models.UserRole.ventas]
    user_query = db.query(models.User).filter(
        models.User.role.in_(system_roles),
        models.User.is_active == True,
    )
    if q:
        like = f"%{q}%"
        user_query = user_query.filter(
            models.User.name.ilike(like)
            | models.User.email.ilike(like)
            | models.User.company.ilike(like)
            | models.User.phone.ilike(like)
        )
    for u in user_query.order_by(models.User.created_at.desc()).all():
        is_client = u.role == models.UserRole.client
        cat = u.client_category
        result.append({
            "id": u.id,
            "source": "client" if is_client else "agent",
            "role": u.role.value,
            "name": u.name,
            "email": u.email,
            "phone": u.phone or "",
            "company": u.company or "",
            "address": u.address or "",
            "notes": "",
            "ticket_count": _ticket_count(db, u.id) if is_client else 0,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "client_category_id": u.client_category_id,
            "client_category": {"id": cat.id, "name": cat.name, "color": cat.color} if cat else None,
        })

    # Emails ya cubiertos por usuarios del sistema (para deduplicar)
    system_emails = {r["email"].strip().lower() for r in result if r.get("email")}
    system_names  = {r["name"].strip().lower() for r in result if r.get("name")}

    # ── Contactos manuales ──
    contact_query = db.query(models.Contact).filter(models.Contact.deleted_at.is_(None))
    if q:
        like = f"%{q}%"
        contact_query = contact_query.filter(
            models.Contact.name.ilike(like)
            | models.Contact.email.ilike(like)
            | models.Contact.company.ilike(like)
            | models.Contact.phone.ilike(like)
        )
    for c in contact_query.order_by(models.Contact.created_at.desc()).all():
        email_norm = (c.email or "").strip().lower()
        name_norm  = (c.name  or "").strip().lower()
        # Si ya existe usuario del sistema con ese email, auto-sanear: soft-delete el contacto duplicado
        if email_norm and email_norm in system_emails:
            c.deleted_at = datetime.now(timezone.utc)
            db.commit()
            continue
        # Omitir también si el nombre coincide exactamente (sin email en el contacto)
        if not email_norm and name_norm and name_norm in system_names:
            continue
        result.append({
            "id": c.id,
            "source": "contact",
            "name": c.name,
            "email": c.email or "",
            "phone": c.phone or "",
            "company": c.company or "",
            "ruc": c.ruc or "",
            "address": c.address or "",
            "notes": c.notes or "",
            "ticket_count": 0,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })

    result.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return result[offset : offset + limit]


@router.post("", status_code=201)
def create_contact(
    data: schemas.ContactCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    email = (data.email or "").strip().lower()
    if email:
        if db.query(models.User).filter(models.User.email == email).first():
            raise HTTPException(status_code=409, detail="Ya existe un usuario del sistema con ese email")
        if db.query(models.Contact).filter(
            models.Contact.email == email,
            models.Contact.deleted_at.is_(None),
        ).first():
            raise HTTPException(status_code=409, detail="Ya existe un contacto con ese email")

    name_norm = (data.name or "").strip().lower()
    company_norm = (data.company or "").strip().lower()
    if name_norm:
        dup_user = db.query(models.User).filter(
            models.User.name.ilike(data.name.strip()),
        ).first()
        if dup_user and (not company_norm or (dup_user.company or "").strip().lower() == company_norm):
            raise HTTPException(status_code=409, detail=f"Ya existe un usuario del sistema con ese nombre: {dup_user.name}")

        dup_contact = db.query(models.Contact).filter(
            models.Contact.name.ilike(data.name.strip()),
            models.Contact.deleted_at.is_(None),
        ).first()
        if dup_contact and (not company_norm or (dup_contact.company or "").strip().lower() == company_norm):
            raise HTTPException(status_code=409, detail=f"Ya existe un contacto con ese nombre: {dup_contact.name}")

    contact = models.Contact(**data.model_dump())
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return {
        "id": contact.id,
        "source": "contact",
        "name": contact.name,
        "email": contact.email or "",
        "phone": contact.phone or "",
        "company": contact.company or "",
        "ruc": contact.ruc or "",
        "address": contact.address or "",
        "notes": contact.notes or "",
        "ticket_count": 0,
        "created_at": contact.created_at.isoformat() if contact.created_at else None,
    }


@router.put("/{contact_id}")
def update_contact(
    contact_id: int,
    data: schemas.ContactUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contacto no encontrado")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(contact, field, value)
    db.commit()
    db.refresh(contact)
    return {
        "id": contact.id,
        "source": "contact",
        "name": contact.name,
        "email": contact.email or "",
        "phone": contact.phone or "",
        "company": contact.company or "",
        "ruc": contact.ruc or "",
        "address": contact.address or "",
        "notes": contact.notes or "",
        "ticket_count": 0,
        "created_at": contact.created_at.isoformat() if contact.created_at else None,
    }


@router.delete("/{contact_id}")
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    contact = db.query(models.Contact).filter(
        models.Contact.id == contact_id,
        models.Contact.deleted_at.is_(None),
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contacto no encontrado")
    contact.deleted_at = datetime.now(timezone.utc)
    log_action(db, current_user, "delete", "contacto", contact.id, contact.name or f"#{contact.id}")
    db.commit()
    return {"ok": True}


@router.get("/client/{user_id}/tickets")
def get_client_tickets(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    """Tickets de un cliente del sistema."""
    tickets = (
        db.query(models.Ticket)
        .filter(models.Ticket.client_id == user_id)
        .order_by(models.Ticket.created_at.desc())
        .limit(10)
        .all()
    )
    return [
        {
            "id": t.id,
            "title": t.title,
            "priority": t.priority,
            "status": {"name": t.status_rel.name, "color": t.status_rel.color} if t.status_rel else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in tickets
    ]
