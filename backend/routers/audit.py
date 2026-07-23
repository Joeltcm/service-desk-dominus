from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db
from auth import require_agent_or_admin
import models

router = APIRouter(prefix="/api/audit", tags=["audit"])

ACTION_LABELS = {
    "create":           "Creación",
    "update":           "Modificación",
    "delete":           "Eliminación",
    "restore":          "Restauración",
    "permanent_delete": "Eliminación permanente",
    "login":            "Inicio de sesión",
}

ENTITY_LABELS = {
    "ticket":     "Ticket",
    "factura":    "Factura",
    "cotizacion": "Cotización",
    "gasto":      "Gasto",
    "contacto":   "Contacto",
    "empresa":    "Empresa",
    "pedido":     "Pedido",
    "usuario":    "Usuario",
}


@router.get("")
def list_audit(
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
    entity_type: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(200, le=1000),
    offset: int = Query(0),
):
    query = db.query(models.AuditLog).order_by(models.AuditLog.created_at.desc())

    if entity_type:
        query = query.filter(models.AuditLog.entity_type == entity_type)
    if action:
        query = query.filter(models.AuditLog.action == action)
    if user_id:
        query = query.filter(models.AuditLog.user_id == user_id)
    if date_from:
        try:
            from datetime import datetime as _dt
            query = query.filter(models.AuditLog.created_at >= _dt.fromisoformat(date_from))
        except (ValueError, TypeError):
            from fastapi import HTTPException as _H
            raise _H(status_code=400, detail="Formato de date_from inválido (usa YYYY-MM-DD)")
    if date_to:
        try:
            from datetime import datetime as _dt
            dt_end = _dt.fromisoformat(date_to).replace(hour=23, minute=59, second=59, microsecond=999999)
            query = query.filter(models.AuditLog.created_at <= dt_end)
        except (ValueError, TypeError):
            from fastapi import HTTPException as _H
            raise _H(status_code=400, detail="Formato de date_to inválido (usa YYYY-MM-DD)")
    if q:
        like = f"%{q}%"
        query = query.filter(
            models.AuditLog.entity_name.ilike(like) |
            models.AuditLog.user_name.ilike(like)
        )

    total = query.count()
    rows  = query.offset(offset).limit(limit).all()

    return {
        "total": total,
        "items": [
            {
                "id":           r.id,
                "user_id":      r.user_id,
                "user_name":    r.user_name or "Sistema",
                "action":       r.action,
                "action_label": ACTION_LABELS.get(r.action, r.action),
                "entity_type":  r.entity_type,
                "entity_label": ENTITY_LABELS.get(r.entity_type, r.entity_type),
                "entity_id":    r.entity_id,
                "entity_name":  r.entity_name,
                "details":      r.details,
                "ip_address":   r.ip_address,
                "created_at":   r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }
