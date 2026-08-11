from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone

from database import get_db
from auth import require_staff, require_admin_or_supplies
import models, schemas

router = APIRouter(prefix="/api/part-requests", tags=["part-requests"])


def _pending_info(db: Session, pr: models.PartRequest) -> dict:
    """Para partes especiales aprobadas: estado de espera derivado del artículo pendiente."""
    if not (getattr(pr, "is_special", False) and pr.item_code):
        return {}
    item = db.query(models.InventoryItem).filter(models.InventoryItem.code == pr.item_code).first()
    if not item:
        return {}
    try:
        pending = float(item.pending_qty or 0)
    except (ValueError, TypeError):
        pending = 0.0
    sup = None
    if item.supplier_id:
        s = db.query(models.Supplier.name).filter(models.Supplier.id == item.supplier_id).first()
        sup = s[0] if s else None
    return {
        "pending_qty": item.pending_qty,
        "pending_eta": item.pending_eta.isoformat() if item.pending_eta else None,
        "supplier_name": sup,
        "special_state": ("en_espera" if pending > 0 else "disponible") if pr.status == "aprobado" else None,
    }


def _serialize(pr: models.PartRequest, db: Session = None) -> dict:
    d = {
        "id": pr.id,
        "ticket_id": pr.ticket_id,
        "ticket_title": pr.ticket.title if pr.ticket else None,
        "item_code": pr.item_code,
        "item_name": pr.item_name,
        "quantity": pr.quantity,
        "status": pr.status,
        "is_special": bool(getattr(pr, "is_special", False)),
        "notes": pr.notes,
        "decision_notes": pr.decision_notes,
        "requested_by_id": pr.requested_by_id,
        "requested_by_name": pr.requested_by.name if pr.requested_by else None,
        "approved_by_id": pr.approved_by_id,
        "approved_by_name": pr.approved_by.name if pr.approved_by else None,
        "created_at": pr.created_at.isoformat() if pr.created_at else None,
        "decided_at": pr.decided_at.isoformat() if pr.decided_at else None,
    }
    if db is not None:
        d.update(_pending_info(db, pr))
    return d


