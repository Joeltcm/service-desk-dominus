from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import List, Optional
from datetime import datetime, timezone, date, timedelta
import os, uuid, logging, json, re
from database import get_db
from auth import get_current_user, require_staff
from audit_helper import log_action
import models, schemas
import storage

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _log_order_event(db: Session, order_id: int, user_id: Optional[int], content: str,
                     entry_type: str = "comment", is_internal: bool = False):
    """Registra un evento en el historial del pedido (espejo del timeline de tickets)."""
    db.add(models.OrderTimeline(
        order_id=order_id, user_id=user_id, content=content,
        entry_type=entry_type, is_internal=is_internal,
    ))


def _apply_inventory_from_order(order: models.Order, db: Session, force: bool = False):
    """Add received item quantities to inventory when an order is marked Recibido.
    Items without a code get one auto-generated from the order number + index.
    Missing inventory items are created automatically.
    """
    if order.inventory_applied and not force:
        return
    try:
        items = json.loads(order.purchase_items or "[]")
    except Exception:
        return

    # Build a lookup of sale prices from the linked quote (quote.order_id = order.id).
    # This ensures new inventory items get the client sale price, not the purchase cost.
    quote_prices: dict = {}
    linked_quote = db.query(models.Quote).filter(models.Quote.order_id == order.id).first()
    if linked_quote and linked_quote.items:
        try:
            for qi in json.loads(linked_quote.items):
                qi_desc = (qi.get("description") or "").strip()
                qi_code = (qi.get("code") or "").strip()
                price = str(qi.get("unit_price") or "0")
                if qi_code:
                    quote_prices[qi_code] = price
                if qi_desc:
                    quote_prices.setdefault(qi_desc, price)
        except Exception:
            pass

    order_ref = (order.order_number or f"PED-{order.id}").replace(" ", "")
    for idx, it in enumerate(items, start=1):
        desc = (it.get("description") or "").strip()
        if not desc:
            continue
        qty = float(it.get("qty") or 0)
        if qty <= 0:
            continue
        code = (it.get("code") or "").strip()
        if not code:
            code = f"{order_ref}-{idx}"
        inv_item = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if not inv_item:
            # Use the quote's sale price as unit_price; fall back to "0" (not the cost price).
            sale_price = quote_prices.get(code) or quote_prices.get(desc) or "0"
            inv_item = models.InventoryItem(
                code=code,
                name=desc,
                unit_price=sale_price,
                quantity="0",
            )
            db.add(inv_item)
            db.flush()
        # Store purchase cost separately for profitability calculations.
        purchase_price = str(it.get("unit_price") or "0")
        if float(purchase_price or "0") > 0:
            inv_item.cost_price = purchase_price

        try:
            current = float(inv_item.quantity or "0")
        except (ValueError, TypeError):
            current = 0.0
        new_qty = current + qty
        inv_item.quantity = f"{new_qty:.4f}".rstrip('0').rstrip('.') or "0"
    order.inventory_applied = True

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB

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


# ── Orders CRUD ───────────────────────────────────────

def _next_order_num(db: Session) -> str:
    rows = db.query(models.Order.order_number).filter(
        models.Order.order_number.like("PED-%"),
        models.Order.deleted_at.is_(None),
    ).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    return f"PED-{(max(nums) + 1) if nums else 1:04d}"


def _check_order_number_unique(db: Session, number: str, exclude_id: int = None):
    q = db.query(models.Order).filter(
        models.Order.order_number == number,
        models.Order.deleted_at.is_(None),
    )
    if exclude_id:
        q = q.filter(models.Order.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=409, detail=f"Ya existe un pedido con el número {number}")


@router.get("/next-number")
def next_order_number(db: Session = Depends(get_db), _=Depends(require_staff)):
    return {"number": _next_order_num(db)}


@router.get("", response_model=List[schemas.OrderOut])
def list_orders(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.Order).filter(models.Order.deleted_at.is_(None))
    if status:
        q = q.filter(models.Order.status == status)
    if date_from:
        q = q.filter(models.Order.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(models.Order.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            models.Order.title.ilike(like),
            models.Order.order_number.ilike(like),
            models.Order.notes.ilike(like),
            models.Order.purchase_total.ilike(like),
            models.Order.purchase_items.ilike(like),
        ))
    return q.order_by(models.Order.created_at.desc()).all()


