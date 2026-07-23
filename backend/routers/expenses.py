import os
import re
import uuid
import logging

_SAFE_FNAME = re.compile(r'^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+$')
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_

from database import get_db
from auth import get_current_user, require_staff
from audit_helper import log_action
import models
import schemas

router = APIRouter(prefix="/api/expenses", tags=["expenses"])

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
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

EXPENSE_CATEGORIES = [
    "Alquiler / Renta",
    "Combustible",
    "Compras / Pedidos",
    "Equipos y herramientas",
    "Gastos telefonicos",
    "Impuestos y tasas",
    "Internet",
    "Mantenimiento",
    "Marketing / Publicidad",
    "Papelería y oficina",
    "Servicio profesional",
    "Servicio SAS",
    "Servicios públicos",
    "Software y licencias",
    "Sueldos y salarios",
    "Suscripción",
    "Telecomunicaciones",
    "Transporte",
    "Varios",
]


def _parse_amount(raw: str) -> float:
    s = (raw or "0").strip().lstrip("$€₡ ")
    if re.search(r"\d\.\d{3},\d{1,2}$", s):
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", "")
    s = re.sub(r"[^\d.]", "", s)
    try:
        return float(s or "0")
    except ValueError:
        return 0.0


def sync_order_expense(db: Session, order: models.Order):
    """Create, update, or remove the auto-linked expense for an order so it mirrors purchase_total + shipping_cost."""
    existing = (
        db.query(models.Expense)
        .filter(models.Expense.order_id == order.id)
        .first()
    )

    purchase = _parse_amount(order.purchase_total) if order.purchase_total else 0.0
    shipping = _parse_amount(order.shipping_cost) if order.shipping_cost else 0.0
    amount = purchase + shipping

    if amount <= 0:
        if existing and not existing.deleted_at:
            existing.deleted_at = datetime.now(timezone.utc)
        return

    if existing and existing.deleted_at:
        existing.deleted_at = None

    amount_str = f"{amount:.2f}"

    # Determine supplier name
    supplier_name = None
    for attr in ("supplier1", "supplier2", "supplier3"):
        s = getattr(order, attr, None)
        if s:
            supplier_name = s.name
            break

    # Build concept from order title
    concept = f"Pedido: {order.title}"
    if order.order_number:
        concept = f"{order.order_number} — {order.title}"

    if order.created_at:
        date_str = order.created_at.strftime('%Y-%m-%d')
    elif order.expected_date:
        date_str = str(order.expected_date)
    else:
        date_str = None

    if existing:
        existing.concept = concept
        existing.amount = amount_str
        existing.supplier = supplier_name
        existing.invoice_id = order.invoice_id
        if date_str:
            existing.date = date_str
        # Preserve is_payable/paid_at/due_date — user manages payment status manually
    else:
        expense = models.Expense(
            concept=concept,
            amount=amount_str,
            category="Compras / Pedidos",
            date=date_str,
            type="pedido",
            order_id=order.id,
            invoice_id=order.invoice_id,
            supplier=supplier_name,
            is_payable=True,
        )
        db.add(expense)


# ── Categories list ───────────────────────────────────

@router.get("/categories")
def get_categories(_=Depends(require_staff)):
    return EXPENSE_CATEGORIES


# ── CRUD ─────────────────────────────────────────────

@router.get("", response_model=List[schemas.ExpenseOut])
def list_expenses(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    type_filter: Optional[str] = Query(None, alias="type"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.Expense).filter(models.Expense.deleted_at.is_(None))
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            models.Expense.concept.ilike(like),
            models.Expense.supplier.ilike(like),
            models.Expense.category.ilike(like),
            models.Expense.notes.ilike(like),
            models.Expense.amount.ilike(like),
        ))
    if category:
        q = q.filter(models.Expense.category == category)
    if type_filter:
        q = q.filter(models.Expense.type == type_filter)
    if date_from:
        q = q.filter(models.Expense.date >= date_from)
    if date_to:
        q = q.filter(models.Expense.date <= date_to)
    return q.order_by(models.Expense.date.desc(), models.Expense.created_at.desc()).all()