@router.post("", response_model=schemas.PartRequestOut)
def create_part_request(
    data: schemas.PartRequestCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == data.ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    try:
        qty = float(data.quantity or "0")
    except (ValueError, TypeError):
        qty = 0
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Cantidad inválida")

    if data.is_special:
        # Parte especial: no está en inventario. Se guarda la descripción; al aprobar se
        # crea el artículo "pendiente por recibir" en la bodega de partes.
        desc = (data.item_name or "").strip()
        if not desc:
            raise HTTPException(status_code=400, detail="Describe la parte especial que necesitas")
        pr = models.PartRequest(
            ticket_id=data.ticket_id,
            item_code="",
            item_name=desc,
            quantity=data.quantity,
            status="pendiente",
            is_special=True,
            notes=(data.notes or None),
            requested_by_id=current_user.id,
        )
        notif_name = desc
    else:
        # Solo se pueden solicitar artículos de la bodega de PARTES.
        item = db.query(models.InventoryItem).filter(
            models.InventoryItem.code == data.item_code,
            models.InventoryItem.warehouse == "partes",
            models.InventoryItem.is_active == True,
        ).first()
        if not item:
            raise HTTPException(status_code=400, detail="El artículo no existe en la bodega de partes")
        pr = models.PartRequest(
            ticket_id=data.ticket_id,
            item_code=item.code,
            item_name=item.name,
            quantity=data.quantity,
            status="pendiente",
            is_special=False,
            notes=(data.notes or None),
            requested_by_id=current_user.id,
        )
        notif_name = item.name

    db.add(pr)
    db.commit()
    db.refresh(pr)

    # Notifica (campana + push) a administradores y responsables de inventario.
    try:
        from notify import notify_roles as notify_roles_inapp
        notify_roles_inapp(
            db,
            [models.UserRole.admin, models.UserRole.superadmin, models.UserRole.supplies],
            "Nueva solicitud de parte especial" if data.is_special else "Nueva solicitud de parte",
            f"{current_user.name}: {notif_name} (x{data.quantity}) · Ticket #{data.ticket_id}",
            url="/partes",
            kind="part_request",
            exclude_user_id=current_user.id,
        )
        db.commit()
    except Exception:
        db.rollback()
    return _serialize(pr, db)


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
    return _serialize(pr, db)


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
    return [_serialize(r, db) for r in rows]


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

    if pr.is_special:
        # Parte especial: se crea (o reutiliza) el artículo en la bodega de partes como
        # "pendiente por recibir" (stock 0, pending_qty = cantidad). No descuenta stock.
        code = f"ESP-T{pr.ticket_id}-{pr.id}"
        item = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if not item:
            item = models.InventoryItem(
                code=code,
                name=(pr.item_name or f"Parte especial #{pr.id}")[:300],
                warehouse="partes",
                quantity="0",
                pending_qty=pr.quantity,
                item_status="ingresado",
                condition="nuevo",
                is_active=True,
                notes=f"Parte especial solicitada para ticket #{pr.ticket_id}",
            )
            db.add(item)
        else:
            try:
                cur_pending = float(item.pending_qty or "0")
            except (ValueError, TypeError):
                cur_pending = 0.0
            item.pending_qty = f"{cur_pending + float(pr.quantity or '0'):.4f}".rstrip("0").rstrip(".") or "0"
        # Espera del proveedor: proveedor + fecha estimada de llegada (ETA).
        if data.supplier_id:
            item.supplier_id = data.supplier_id
        if data.expected_date:
            item.pending_eta = data.expected_date
        pr.item_code = code
    else:
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
    if pr.requested_by_id:
        try:
            from notify import create_notification
            if pr.is_special:
                body = f"{pr.item_name} (x{pr.quantity}) · Ticket #{pr.ticket_id} — se ordenó la parte; te avisaremos al recibirla."
            else:
                body = f"{pr.item_name} (x{pr.quantity}) · Ticket #{pr.ticket_id} — aprobó {current_user.name}"
            create_notification(
                db, pr.requested_by_id,
                "Solicitud de parte aprobada ✓",
                body,
                url=f"/tickets/{pr.ticket_id}", kind="part_decision",
            )
        except Exception:
            pass
    db.commit()
    db.refresh(pr)
    return _serialize(pr, db)


@router.post("/{req_id}/return", response_model=schemas.PartRequestOut)
def return_part_request(
    req_id: int,
    data: schemas.PartRequestDecision,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_supplies),
):
    """Devuelve al inventario una parte que ya fue aprobada/despachada (repone el stock)."""
    pr = db.query(models.PartRequest).filter(models.PartRequest.id == req_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")
    if pr.status != "aprobado":
        raise HTTPException(status_code=400, detail=f"Solo se pueden devolver partes aprobadas (actual: '{pr.status}')")

    item = db.query(models.InventoryItem).filter(models.InventoryItem.code == pr.item_code).first()
    if item:
        try:
            qty = float(pr.quantity or "0")
            current = float(item.quantity or "0")
        except (ValueError, TypeError):
            qty, current = 0.0, 0.0
        item.quantity = f"{current + qty:.4f}".rstrip("0").rstrip(".") or "0"
        db.add(models.InventoryTransaction(
            item_code=pr.item_code,
            qty_delta=f"+{qty:.4f}".rstrip("0").rstrip("."),
            source_type="ticket_part_return",
            source_id=pr.ticket_id,
            notes=f"Devolución de parte · ticket #{pr.ticket_id} · {current_user.name}",
        ))
    pr.status = "devuelto"
    pr.approved_by_id = current_user.id
    pr.decision_notes = (data.decision_notes or pr.decision_notes)
    pr.decided_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(pr)
    return _serialize(pr, db)


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
    if pr.requested_by_id:
        try:
            from notify import create_notification
            create_notification(
                db, pr.requested_by_id,
                "Solicitud de parte rechazada",
                f"{pr.item_name} (x{pr.quantity}) · Ticket #{pr.ticket_id} — {current_user.name}"
                + (f": {pr.decision_notes}" if pr.decision_notes else ""),
                url=f"/tickets/{pr.ticket_id}", kind="part_decision",
            )
        except Exception:
            pass
    db.commit()
    db.refresh(pr)
    return _serialize(pr, db)