@router.post("", response_model=schemas.OrderOut)
def create_order(
    data: schemas.OrderCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    if data.order_number:
        _check_order_number_unique(db, data.order_number)
    order = models.Order(**data.model_dump())
    db.add(order)
    db.commit()
    db.refresh(order)
    _log_order_event(db, order.id, current_user.id, "Creó el pedido", entry_type="system")
    from routers.expenses import sync_order_expense
    sync_order_expense(db, order)
    db.commit()
    return order


@router.get("/{order_id}", response_model=schemas.OrderOut)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return order


@router.put("/{order_id}", response_model=schemas.OrderOut)
def update_order(
    order_id: int,
    data: schemas.OrderUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if data.order_number and data.order_number != order.order_number:
        _check_order_number_unique(db, data.order_number, exclude_id=order_id)
    old_status = order.status
    old_assigned = order.assigned_to_id
    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(order, field, value)
    if order.status in ("Recibido", "Inventariado") and old_status not in ("Recibido", "Inventariado"):
        _apply_inventory_from_order(order, db)
    # Auto-log en el historial del pedido
    if "status" in updates and order.status != old_status:
        _log_order_event(db, order.id, current_user.id, f"Cambió el estado a «{order.status}»", entry_type="status_change")
    if "assigned_to_id" in updates and order.assigned_to_id != old_assigned:
        if order.assigned_to_id:
            tech = db.query(models.User).filter(models.User.id == order.assigned_to_id).first()
            _log_order_event(db, order.id, current_user.id, f"Asignó el pedido a {tech.name if tech else '—'}", entry_type="assignment")
        else:
            _log_order_event(db, order.id, current_user.id, "Quitó la asignación del pedido", entry_type="assignment")
    db.commit()
    db.refresh(order)
    from routers.expenses import sync_order_expense
    sync_order_expense(db, order)
    db.commit()
    return order


def _reverse_inventory_from_order(order: models.Order, db: Session):
    """Subtract quantities previously added to inventory by this order."""
    if not order.inventory_applied:
        return
    try:
        items = json.loads(order.purchase_items or "[]")
    except Exception:
        return
    order_ref = (order.order_number or f"PED-{order.id}").replace(" ", "")
    for idx, it in enumerate(items, start=1):
        desc = (it.get("description") or "").strip()
        if not desc:
            continue
        qty = float(it.get("qty") or 0)
        if qty <= 0:
            continue
        code = (it.get("code") or "").strip()
        if not code:
            code = f"{order_ref}-{idx}"
        inv_item = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if not inv_item:
            continue
        try:
            current = float(inv_item.quantity or "0")
        except (ValueError, TypeError):
            current = 0.0
        new_qty = max(current - qty, 0)
        inv_item.quantity = f"{new_qty:.4f}".rstrip('0').rstrip('.') or "0"
    order.inventory_applied = False


@router.delete("/{order_id}")
def delete_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    order = db.query(models.Order).filter(
        models.Order.id == order_id,
        models.Order.deleted_at.is_(None),
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if order.inventory_applied:
        _reverse_inventory_from_order(order, db)
    order.deleted_at = datetime.now(timezone.utc)
    log_action(db, current_user, "delete", "pedido", order.id, order.title or f"#{order.id}")
    db.commit()
    return {"ok": True}


@router.post("/{order_id}/apply-inventory", response_model=schemas.OrderOut)
def apply_order_inventory(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    # Aplicar la compra al inventario (acción independiente del ciclo del pedido).
    # Solo aplica si aún no fue aplicado (evita duplicar stock).
    if not order.inventory_applied:
        _apply_inventory_from_order(order, db, force=True)
        _log_order_event(db, order.id, current_user.id, "Ingresó la compra al inventario", entry_type="system")
    db.commit()
    db.refresh(order)
    return order


# ── Historial (timeline) ──────────────────────────────

@router.get("/{order_id}/timeline", response_model=List[schemas.OrderTimelineOut])
def get_order_timeline(
    order_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return (
        db.query(models.OrderTimeline)
        .filter(models.OrderTimeline.order_id == order_id)
        .order_by(models.OrderTimeline.created_at)
        .all()
    )


@router.post("/{order_id}/timeline", response_model=schemas.OrderTimelineOut)
def add_order_timeline(
    order_id: int,
    data: schemas.OrderTimelineCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="El comentario no puede estar vacío")
    entry = models.OrderTimeline(
        order_id=order_id, user_id=current_user.id, content=content,
        entry_type="comment", is_internal=bool(data.is_internal),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


# ── Checklist de preparación (tasks) ──────────────────

@router.get("/{order_id}/tasks", response_model=List[schemas.OrderTaskOut])
def get_order_tasks(
    order_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return (
        db.query(models.OrderTask)
        .filter(models.OrderTask.order_id == order_id)
        .order_by(models.OrderTask.position, models.OrderTask.id)
        .all()
    )


@router.post("/{order_id}/tasks", response_model=schemas.OrderTaskOut)
def add_order_task(
    order_id: int,
    data: schemas.OrderTaskCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="La tarea no puede estar vacía")
    max_pos = db.query(func.max(models.OrderTask.position)).filter(models.OrderTask.order_id == order_id).scalar() or 0
    task = models.OrderTask(order_id=order_id, title=title, position=max_pos + 1)
    db.add(task)
    _log_order_event(db, order_id, current_user.id, f"Agregó la tarea: {title}", entry_type="task")
    db.commit()
    db.refresh(task)
    return task


@router.patch("/{order_id}/tasks/{task_id}", response_model=schemas.OrderTaskOut)
def update_order_task(
    order_id: int,
    task_id: int,
    data: schemas.OrderTaskUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    task = db.query(models.OrderTask).filter(
        models.OrderTask.id == task_id, models.OrderTask.order_id == order_id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    upd = data.model_dump(exclude_unset=True)
    if upd.get("title") is not None:
        new_title = upd["title"].strip()
        if new_title:
            task.title = new_title
    if upd.get("is_done") is not None:
        if upd["is_done"] and not task.is_done:
            task.is_done = True
            task.done_by_id = current_user.id
            task.done_at = datetime.now(timezone.utc)
            _log_order_event(db, order_id, current_user.id, f"Completó la tarea: {task.title}", entry_type="task")
        elif not upd["is_done"] and task.is_done:
            task.is_done = False
            task.done_by_id = None
            task.done_at = None
            _log_order_event(db, order_id, current_user.id, f"Reabrió la tarea: {task.title}", entry_type="task")
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{order_id}/tasks/{task_id}")
def delete_order_task(
    order_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    task = db.query(models.OrderTask).filter(
        models.OrderTask.id == task_id, models.OrderTask.order_id == order_id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    db.delete(task)
    db.commit()
    return {"ok": True}


# ── Attachments ───────────────────────────────────────

@router.get("/{order_id}/attachments", response_model=List[schemas.OrderAttachmentOut])
def list_attachments(
    order_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return db.query(models.OrderAttachment).filter(
        models.OrderAttachment.order_id == order_id
    ).order_by(models.OrderAttachment.created_at).all()


@router.post("/{order_id}/attachments", response_model=schemas.OrderAttachmentOut)
async def upload_attachment(
    order_id: int,
    doc_type: str = "otro",
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de archivo no permitido")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="El archivo excede 20MB")

    ext = os.path.splitext(file.filename or "file")[1]
    stored_name = f"{uuid.uuid4()}{ext}"
    storage.save_file(f"orders/{order_id}/{stored_name}", content, file.content_type)

    attachment = models.OrderAttachment(
        order_id=order_id,
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


@router.get("/{order_id}/attachments/{att_id}/download")
def download_attachment(
    order_id: int,
    att_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    att = db.query(models.OrderAttachment).filter(
        models.OrderAttachment.id == att_id,
        models.OrderAttachment.order_id == order_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    storage_key = f"orders/{order_id}/{att.filename}"
    if not storage.file_exists(storage_key):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    safe_name = re.sub(r'["\r\n\\]', '_', att.original_name or "archivo")
    return Response(
        content=storage.read_file(storage_key),
        media_type=att.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.delete("/{order_id}/attachments/{att_id}")
def delete_attachment(
    order_id: int,
    att_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    att = db.query(models.OrderAttachment).filter(
        models.OrderAttachment.id == att_id,
        models.OrderAttachment.order_id == order_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    storage.delete_file(f"orders/{order_id}/{att.filename}")
    db.delete(att)
    db.commit()
    return {"ok": True}
