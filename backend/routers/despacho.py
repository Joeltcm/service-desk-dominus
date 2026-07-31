from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_
from typing import List, Optional
from datetime import datetime, timezone
import os, uuid, json, re
from database import get_db
from auth import require_staff
import models, schemas
import storage

MAX_FILE_SIZE = 20 * 1024 * 1024

ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain", "text/csv",
    "application/zip",
}

router = APIRouter(prefix="/api/despachos", tags=["despachos"])


def _is_it_support() -> bool:
    return os.getenv("PRODUCT_VERTICAL", "mps") == "it_support"


def _warranty_completeness(w) -> str:
    """'complete' si la garantía tiene items y todos con N° de serie; 'incomplete' si no."""
    if not w:
        return "none"
    items = list(w.items or [])
    if not items:
        return "incomplete"
    if any(not (it.serial or "").strip() for it in items):
        return "incomplete"
    return "complete"


def _warranty_for_dispatch(d: "models.Dispatch", db: Session):
    """Garantía vinculada a un pedido: por dispatch_id, o (legacy) por invoice_ref == n° de pedido."""
    w = (
        db.query(models.Warranty)
        .filter(models.Warranty.dispatch_id == d.id)
        .first()
    )
    if not w and d.dispatch_number:
        w = (
            db.query(models.Warranty)
            .filter(models.Warranty.invoice_ref == d.dispatch_number)
            .first()
        )
    return w


def _attach_warranty_status(dispatches, db: Session):
    """Adjunta d.warranty_status a cada pedido (solo it_support; en mps queda None).
    Una sola consulta (con items precargados) para toda la lista, en vez de N por pedido."""
    if not _is_it_support():
        return
    ids = [d.id for d in dispatches]
    nums = [d.dispatch_number for d in dispatches if d.dispatch_number]
    if not ids and not nums:
        return
    conds = []
    if ids:
        conds.append(models.Warranty.dispatch_id.in_(ids))
    if nums:
        conds.append(models.Warranty.invoice_ref.in_(nums))
    warrs = (
        db.query(models.Warranty)
        .options(joinedload(models.Warranty.items))
        .filter(or_(*conds))
        .all()
    )
    by_disp, by_ref = {}, {}
    for w in warrs:
        if w.dispatch_id and w.dispatch_id not in by_disp:
            by_disp[w.dispatch_id] = w
        if w.invoice_ref and w.invoice_ref not in by_ref:
            by_ref[w.invoice_ref] = w
    for d in dispatches:
        w = by_disp.get(d.id) or (by_ref.get(d.dispatch_number) if d.dispatch_number else None)
        d.warranty_status = _warranty_completeness(w)


# ── Inventario: resta/reposición automática por estado del pedido ──────────────

def _iter_dispatch_coded_items(d: models.Dispatch):
    """Devuelve (code, qty) de los items del pedido que tienen código de inventario."""
    try:
        items = json.loads(d.items or "[]")
    except Exception:
        return
    for it in items:
        code = (it.get("code") or "").strip()
        if not code:
            continue
        try:
            qty = float(it.get("qty") or 0)
        except (ValueError, TypeError):
            qty = 0
        if qty > 0:
            yield code, qty


def _apply_inventory_from_dispatch(d: models.Dispatch, db: Session):
    if d.inventory_applied:
        return
    for code, qty in _iter_dispatch_coded_items(d):
        inv = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if not inv:
            continue
        try:
            current = float(inv.quantity or "0")
        except (ValueError, TypeError):
            current = 0.0
        new_qty = max(0.0, current - qty)
        delta = current - new_qty
        inv.quantity = f"{new_qty:.4f}".rstrip("0").rstrip(".") or "0"
        db.add(models.InventoryTransaction(
            item_code=code, qty_delta=f"-{delta:.4f}".rstrip("0").rstrip("."),
            source_type="dispatch", source_id=d.id,
            notes=f"Pedido {d.dispatch_number or d.id} · {d.status}",
        ))
    d.inventory_applied = True


def _revert_inventory_from_dispatch(d: models.Dispatch, db: Session):
    if not d.inventory_applied:
        return
    for code, qty in _iter_dispatch_coded_items(d):
        inv = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if not inv:
            continue
        try:
            current = float(inv.quantity or "0")
        except (ValueError, TypeError):
            current = 0.0
        inv.quantity = f"{current + qty:.4f}".rstrip("0").rstrip(".") or "0"
        db.add(models.InventoryTransaction(
            item_code=code, qty_delta=f"+{qty:.4f}".rstrip("0").rstrip("."),
            source_type="dispatch_revert", source_id=d.id,
            notes=f"Reposición pedido {d.dispatch_number or d.id} · {d.status}",
        ))
    d.inventory_applied = False


