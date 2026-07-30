from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone

from database import get_db
from auth import require_staff, require_admin_or_supplies
import models, schemas

router = APIRouter(prefix="/api/part-requests", tags=["part-requests"])


def _serialize(pr: models.PartRequest) -> dict:
    return {
        "id": pr.id,
        "ticket_id": pr.ticket_id,
        "ticket_title": pr.ticket.title if pr.ticket else None,
        "item_code": pr.item_code,
        "item_name": pr.item_name,
        "quantity": pr.quantity,
        "status": pr.status,
        "notes": pr.notes,
        "decision_notes": pr.decision_notes,
        "requested_by_id": pr.requested_by_id,
        "requested_by_name": pr.requested_by.name if pr.requested_by else None,
        "approved_by_id": pr.approved_by_id,
        "approved_by_name": pr.approved_by.name if pr.approved_by else None,
        "created_at": pr.created_at.isoformat() if pr.created_at else None,
        "decided_at": pr.decided_at.isoformat() if pr.decided_at else None,
    }


@router.post("", response_model=schemas.PartRequestOut)
def create_part_request(
    data: schemas.PartRequestCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == data.ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    # Solo se pueden solicitar artículos de la bodega de PARTES.
    item = db.query(models.InventoryItem).filter(
        models.InventoryItem.code == data.item_code,
        models.InventoryItem.warehouse == "partes",
        models.InventoryItem.is_active == True,
    ).first()
    if not item:
        raise HTTPException(status_code=400, detail="El artículo no existe en la bodega de partes")
    try:
        qty = float(data.quantity or "0")
    except (ValueError, TypeError):
        qty = 0
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Cantidad inválida")

    pr = models.PartRequest(
        ticket_id=data.ticket_id,
        item_code=item.code,
        item_name=item.name,
        quantity=data.quantity,
        status="pendiente",
        notes=(data.notes or None),
        requested_by_id=current_user.id,
    )
    db.add(pr)
    db.commit()
    db.refresh(pr)

    # Notifica (push + campana) a administradores y responsables de inventario.
    try:
        from push_helper import notify_roles
        notify_roles(
            db,
            [models.UserRole.admin, models.UserRole.superadmin, models.UserRole.supplies],
            "Nueva solicitud de parte",
            f"{current_user.name}: {item.name} (x{data.quantity}) · Ticket #{data.ticket_id}",
            url="/partes",
            exclude_user_id=current_user.id,
        )
    except Exception:
        pass
    return _serialize(pr)


@router.post("/{req_id}/cancel", response_model=schemas.PartRequestOut)
def cancel_part_request(
    req_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    pr = db.query(models.PartRequest).filter(models.PartRequest.id == req_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")
    if pr.status != "pendiente":
        raise HTTPException(status_code=400, detail=f"Solo se pueden cancelar solicitudes pendientes (actual: '{pr.status}')")
    # Puede cancelar el solicitante o un admin/responsable de inventario.
    if pr.requested_by_id != current_user.id and current_user.role not in (
        models.UserRole.admin, models.UserRole.superadmin, models.UserRole.supplies,
    ):
        raise HTTPException(status_code=403, detail="Solo el solicitante o un administrador puede cancelar")
    pr.status = "cancelado"
    pr.decided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(pr)
    return _serialize(pr)


@router.get("", response_model=List[schemas.PartRequestOut])
def list_part_requests(
    status: Optional[str] = Query(None),
    ticket_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.PartRequest)
    if status:
        q = q.filter(models.PartRequest.status == status)
    if ticket_id:
        q = q.filter(models.PartRequest.ticket_id == ticket_id)
    rows = q.order_by(models.PartRequest.created_at.desc()).all()
    return [_serialize(r) for r in rows]


@router.get("/pending-count")
def pending_count(db: Session = Depends(get_db), _=Depends(require_staff)):
    from sqlalchemy import func
    n = db.query(func.count(models.PartRequest.id)).filter(
        models.PartRequest.status == "pendiente"
    ).scalar() or 0
    return {"pending": n}


@router.post("/{req_id}/approve", response_model=schemas.PartRequestOut)
def approve_part_request(
    req_id: int,
    data: schemas.PartRequestDecision,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_supplies),
):
    pr = db.query(models.PartRequest).filter(models.PartRequest.id == req_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")
    if pr.status != "pendiente":
        raise HTTPException(status_code=400, detail=f"La solicitud ya está '{pr.status}'")

    item = db.query(models.InventoryItem).filter(models.InventoryItem.code == pr.item_code).first()
    if not item:
        raise HTTPException(status_code=400, detail="El artículo ya no existe en el inventario")
    try:
        qty = float(pr.quantity or "0")
        current = float(item.quantity or "0")
    except (ValueError, TypeError):
        qty, current = 0.0, 0.0
    new_qty = max(0.0, current - qty)
    delta = current - new_qty
    item.quantity = f"{new_qty:.4f}".rstrip("0").rstrip(".") or "0"
    db.add(models.InventoryTransaction(
        item_code=pr.item_code,
        qty_delta=f"-{delta:.4f}".rstrip("0").rstrip("."),
        source_type="ticket_part",
        source_id=pr.ticket_id,
        notes=f"Parte para ticket #{pr.ticket_id} · aprobó {current_user.name}",
    ))
    pr.status = "aprobado"
    pr.approved_by_id = current_user.id
    pr.decision_notes = (data.decision_notes or None)
    pr.decided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(pr)
    return _serialize(pr)


@router.post("/{req_id}/reject", response_model=schemas.PartRequestOut)
def reject_part_request(
    req_id: int,
    data: schemas.PartRequestDecision,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_supplies),
):
    pr = db.query(models.PartRequest).filter(models.PartRequest.id == req_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")
    if pr.status != "pendiente":
        raise HTTPException(status_code=400, detail=f"La solicitud ya está '{pr.status}'")
    pr.status = "rechazado"
    pr.approved_by_id = current_user.id
    pr.decision_notes = (data.decision_notes or None)
    pr.decided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(pr)
    return _serialize(pr)