@router.post("", response_model=schemas.ExpenseOut)
def create_expense(
    data: schemas.ExpenseCreate,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    expense = models.Expense(**data.model_dump(), type="manual")
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense


@router.get("/{expense_id}", response_model=schemas.ExpenseOut)
def get_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    return expense


@router.put("/{expense_id}", response_model=schemas.ExpenseOut)
def update_expense(
    expense_id: int,
    data: schemas.ExpenseUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(expense, field, value)
    db.commit()
    db.refresh(expense)
    return expense


@router.delete("/{expense_id}")
def delete_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role != models.UserRole.admin:
        raise HTTPException(status_code=403)
    expense = db.query(models.Expense).filter(
        models.Expense.id == expense_id,
        models.Expense.deleted_at.is_(None),
    ).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    if expense.type == "pedido" and expense.order_id:
        order_exists = db.query(models.Order).filter(
            models.Order.id == expense.order_id,
            models.Order.deleted_at.is_(None),
        ).first()
        if order_exists:
            raise HTTPException(status_code=400, detail="Los gastos de pedidos se eliminan desde el pedido")
    expense.deleted_at = datetime.now(timezone.utc)
    log_action(db, current_user, "delete", "gasto", expense.id, expense.concept or f"#{expense.id}")
    db.commit()
    return {"ok": True}


# ── Summary ───────────────────────────────────────────

@router.get("/summary/dashboard")
def get_dashboard_summary(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.Expense).filter(models.Expense.deleted_at.is_(None))
    if date_from:
        q = q.filter(models.Expense.date >= date_from)
    if date_to:
        q = q.filter(models.Expense.date <= date_to)
    expenses = q.all()

    total = 0.0
    paid_total = 0.0
    paid_count = 0
    count = 0
    payable_total = 0.0
    payable_count = 0
    by_month: dict = {}
    by_month_paid: dict = {}
    by_category: dict = {}
    by_supplier: dict = {}
    by_type: dict = {}

    for e in expenses:
        a = _parse_amount(e.amount)
        total += a
        count += 1
        is_paid = (not e.is_payable) or bool(e.paid_at)
        if is_paid:
            paid_total += a
            paid_count += 1
        if e.is_payable and not e.paid_at:
            payable_total += a
            payable_count += 1
        if e.date and len(e.date) >= 7:
            key = e.date[:7]
            by_month[key] = by_month.get(key, 0) + a
            if is_paid:
                by_month_paid[key] = by_month_paid.get(key, 0) + a
        cat = e.category or "Sin categoría"
        by_category[cat] = by_category.get(cat, 0) + a
        sup = e.supplier or "Sin proveedor"
        by_supplier[sup] = by_supplier.get(sup, 0) + a
        t = "Pedido" if e.type == "pedido" else "Manual"
        by_type[t] = by_type.get(t, 0) + a

    top_suppliers = dict(list(sorted(by_supplier.items(), key=lambda x: -x[1]))[:8])

    return {
        "total": round(total, 2),
        "paid_total": round(paid_total, 2),
        "paid_count": paid_count,
        "count": count,
        "average": round(paid_total / paid_count, 2) if paid_count else 0,
        "payable_total": round(payable_total, 2),
        "payable_count": payable_count,
        "by_month": {k: round(v, 2) for k, v in sorted(by_month.items())},
        "by_month_paid": {k: round(v, 2) for k, v in sorted(by_month_paid.items())},
        "by_category": {k: round(v, 2) for k, v in sorted(by_category.items(), key=lambda x: -x[1])},
        "by_supplier": {k: round(v, 2) for k, v in top_suppliers.items()},
        "by_type": {k: round(v, 2) for k, v in by_type.items()},
    }


@router.get("/summary/totals")
def get_summary(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.Expense).filter(models.Expense.deleted_at.is_(None))
    if date_from:
        q = q.filter(models.Expense.date >= date_from)
    if date_to:
        q = q.filter(models.Expense.date <= date_to)
    expenses = q.all()

    total = sum(_parse_amount(e.amount) for e in expenses)
    payable_total = sum(_parse_amount(e.amount) for e in expenses if e.is_payable and not e.paid_at)
    payable_count = sum(1 for e in expenses if e.is_payable and not e.paid_at)
    by_category: dict = {}
    for e in expenses:
        cat = e.category or "Sin categoría"
        by_category[cat] = by_category.get(cat, 0) + _parse_amount(e.amount)

    return {
        "total": round(total, 2),
        "count": len(expenses),
        "payable_total": round(payable_total, 2),
        "payable_count": payable_count,
        "by_category": {k: round(v, 2) for k, v in sorted(by_category.items(), key=lambda x: -x[1])},
    }


# ── Attachments ───────────────────────────────────────

@router.get("/{expense_id}/attachments", response_model=List[schemas.ExpenseAttachmentOut])
def list_attachments(
    expense_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404)
    return expense.attachments


@router.post("/{expense_id}/attachments", response_model=schemas.ExpenseAttachmentOut)
async def upload_attachment(
    expense_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404)

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de archivo no permitido")

    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Archivo demasiado grande (máx 20 MB)")

    exp_dir = os.path.join(UPLOAD_DIR, "expenses", str(expense_id))
    os.makedirs(exp_dir, exist_ok=True)

    ext = os.path.splitext(file.filename or "")[1]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(exp_dir, stored_name)
    with open(file_path, "wb") as f:
        f.write(data)

    att = models.ExpenseAttachment(
        expense_id=expense_id,
        filename=stored_name,
        original_name=file.filename or stored_name,
        file_size=len(data),
        content_type=file.content_type,
        uploaded_by_id=current_user.id,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


@router.delete("/{expense_id}/attachments/{att_id}")
def delete_attachment(
    expense_id: int,
    att_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    att = db.query(models.ExpenseAttachment).filter(
        models.ExpenseAttachment.id == att_id,
        models.ExpenseAttachment.expense_id == expense_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404)
    file_path = os.path.join(UPLOAD_DIR, "expenses", str(expense_id), att.filename)
    if os.path.exists(file_path):
        os.remove(file_path)
    db.delete(att)
    db.commit()
    return {"ok": True}


@router.get("/{expense_id}/attachments/{att_id}/download")
def download_attachment(
    expense_id: int,
    att_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    att = db.query(models.ExpenseAttachment).filter(
        models.ExpenseAttachment.id == att_id,
        models.ExpenseAttachment.expense_id == expense_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404)
    if not _SAFE_FNAME.match(att.filename):
        raise HTTPException(status_code=404)
    file_path = os.path.join(UPLOAD_DIR, "expenses", str(expense_id), att.filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return FileResponse(
        file_path,
        media_type=att.content_type or "application/octet-stream",
        filename=att.original_name,
    )