def _sync_dispatch_inventory(d: models.Dispatch, db: Session, items_changed: bool = False):
    """Resta el stock cuando el pedido está en un estado distinto a Borrador/Cancelado;
    lo repone al volver a esos estados. Si cambian los items estando ya aplicado, resincroniza."""
    deduct = d.status not in ("Borrador", "Cancelado") and d.deleted_at is None
    if deduct:
        if d.inventory_applied and items_changed:
            _revert_inventory_from_dispatch(d, db)
        if not d.inventory_applied:
            _apply_inventory_from_dispatch(d, db)
    else:
        if d.inventory_applied:
            _revert_inventory_from_dispatch(d, db)


def _sync_order_status(order: models.Order, db: Session) -> None:
    """Derive order.status from the aggregate state of all its active dispatches."""
    dispatches = db.query(models.Dispatch).filter(
        models.Dispatch.order_id == order.id,
        models.Dispatch.deleted_at.is_(None),
    ).all()

    active = [d for d in dispatches if d.status != "Cancelado"]

    if not active:
        if order.status in ("En despacho", "Entregado al cliente"):
            order.status = "En proceso"
        return

    active_statuses = {d.status for d in active}
    if active_statuses == {"Entregado"}:
        order.status = "Entregado al cliente"
    elif "Entregado" in active_statuses:
        order.status = "En despacho"
    else:
        order.status = "En despacho"


@router.get("/next-number")
def next_dispatch_number(db: Session = Depends(get_db), _=Depends(require_staff)):
    prefix = "PED" if os.getenv("PRODUCT_VERTICAL", "mps") == "it_support" else "DSP"
    rows = db.query(models.Dispatch.dispatch_number).filter(models.Dispatch.dispatch_number.like(f"{prefix}-%"), models.Dispatch.deleted_at.is_(None)).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    n = (max(nums) + 1) if nums else 1
    return {"number": f"{prefix}-{n:04d}"}


@router.get("", response_model=List[schemas.DispatchOut])
def list_dispatches(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.Dispatch).filter(models.Dispatch.deleted_at.is_(None))
    if status:
        q = q.filter(models.Dispatch.status == status)
    if search:
        like = f"%{search}%"
        q = q.filter(
            models.Dispatch.title.ilike(like) |
            models.Dispatch.client_name.ilike(like) |
            models.Dispatch.dispatch_number.ilike(like) |
            models.Dispatch.items.ilike(like) |
            models.Dispatch.notes.ilike(like)
        )
    rows = q.order_by(models.Dispatch.created_at.desc()).all()
    _attach_warranty_status(rows, db)
    return rows


@router.post("", response_model=schemas.DispatchOut)
def create_dispatch(
    data: schemas.DispatchCreate,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    dispatch = models.Dispatch(**data.model_dump())
    db.add(dispatch)
    db.commit()
    db.refresh(dispatch)
    _sync_dispatch_inventory(dispatch, db)
    db.commit()
    if dispatch.order_id:
        order = db.query(models.Order).filter(models.Order.id == dispatch.order_id).first()
        if order:
            _sync_order_status(order, db)
            db.commit()
    _attach_warranty_status([dispatch], db)
    return dispatch


@router.get("/{dispatch_id}", response_model=schemas.DispatchOut)
def get_dispatch(
    dispatch_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(
        models.Dispatch.id == dispatch_id,
        models.Dispatch.deleted_at.is_(None),
    ).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    _attach_warranty_status([d], db)
    return d


@router.put("/{dispatch_id}", response_model=schemas.DispatchOut)
def update_dispatch(
    dispatch_id: int,
    data: schemas.DispatchUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(
        models.Dispatch.id == dispatch_id,
        models.Dispatch.deleted_at.is_(None),
    ).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    old_status = d.status
    updates = data.model_dump(exclude_unset=True)
    # Bloqueo de entrega (it_support): no se puede pasar a "Entregado" sin una garantía
    # vinculada que tenga los N° de serie de todos los equipos del pedido.
    if (_is_it_support()
            and updates.get("status") == "Entregado"
            and old_status != "Entregado"):
        if _warranty_completeness(_warranty_for_dispatch(d, db)) != "complete":
            raise HTTPException(
                status_code=400,
                detail="No se puede marcar como Entregado: falta el certificado de garantía con el N° de serie de todos los equipos.",
            )
    for field, value in updates.items():
        setattr(d, field, value)
    _sync_dispatch_inventory(d, db, items_changed="items" in updates)
    db.commit()
    db.refresh(d)
    if d.order_id and "status" in updates:
        order = db.query(models.Order).filter(models.Order.id == d.order_id).first()
        if order and order.status not in ("Inventariado",):
            _sync_order_status(order, db)
            db.commit()
    _attach_warranty_status([d], db)
    return d


@router.post("/{dispatch_id}/cancel", response_model=schemas.DispatchOut)
def cancel_dispatch(
    dispatch_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    """Cancela un pedido: elimina el certificado de garantía vinculado (si existe) y
    devuelve al inventario los artículos que había descontado."""
    d = db.query(models.Dispatch).filter(
        models.Dispatch.id == dispatch_id,
        models.Dispatch.deleted_at.is_(None),
    ).first()
    if not d:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if d.status == "Cancelado":
        raise HTTPException(status_code=400, detail="El pedido ya está cancelado")

    # 1) Elimina la garantía vinculada (por dispatch_id o, legacy, por n° de pedido).
    w = _warranty_for_dispatch(d, db)
    if w:
        db.delete(w)

    # 2) Cambia a Cancelado → _sync_dispatch_inventory repone el stock descontado.
    d.status = "Cancelado"
    _sync_dispatch_inventory(d, db)
    db.commit()
    db.refresh(d)

    if d.order_id:
        order = db.query(models.Order).filter(models.Order.id == d.order_id).first()
        if order and order.status not in ("Inventariado",):
            _sync_order_status(order, db)
            db.commit()
    _attach_warranty_status([d], db)
    return d


@router.delete("/{dispatch_id}")
def delete_dispatch(
    dispatch_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(
        models.Dispatch.id == dispatch_id,
        models.Dispatch.deleted_at.is_(None),
    ).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    order_id = d.order_id
    _revert_inventory_from_dispatch(d, db)  # repone stock si estaba aplicado
    d.deleted_at = datetime.now(timezone.utc)
    db.commit()
    if order_id:
        order = db.query(models.Order).filter(models.Order.id == order_id).first()
        if order and order.status not in ("Inventariado",):
            _sync_order_status(order, db)
            db.commit()
    return {"ok": True}


# ── Attachments ───────────────────────────────────────

@router.post("/{dispatch_id}/attachments", response_model=schemas.DispatchAttachmentOut)
async def upload_dispatch_attachment(
    dispatch_id: int,
    doc_type: str = "otro",
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(models.Dispatch.id == dispatch_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de archivo no permitido")
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="El archivo excede 20MB")
    ext = os.path.splitext(file.filename or "file")[1]
    stored_name = f"{uuid.uuid4()}{ext}"
    storage.save_file(f"dispatches/{dispatch_id}/{stored_name}", content, file.content_type)
    attachment = models.DispatchAttachment(
        dispatch_id=dispatch_id,
        doc_type=doc_type,
        filename=stored_name,
        original_name=file.filename or stored_name,
        file_size=len(content),
        content_type=file.content_type,
        uploaded_by_id=current_user.id,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


@router.get("/{dispatch_id}/attachments/{att_id}/download")
def download_dispatch_attachment(
    dispatch_id: int,
    att_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    att = db.query(models.DispatchAttachment).filter(
        models.DispatchAttachment.id == att_id,
        models.DispatchAttachment.dispatch_id == dispatch_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    storage_key = f"dispatches/{dispatch_id}/{att.filename}"
    if not storage.file_exists(storage_key):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    safe_name = re.sub(r'["\r\n\\]', '_', att.original_name or "archivo")
    return Response(
        content=storage.read_file(storage_key),
        media_type=att.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.delete("/{dispatch_id}/attachments/{att_id}")
def delete_dispatch_attachment(
    dispatch_id: int,
    att_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    att = db.query(models.DispatchAttachment).filter(
        models.DispatchAttachment.id == att_id,
        models.DispatchAttachment.dispatch_id == dispatch_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    storage.delete_file(f"dispatches/{dispatch_id}/{att.filename}")
    db.delete(att)
    db.commit()
    return {"ok": True}
