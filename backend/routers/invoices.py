from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, date, timezone
from pydantic import BaseModel
import base64
import csv
import io
import json
import math
import logging
import os
import re
import uuid

_SAFE_FNAME = re.compile(r'^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+$')

from sqlalchemy import or_, and_, func
from database import get_db
from auth import require_staff, get_current_user
from routers.settings import _get_setting, _send_with_logo, _load_logo
from audit_helper import log_action
import models, schemas

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")

def _logo_img_tag() -> str:
    # Logo is attached as CID by _send_with_logo — reference via cid:img_logo
    return '<img src="cid:img_logo" width="52" height="52" alt="DG Solutions" style="border-radius:10px;display:block;background:#fff;padding:4px" />'


class SendEmailBody(BaseModel):
    to: str
    message: Optional[str] = None
    pdf_base64: Optional[str] = None


def _esc(s: str) -> str:
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _fmt_date(d) -> str:
    if not d:
        return "—"
    if hasattr(d, "strftime"):
        return d.strftime("%d/%m/%Y")
    return str(d)


def _fmt_money(v) -> str:
    try:
        return f"{float(str(v or '0').replace(',', '')):.2f}"
    except Exception:
        return "0.00"


def _build_invoice_email_html(inv: models.Invoice, message: Optional[str], db=None, _logo=None) -> str:
    logo_tag = _logo if _logo is not None else _logo_img_tag()
    num = inv.invoice_number or f"#{inv.id}"
    co_name    = (_get_setting(db, "company_name")    if db else "") or "DG Solutions"
    co_address = (_get_setting(db, "company_address") if db else "") or "Panamá, Punta Pacífica, PH Pacific Wind"
    co_ruc     = (_get_setting(db, "company_ruc")     if db else "") or "4-754-575 DV 85"

    try:
        items = json.loads(inv.items or "[]")
    except Exception:
        items = []

    visible_items = [it for it in items if str(it.get("description", "")).strip()]

    # Totals
    subtotal = sum(round((float(it.get("qty") or 0)) * (float(it.get("unit_price") or 0)), 2) for it in visible_items)
    taxable  = sum(round((float(it.get("qty") or 0)) * (float(it.get("unit_price") or 0)), 2)
                   for it in visible_items if it.get("itbms") is not False)
    itbms    = math.ceil(taxable * 0.07 * 100) / 100 if inv.itbms_enabled else 0.0
    shipping = float(re.sub(r"[^\d.]", "", str(inv.shipping_cost or "0")) or "0")
    total    = subtotal + itbms + shipping

    # Payments / abonos
    payments   = list(inv.payments) if inv.payments else []
    total_paid = sum(float(re.sub(r"[^\d.]", "", str(p.amount or "0")) or "0") for p in payments)
    remaining  = max(0.0, total - total_paid)

    # Item rows — same structure as frontend buildInvoiceHTML
    rows = ""
    for i, it in enumerate(visible_items):
        line = round((float(it.get("qty") or 0)) * (float(it.get("unit_price") or 0)), 2)
        bg   = "#f8f9fb" if i % 2 == 0 else "#fff"
        rows += (
            f'<tr style="background:{bg}">'
            f'<td style="padding:6px 10px;border:1px solid #d1d5db">{i+1}</td>'
            f'<td style="padding:6px 10px;border:1px solid #d1d5db">{_esc(it.get("description",""))}</td>'
            f'<td style="padding:6px 10px;border:1px solid #d1d5db;text-align:center">{_esc(str(it.get("qty","")))}</td>'
            f'<td style="padding:6px 10px;border:1px solid #d1d5db;text-align:right">${_fmt_money(it.get("unit_price"))}</td>'
            f'<td style="padding:6px 10px;border:1px solid #d1d5db;text-align:right;font-weight:600">${_fmt_money(line)}</td>'
            f'</tr>'
        )

    msg_block = ""
    if message:
        msg_block = (
            f'<div style="background:#f0f9ff;border-left:4px solid #3b82f6;border-radius:4px;'
            f'padding:12px 16px;margin-bottom:20px;font-size:13px;color:#1e40af;line-height:1.6">'
            f'{message.replace(chr(10), "<br>")}</div>'
        )

    itbms_block = (
        f'<div style="display:flex;justify-content:space-between;padding:6px 14px;background:#fffbeb;font-size:9.5pt">'
        f'<span style="color:#b45309">ITBMS 7%</span>'
        f'<span style="font-weight:600;color:#b45309">${_fmt_money(itbms)}</span></div>'
    ) if inv.itbms_enabled else ""

    shipping_block = (
        f'<div style="display:flex;justify-content:space-between;padding:6px 14px;font-size:9.5pt">'
        f'<span style="color:#555">Costo de entrega</span>'
        f'<span style="font-weight:600">${_fmt_money(shipping)}</span></div>'
    ) if shipping > 0 else ""

    payment_rows_html = ""
    payments_block    = ""
    if payments:
        payment_rows_html = "".join(
            f'<div style="display:flex;justify-content:space-between;align-items:center;'
            f'padding:5px 14px;background:#f0fdf4;font-size:9pt;border-bottom:1px solid #dcfce7">'
            f'<span style="color:#166534">Abono · {_esc(p.method)} · {_fmt_date(p.date)}</span>'
            f'<span style="color:#166534;font-weight:600">-${_fmt_money(float(re.sub(r"[^\d.]", "", str(p.amount or "0")) or "0"))}</span>'
            f'</div>'
            for p in payments
        )
        paid_label  = "✓ PAGADA COMPLETAMENTE" if remaining <= 0 else "SALDO PENDIENTE"
        paid_color  = "#15803d" if remaining <= 0 else "#854d0e"
        paid_bg     = "#dcfce7" if remaining <= 0 else "#fef9c3"
        paid_border = "#86efac" if remaining <= 0 else "#fde047"
        payments_block = (
            f'<div style="border-top:2px solid #e5e7eb;margin-top:0">'
            f'{payment_rows_html}'
            f'<div style="display:flex;justify-content:space-between;padding:8px 14px;'
            f'background:{paid_bg};font-size:10.5pt;border-top:1px solid {paid_border}">'
            f'<span style="font-weight:bold;color:{paid_color}">{paid_label}</span>'
            f'<span style="font-weight:bold;color:{paid_color}">${_fmt_money(remaining)}</span>'
            f'</div></div>'
        )

    client_ruc_row   = f'<div style="font-size:8.5pt;color:#555;margin-top:2px">RUC: {_esc(inv.client_ruc)}</div>' if inv.client_ruc else ""
    client_addr_row  = f'<div style="font-size:8.5pt;color:#555">{_esc(inv.client_address)}</div>' if inv.client_address else ""
    client_email_row = f'<div style="font-size:8.5pt;color:#555">{_esc(inv.client_email)}</div>' if inv.client_email else ""
    client_phone_row = f'<div style="font-size:8.5pt;color:#555">{_esc(inv.client_phone)}</div>' if inv.client_phone else ""

    due_date_block = (
        f'<div><div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase">Fecha de vencimiento</div>'
        f'<div style="font-size:9pt;font-weight:600">{_fmt_date(inv.due_date)}</div></div>'
    ) if inv.due_date else ""
    terms_block = (
        f'<div><div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase">Términos de pago</div>'
        f'<div style="font-size:9pt;font-weight:600">{_esc(inv.payment_terms)}</div></div>'
    ) if inv.payment_terms else ""

    notes_block = (
        f'<div style="margin-top:16px;padding:10px 14px;background:#f8f9fb;border:1px solid #ddd;border-radius:6px">'
        f'<div style="font-size:9.5pt;font-weight:bold;color:#444;margin-bottom:4px">NOTAS:</div>'
        f'<div style="font-size:9pt;white-space:pre-wrap">{_esc(inv.notes)}</div></div>'
    ) if inv.notes else ""

    return f"""<div style="font-family:Arial,sans-serif;font-size:11pt;color:#111;max-width:780px;margin:0 auto;padding:24px">
  <div style="display:flex;align-items:center;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:16px;gap:14px">
    {logo_tag}
    <div style="flex:1">
      <div style="font-size:18pt;font-weight:bold;color:#1e3a5f">{_esc(co_name)}</div>
      <div style="font-size:9pt;color:#555;margin-top:2px">{_esc(co_address)}</div>
      <div style="font-size:9pt;color:#555">RUC: {_esc(co_ruc)}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:16pt;font-weight:bold;color:#1e3a5f">FACTURA</div>
      <div style="font-size:10pt;color:#444;margin-top:4px;font-family:monospace">N° {_esc(num)}</div>
    </div>
  </div>

  {msg_block}

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
    <div style="padding:8px 12px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px">
      <div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:3px">Facturar a</div>
      <div style="font-size:10.5pt;font-weight:700;color:#111">{_esc(inv.client_name or "Cliente")}</div>
      {client_ruc_row}{client_addr_row}{client_email_row}{client_phone_row}
    </div>
    <div style="padding:8px 12px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:5px;display:flex;flex-direction:column;gap:6px">
      <div>
        <div style="font-size:7pt;color:#6b7280;font-weight:bold;text-transform:uppercase">Fecha de emisión</div>
        <div style="font-size:9pt;font-weight:600">{_fmt_date(inv.date) or "—"}</div>
      </div>
      {due_date_block}{terms_block}
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:16px">
    <thead>
      <tr style="background:#1e3a5f;color:#fff">
        <th style="padding:7px 10px;text-align:left;font-size:8.5pt;border:1px solid #2d4d7a">#</th>
        <th style="padding:7px 10px;text-align:left;font-size:8.5pt;border:1px solid #2d4d7a">Descripción</th>
        <th style="padding:7px 10px;text-align:center;font-size:8.5pt;border:1px solid #2d4d7a">Cant.</th>
        <th style="padding:7px 10px;text-align:right;font-size:8.5pt;border:1px solid #2d4d7a;white-space:nowrap">Precio unit.</th>
        <th style="padding:7px 10px;text-align:right;font-size:8.5pt;border:1px solid #2d4d7a">Total</th>
      </tr>
    </thead>
    <tbody>{rows}</tbody>
  </table>

  <div style="display:flex;justify-content:flex-end">
    <div style="min-width:240px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
      <div style="display:flex;justify-content:space-between;padding:6px 14px;background:#f8f9fb;font-size:9.5pt">
        <span style="color:#555">Subtotal</span><span style="font-weight:600">${_fmt_money(subtotal)}</span>
      </div>
      {itbms_block}
      {shipping_block}
      <div style="display:flex;justify-content:space-between;padding:9px 14px;background:#1e3a5f;font-size:11pt">
        <span style="color:#fff;font-weight:bold">TOTAL A PAGAR</span><span style="color:#fff;font-weight:bold">${_fmt_money(total)}</span>
      </div>
      {payments_block}
    </div>
  </div>

  {notes_block}

  <div style="margin-top:12px;padding:7px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:5px;display:flex;gap:20px;flex-wrap:wrap;align-items:center">
    <div style="font-size:6.5pt;color:#15803d;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;flex-basis:100%;margin-bottom:2px">Información para pago · Diógenes González</div>
    <div>
      <div style="font-size:6.5pt;color:#6b7280;text-transform:uppercase;font-weight:600">Transferencia bancaria</div>
      <div style="font-size:8.5pt;color:#374151;margin-top:1px">Banco General · Cta. de ahorros</div>
      <div style="font-family:monospace;font-size:9.5pt;color:#15803d;font-weight:700;margin-top:1px">04-72-98-543918-2</div>
    </div>
    <div style="border-left:1px solid #bbf7d0;padding-left:20px">
      <div style="font-size:6.5pt;color:#6b7280;text-transform:uppercase;font-weight:600">Yappy</div>
      <div style="font-family:monospace;font-size:11pt;color:#15803d;font-weight:800;margin-top:1px">6262-4077</div>
    </div>
  </div>

  <div style="margin-top:24px;padding-top:10px;border-top:1px solid #ddd;font-size:7.5pt;color:#888;text-align:center">
    {_esc(co_name)} · {_esc(co_address)} · RUC: {_esc(co_ruc)} · Factura N° {_esc(num)}
  </div>
</div>"""


router = APIRouter(prefix="/api/facturas", tags=["invoices"])


def _next_invoice_num(db: Session) -> str:
    rows = db.query(models.Invoice.invoice_number).filter(
        models.Invoice.invoice_number.like("FAC-%"),
        models.Invoice.deleted_at.is_(None),
    ).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    return f"FAC-{(max(nums) + 1) if nums else 1:04d}"


def _check_invoice_number_unique(db: Session, number: str, exclude_id: int = None):
    q = db.query(models.Invoice).filter(
        models.Invoice.invoice_number == number,
        models.Invoice.deleted_at.is_(None),
    )
    if exclude_id:
        q = q.filter(models.Invoice.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=409, detail=f"Ya existe una factura con el número {number}")


@router.get("/next-number")
def next_invoice_number(db: Session = Depends(get_db), _=Depends(require_staff)):
    return {"number": _next_invoice_num(db)}


@router.get("/my", response_model=List[schemas.InvoiceOut])
def list_my_invoices(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Facturas del cliente autenticado: FK client_id primero; fallback por email
    solo para registros legado sin client_id. B49: eliminado matching por nombre
    (campo libre) para evitar que clientes con el mismo nombre vean facturas ajenas."""
    conditions = [models.Invoice.client_id == current_user.id]
    if current_user.email:
        conditions.append(
            and_(
                models.Invoice.client_id.is_(None),
                func.lower(models.Invoice.client_email) == current_user.email.lower(),
            )
        )
    return (
        db.query(models.Invoice)
        .filter(models.Invoice.deleted_at.is_(None))
        .filter(or_(*conditions))
        .order_by(models.Invoice.created_at.desc())
        .all()
    )


@router.get("", response_model=List[schemas.InvoiceOut])
def list_invoices(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    ticket_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.Invoice).filter(models.Invoice.deleted_at.is_(None))
    if status:
        q = q.filter(models.Invoice.status == status)
    if ticket_id is not None:
        q = q.filter(models.Invoice.ticket_id == ticket_id)
    if search:
        like = f"%{search}%"
        q = q.filter(
            models.Invoice.invoice_number.ilike(like)
            | models.Invoice.client_name.ilike(like)
            | models.Invoice.client_ruc.ilike(like)
            | models.Invoice.items.ilike(like)
            | models.Invoice.notes.ilike(like)
        )
    return q.order_by(models.Invoice.created_at.desc()).all()


@router.post("", response_model=schemas.InvoiceOut)
def create_invoice(
    data: schemas.InvoiceCreate,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    if data.invoice_number:
        _check_invoice_number_unique(db, data.invoice_number)
    invoice = models.Invoice(**data.model_dump())
    db.add(invoice)
    db.flush()
    if invoice.quote_id:
        _ensure_quote_link(invoice.id, invoice.quote_id, db)
    if invoice.status in ("Emitida", "Pagada"):
        _apply_inventory(invoice, db)
    db.commit()
    db.refresh(invoice)
    return invoice


@router.post("/from-dispatch/{dispatch_id}", response_model=schemas.InvoiceOut)
def create_from_dispatch(
    dispatch_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    """Create an invoice pre-populated with data from a dispatch."""
    dispatch = db.query(models.Dispatch).filter(models.Dispatch.id == dispatch_id).first()
    if not dispatch:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")

    invoice_number = _next_invoice_num(db)

    # Prefer quote prices (sale price) over dispatch prices (which may be zeroed purchase cost)
    quote = None
    if dispatch.order_id:
        quote = db.query(models.Quote).filter(models.Quote.order_id == dispatch.order_id).first()
    # Fallback: dispatch may be linked directly to a quote without going through an order
    if not quote and dispatch.quote_id:
        quote = db.query(models.Quote).filter(models.Quote.id == dispatch.quote_id).first()

    if quote and quote.items:
        inv_items = quote.items
        inv_subtotal = quote.subtotal
        inv_itbms_amount = quote.itbms_amount
        inv_total = quote.total
        inv_itbms_enabled = quote.itbms_enabled
    else:
        inv_items = dispatch.items
        inv_subtotal = dispatch.subtotal
        inv_itbms_amount = dispatch.itbms_amount
        inv_total = dispatch.total
        inv_itbms_enabled = dispatch.itbms_enabled

    # Client data: dispatch fields take priority; quote fills gaps and provides email/phone
    inv_client_name    = dispatch.client_name    or (quote.client_name    if quote else None)
    inv_client_ruc     = dispatch.client_ruc     or (quote.client_ruc     if quote else None)
    inv_client_address = dispatch.client_address or (quote.client_address if quote else None)
    inv_client_email   = (quote.client_email if quote else None)
    inv_client_phone   = (quote.client_phone if quote else None)

    inv_payment_terms = (quote.payment_terms if quote else None)

    invoice = models.Invoice(
        invoice_number=invoice_number,
        status="Borrador",
        dispatch_id=dispatch_id,
        client_name=inv_client_name,
        client_ruc=inv_client_ruc,
        client_address=inv_client_address,
        client_email=inv_client_email,
        client_phone=inv_client_phone,
        date=dispatch.delivery_date or dispatch.date or date.today(),
        items=inv_items,
        itbms_enabled=inv_itbms_enabled,
        subtotal=inv_subtotal,
        itbms_amount=inv_itbms_amount,
        total=inv_total,
        payment_terms=inv_payment_terms,
        notes=dispatch.notes,
    )
    db.add(invoice)
    db.flush()
    if quote:
        _ensure_quote_link(invoice.id, quote.id, db)
    db.commit()
    db.refresh(invoice)
    return invoice


@router.post("/{invoice_id}/clone", response_model=schemas.InvoiceOut)
def clone_invoice(invoice_id: int, db: Session = Depends(get_db), _=Depends(require_staff)):
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    new_number = _next_invoice_num(db)
    clone = models.Invoice(
        invoice_number=new_number,
        status="Borrador",
        client_name=inv.client_name,
        client_ruc=inv.client_ruc,
        client_address=inv.client_address,
        client_email=inv.client_email,
        client_phone=inv.client_phone,
        date=date.today(),
        items=inv.items,
        itbms_enabled=inv.itbms_enabled,
        subtotal=inv.subtotal,
        itbms_amount=inv.itbms_amount,
        total=inv.total,
        payment_terms=inv.payment_terms,
        notes=inv.notes,
        ticket_id=inv.ticket_id,
        inventory_applied=False,
    )
    db.add(clone)
    db.commit()
    db.refresh(clone)
    return clone


@router.get("/{invoice_id}", response_model=schemas.InvoiceOut)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return inv


def _ensure_quote_link(invoice_id: int, quote_id: int, db: Session):
    exists = db.query(models.InvoiceQuoteLink).filter_by(invoice_id=invoice_id, quote_id=quote_id).first()
    if not exists:
        db.add(models.InvoiceQuoteLink(invoice_id=invoice_id, quote_id=quote_id))


def _apply_inventory(inv: models.Invoice, db: Session):
    """Deduct item quantities from inventory when invoice becomes Emitida.
    Only items with an inventory code are deducted; service/non-merchandise items are skipped.
    Automatically creates a dispatch note for the deducted items if none is linked yet."""
    if inv.inventory_applied:
        return
    try:
        items = json.loads(inv.items or "[]")
    except Exception:
        return

    dispatched_items = []
    for it in items:
        code = (it.get("code") or "").strip()
        if not code:
            continue
        qty = float(it.get("qty") or 0)
        if qty <= 0:
            continue
        inv_item = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if not inv_item:
            continue
        try:
            current = float(inv_item.quantity or "0")
        except (ValueError, TypeError):
            current = 0.0
        new_qty = max(0.0, current - qty)
        actual_delta = current - new_qty
        inv_item.quantity = f"{new_qty:.4f}".rstrip('0').rstrip('.') or "0"
        db.add(models.InventoryTransaction(
            item_code=code,
            qty_delta=f"-{actual_delta:.4f}".rstrip('0').rstrip('.'),
            source_type="invoice",
            source_id=inv.id,
        ))
        dispatched_items.append(it)

    inv.inventory_applied = True

    # Auto-create dispatch note when no dispatch is linked yet
    if dispatched_items and not inv.dispatch_id:
        _auto_create_dispatch(inv, dispatched_items, db)


def _auto_create_dispatch(inv: models.Invoice, dispatch_items: list, db: Session):
    """Create a dispatch note linked to the invoice, containing only the inventory items."""
    rows = db.query(models.Dispatch.dispatch_number).filter(
        models.Dispatch.dispatch_number.like("DSP-%"),
        models.Dispatch.deleted_at.is_(None),
    ).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    dispatch_number = f"DSP-{(max(nums) + 1) if nums else 1:04d}"

    subtotal = sum(
        round((float(it.get("qty") or 0)) * (float(it.get("unit_price") or 0)), 2)
        for it in dispatch_items
    )
    itbms_amount = math.ceil(subtotal * 0.07 * 100) / 100 if inv.itbms_enabled else 0.0
    total = subtotal + itbms_amount

    dispatch = models.Dispatch(
        title=f"Despacho {inv.invoice_number or f'FAC-{inv.id}'}",
        dispatch_number=dispatch_number,
        status="Entregado",
        client_name=inv.client_name,
        client_ruc=inv.client_ruc,
        client_address=inv.client_address,
        date=inv.date,
        items=json.dumps(dispatch_items),
        itbms_enabled=inv.itbms_enabled,
        subtotal=str(round(subtotal, 2)),
        itbms_amount=str(round(itbms_amount, 2)),
        total=str(round(total, 2)),
        inventory_applied=True,
    )
    db.add(dispatch)
    db.flush()
    inv.dispatch_id = dispatch.id


@router.put("/{invoice_id}", response_model=schemas.InvoiceOut)
def update_invoice(
    invoice_id: int,
    data: schemas.InvoiceUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if data.invoice_number and data.invoice_number != inv.invoice_number:
        _check_invoice_number_unique(db, data.invoice_number, exclude_id=invoice_id)
    old_status = inv.status
    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(inv, field, value)
    if inv.quote_id and "quote_id" in updates:
        _ensure_quote_link(inv.id, inv.quote_id, db)
    _ESTADOS_FINALES = ("Emitida", "Pagada")
    if old_status in _ESTADOS_FINALES and inv.status not in _ESTADOS_FINALES:
        raise HTTPException(
            status_code=400,
            detail=f"No se puede revertir una factura '{old_status}' a '{inv.status}'. Use Anular si corresponde."
        )
    if inv.status in _ESTADOS_FINALES and old_status not in _ESTADOS_FINALES:
        _apply_inventory(inv, db)
    db.commit()
    db.refresh(inv)
    return inv


@router.post("/cleanup-duplicate-links")
def cleanup_duplicate_links(
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    """Remove duplicate InvoiceQuoteLink rows, keeping only one per (invoice_id, quote_id) pair."""
    from sqlalchemy import text
    rows = db.query(models.InvoiceQuoteLink).order_by(models.InvoiceQuoteLink.id).all()
    seen, to_delete = set(), []
    for row in rows:
        key = (row.invoice_id, row.quote_id)
        if key in seen:
            to_delete.append(row.id)
        else:
            seen.add(key)
    if to_delete:
        db.query(models.InvoiceQuoteLink).filter(models.InvoiceQuoteLink.id.in_(to_delete)).delete(synchronize_session=False)
        db.commit()
    return {"deleted": len(to_delete), "remaining": len(seen)}


@router.post("/{invoice_id}/quote-links", status_code=201)
def add_quote_link(
    invoice_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id, models.Invoice.deleted_at.is_(None)).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    quote_id = body.get("quote_id")
    if not quote_id:
        raise HTTPException(status_code=400, detail="quote_id requerido")
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id, models.Quote.deleted_at.is_(None)).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    stmt = pg_insert(models.InvoiceQuoteLink.__table__).values(
        invoice_id=invoice_id, quote_id=quote_id
    ).on_conflict_do_nothing(constraint="uq_invoice_quote_link")
    db.execute(stmt)
    db.commit()
    db.refresh(inv)
    return inv


@router.delete("/{invoice_id}/quote-links/{quote_id}")
def remove_quote_link(
    invoice_id: int,
    quote_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    link = db.query(models.InvoiceQuoteLink).filter_by(invoice_id=invoice_id, quote_id=quote_id).first()
    if link:
        db.delete(link)
        db.commit()
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    db.refresh(inv)
    return inv


@router.post("/{invoice_id}/send-email")
def send_invoice_email(
    invoice_id: int,
    body: SendEmailBody,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")

    api_key = _get_setting(db, "brevo_api_key") or None
    host = _get_setting(db, "smtp_host")
    if not host and not api_key:
        raise HTTPException(status_code=400, detail="Configure el servidor SMTP o la API key de Brevo en Ajustes")
    port = _get_setting(db, "smtp_port") or "587"
    user = _get_setting(db, "smtp_user")
    password = _get_setting(db, "smtp_password")
    from_addr = _get_setting(db, "smtp_from") or user
    use_tls = (_get_setting(db, "smtp_tls") or "true").lower() == "true"

    num = inv.invoice_number or f"#{inv.id}"
    co_name = (_get_setting(db, "company_name") or "DG Solutions")
    subject = f"Factura {num} — {co_name}"
    html = _build_invoice_email_html(inv, body.message, db)

    # Generate PDF attachment with Playwright (headless Chrome)
    file_attachments = None
    try:
        from routers.settings import _invoice_to_pdf
        pdf_bytes = _invoice_to_pdf(inv, db)
        if pdf_bytes:
            file_attachments = [(f"Factura-{num}.pdf", pdf_bytes, "application/pdf")]
    except Exception as e:
        logging.warning("Could not generate PDF for invoice %s: %s", invoice_id, e)

    try:
        _send_with_logo(host, port, user, password, from_addr, use_tls, body.to, subject, html,
                        api_key=api_key, file_attachments=file_attachments)
    except Exception as e:
        logging.warning("Invoice email failed for invoice %s: %s", invoice_id, e)
        raise HTTPException(status_code=400, detail=str(e))

    return {"ok": True}


def _parse_amt(raw: str) -> float:
    import re
    cleaned = re.sub(r"[^\d.]", "", raw or "0")
    try:
        return float(cleaned or "0")
    except ValueError:
        return 0.0


PAYMENT_METHODS = {"Efectivo", "Tarjeta", "Transferencia", "Cheque", "Yappy"}

_CSV_METHOD_MAP = {
    "efectivo": "Efectivo",
    "cash": "Efectivo",
    "transferencia bancaria": "Transferencia",
    "remesa bancaria": "Transferencia",
    "transferencia": "Transferencia",
    "tarjeta de crédito": "Tarjeta",
    "tarjeta de credito": "Tarjeta",
    "tarjeta": "Tarjeta",
    "cheque": "Cheque",
    "yappy": "Yappy",
}


@router.get("/payments/all", response_model=List[schemas.InvoicePaymentWithInvoice])
def list_all_payments(
    method: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = (
        db.query(models.InvoicePayment)
        .join(models.Invoice, models.InvoicePayment.invoice_id == models.Invoice.id)
        .filter(models.Invoice.deleted_at.is_(None))
    )
    if method:
        q = q.filter(models.InvoicePayment.method == method)
    if date_from:
        q = q.filter(models.InvoicePayment.date >= date_from)
    if date_to:
        q = q.filter(models.InvoicePayment.date <= date_to)
    payments = q.order_by(models.InvoicePayment.date.desc(), models.InvoicePayment.created_at.desc()).all()
    result = []
    for p in payments:
        out = schemas.InvoicePaymentWithInvoice.model_validate(p)
        out.invoice_number = p.invoice.invoice_number if p.invoice else None
        out.client_name = p.invoice.client_name if p.invoice else None
        out.invoice_status = p.invoice.status if p.invoice else None
        result.append(out)
    return result


@router.put("/{invoice_id}/payments/{payment_id}", response_model=schemas.InvoicePaymentOut)
def update_payment(
    invoice_id: int,
    payment_id: int,
    data: schemas.InvoicePaymentUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    payment = db.query(models.InvoicePayment).filter(
        models.InvoicePayment.id == payment_id,
        models.InvoicePayment.invoice_id == invoice_id,
    ).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    if data.method is not None and data.method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail=f"Método inválido. Usa: {', '.join(PAYMENT_METHODS)}")
    if data.amount is not None:
        payment.amount = str(_parse_amt(data.amount))
    if data.method is not None:
        payment.method = data.method
    if data.date is not None:
        try:
            payment.date = date.fromisoformat(data.date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Fecha inválida")
    if data.notes is not None:
        payment.notes = data.notes or None

    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if inv:
        total_paid = sum(_parse_amt(p.amount) for p in inv.payments)
        invoice_total = _parse_amt(inv.total or "0")
        if invoice_total > 0 and total_paid >= invoice_total:
            inv.status = "Pagada"
        elif inv.status == "Pagada":
            inv.status = "Emitida"

    db.commit()
    db.refresh(payment)
    return payment


@router.get("/{invoice_id}/payments", response_model=List[schemas.InvoicePaymentOut])
def list_payments(invoice_id: int, db: Session = Depends(get_db), _=Depends(require_staff)):
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return inv.payments


@router.post("/{invoice_id}/payments", response_model=schemas.InvoicePaymentOut)
def add_payment(
    invoice_id: int,
    data: schemas.InvoicePaymentCreate,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if data.method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail=f"Método inválido. Usa: {', '.join(PAYMENT_METHODS)}")
    try:
        pay_date = date.fromisoformat(data.date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Fecha inválida")

    payment = models.InvoicePayment(
        invoice_id=invoice_id,
        amount=str(_parse_amt(data.amount)),
        method=data.method,
        date=pay_date,
        notes=data.notes or None,
    )
    db.add(payment)
    db.flush()

    # Auto-update invoice status when fully paid
    total_paid = sum(_parse_amt(p.amount) for p in inv.payments) + _parse_amt(payment.amount)
    invoice_total = _parse_amt(inv.total or "0")
    if invoice_total > 0 and total_paid >= invoice_total:
        inv.status = "Pagada"

    db.commit()
    db.refresh(payment)
    return payment


@router.delete("/{invoice_id}/payments/{payment_id}")
def delete_payment(
    invoice_id: int,
    payment_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    payment = db.query(models.InvoicePayment).filter(
        models.InvoicePayment.id == payment_id,
        models.InvoicePayment.invoice_id == invoice_id,
    ).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    db.delete(payment)

    # Revert status to Emitida if invoice no longer fully paid
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    remaining = [p for p in inv.payments if p.id != payment_id]
    total_paid = sum(_parse_amt(p.amount) for p in remaining)
    invoice_total = _parse_amt(inv.total or "0")
    if inv.status == "Pagada" and (invoice_total <= 0 or total_paid < invoice_total):
        inv.status = "Emitida"

    db.commit()
    return {"ok": True}


@router.post("/validate-items")
def validate_invoice_items(
    data: dict,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    """Check if items with codes exist in inventory. Items without code are treated as services."""
    items = data.get("items", [])
    missing = []
    for it in items:
        code = (it.get("code") or "").strip()
        if not code:
            continue
        inv_item = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if not inv_item:
            missing.append({
                "code": code,
                "description": (it.get("description") or "").strip(),
            })
    return {"ok": len(missing) == 0, "missing": missing}


@router.get("/{invoice_id}/check-inventory")
def check_invoice_inventory(
    invoice_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    try:
        items = json.loads(inv.items or "[]")
    except Exception:
        items = []
    warnings = []
    for it in items:
        code = (it.get("code") or "").strip()
        if not code:
            continue
        qty = float(it.get("qty") or 0)
        if qty <= 0:
            continue
        inv_item = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if not inv_item:
            continue
        try:
            available = float(inv_item.quantity or "0")
        except (ValueError, TypeError):
            available = 0.0
        if qty > available:
            warnings.append({
                "code": code,
                "name": inv_item.name,
                "requested": qty,
                "available": available,
            })
    return {"ok": len(warnings) == 0, "warnings": warnings}


@router.post("/{invoice_id}/apply-inventory", response_model=schemas.InvoiceOut)
def apply_invoice_inventory(
    invoice_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    inv.inventory_applied = False
    _apply_inventory(inv, db)
    db.commit()
    db.refresh(inv)
    return inv


@router.get("/{invoice_id}/cogs")
def get_invoice_cogs(invoice_id: int, db: Session = Depends(get_db), _=Depends(require_staff)):
    """Costo de mercancía vendida: suma cost_price × qty por cada artículo con código en la factura."""
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    try:
        items = json.loads(inv.items or "[]")
    except Exception:
        items = []

    lines = []
    total_cost = 0.0
    for it in items:
        code = (it.get("code") or "").strip()
        if not code:
            continue
        qty = float(it.get("qty") or 0)
        if qty <= 0:
            continue
        inv_item = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if not inv_item:
            continue
        cost = float(inv_item.cost_price or "0") if inv_item.cost_price else 0.0
        if cost <= 0:
            continue
        line_cost = qty * cost
        total_cost += line_cost
        lines.append({
            "code": code,
            "name": inv_item.name,
            "qty": qty,
            "cost_price": cost,
            "line_cost": line_cost,
        })

    return {"total": round(total_cost, 2), "lines": lines}


@router.get("/{invoice_id}/expenses", response_model=List[schemas.ExpenseOut])
def list_invoice_expenses(invoice_id: int, db: Session = Depends(get_db), _=Depends(require_staff)):
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return db.query(models.Expense).filter(
        models.Expense.invoice_id == invoice_id,
        models.Expense.deleted_at.is_(None),
    ).order_by(models.Expense.id).all()


@router.put("/{invoice_id}/expenses", response_model=List[schemas.ExpenseOut])
def sync_invoice_expenses(
    invoice_id: int,
    items: List[schemas.InvoiceExpenseItem],
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    inv = db.query(models.Invoice).filter(models.Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if len(items) > 5:
        raise HTTPException(status_code=400, detail="Máximo 5 gastos por factura")

    today = date.today().isoformat()
    incoming_ids = {it.id for it in items if it.id}

    # Eliminar los que ya no vienen; los de tipo "pedido" son auto-gestionados por sync_order_expense
    existing = db.query(models.Expense).filter(
        models.Expense.invoice_id == invoice_id,
        models.Expense.deleted_at.is_(None),
        models.Expense.type != "pedido",
    ).all()
    for exp in existing:
        if exp.id not in incoming_ids:
            exp.deleted_at = datetime.now(timezone.utc)

    result = []
    for it in items:
        if it.id:
            exp = db.query(models.Expense).filter(models.Expense.id == it.id).first()
            if exp:
                exp.concept    = it.concept
                exp.amount     = it.amount
                exp.supplier   = it.supplier
                exp.is_payable = it.is_payable
                exp.due_date   = it.due_date
                exp.paid_at    = it.paid_at
                result.append(exp)
        else:
            exp = models.Expense(
                concept    = it.concept,
                amount     = it.amount,
                supplier   = it.supplier,
                is_payable = it.is_payable,
                due_date   = it.due_date,
                paid_at    = it.paid_at,
                category   = "Servicio profesional",
                date       = today,
                type       = "factura",
                invoice_id = invoice_id,
            )
            db.add(exp)
            result.append(exp)

    db.commit()
    for exp in result:
        db.refresh(exp)
    return result


@router.post("/import-payments-csv")
async def import_payments_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    imported = []
    skipped = []

    for row in reader:
        pay_date = (row.get("Date") or "").strip()
        if not pay_date.startswith("2026-"):
            continue

        inv_num = (row.get("Invoice Number") or "").strip()
        amount_raw = (row.get("Amount") or "0").strip()
        mode_raw = (row.get("Mode") or "").strip()
        customer = (row.get("Customer Name") or "").strip()
        ref = (row.get("Reference Number") or "").strip()

        try:
            amount = float(amount_raw)
        except ValueError:
            skipped.append({"invoice": inv_num, "client": customer, "reason": "Monto inválido"})
            continue

        if amount <= 0:
            skipped.append({"invoice": inv_num, "client": customer, "reason": "Monto cero"})
            continue

        method = _CSV_METHOD_MAP.get(mode_raw.lower(), "Efectivo")

        inv = db.query(models.Invoice).filter(
            models.Invoice.invoice_number == inv_num,
            models.Invoice.deleted_at.is_(None),
        ).first()

        if not inv:
            skipped.append({"invoice": inv_num, "client": customer, "amount": amount, "date": pay_date})
            continue

        # Skip duplicate: same invoice + same amount + same date
        existing = db.query(models.InvoicePayment).filter(
            models.InvoicePayment.invoice_id == inv.id,
            models.InvoicePayment.date == date.fromisoformat(pay_date),
            models.InvoicePayment.amount == str(amount),
        ).first()
        if existing:
            skipped.append({"invoice": inv_num, "client": customer, "amount": amount, "date": pay_date, "reason": "Duplicado"})
            continue

        payment = models.InvoicePayment(
            invoice_id=inv.id,
            amount=str(amount),
            method=method,
            date=date.fromisoformat(pay_date),
            notes=ref or None,
        )
        db.add(payment)
        db.flush()

        total_paid = sum(_parse_amt(p.amount) for p in inv.payments) + amount
        invoice_total = _parse_amt(inv.total or "0")
        if invoice_total > 0 and total_paid >= invoice_total:
            inv.status = "Pagada"

        imported.append({"invoice": inv_num, "client": customer, "amount": amount, "date": pay_date})

    db.commit()
    return {"imported": len(imported), "skipped": len(skipped), "imported_list": imported, "skipped_list": skipped}


def _reverse_invoice_inventory(inv: models.Invoice, db: Session):
    if not inv.inventory_applied:
        return
    try:
        items = json.loads(inv.items or "[]")
    except Exception:
        return
    for it in items:
        code = (it.get("code") or "").strip()
        if not code:
            continue
        qty = float(it.get("qty") or 0)
        if qty <= 0:
            continue
        inv_item = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if not inv_item:
            continue
        try:
            current = float(inv_item.quantity or "0")
        except (ValueError, TypeError):
            current = 0.0
        new_qty = current + qty
        inv_item.quantity = f"{new_qty:.4f}".rstrip('0').rstrip('.') or "0"
        db.add(models.InventoryTransaction(
            item_code=code,
            qty_delta=f"+{qty:.4f}".rstrip('0').rstrip('.'),
            source_type="invoice_delete",
            source_id=inv.id,
        ))
    inv.inventory_applied = False


@router.delete("/{invoice_id}")
def delete_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    inv = db.query(models.Invoice).filter(
        models.Invoice.id == invoice_id,
        models.Invoice.deleted_at.is_(None),
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if inv.inventory_applied:
        _reverse_invoice_inventory(inv, db)
    inv.deleted_at = datetime.now(timezone.utc)
    log_action(db, current_user, "delete", "factura", inv.id, inv.invoice_number or f"#{inv.id}")
    db.commit()
    return {"ok": True}


# ── DGI Attachment ─────────────────────────────────────

def _get_invoice_or_404(invoice_id: int, db: Session):
    inv = db.query(models.Invoice).filter(
        models.Invoice.id == invoice_id,
        models.Invoice.deleted_at.is_(None),
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return inv


@router.post("/{invoice_id}/dgi-attachment")
async def upload_dgi_attachment(
    invoice_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    inv = _get_invoice_or_404(invoice_id, db)
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Solo se permiten archivos PDF")
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="El archivo excede 20MB")

    inv_dir = os.path.join(UPLOAD_DIR, "invoices_dgi", str(invoice_id))
    os.makedirs(inv_dir, exist_ok=True)

    # Remove old file if exists
    if inv.dgi_filename:
        old_path = os.path.join(inv_dir, inv.dgi_filename)
        if os.path.exists(old_path):
            os.remove(old_path)

    stored_name = f"{uuid.uuid4()}.pdf"
    with open(os.path.join(inv_dir, stored_name), "wb") as f:
        f.write(content)

    inv.dgi_filename = stored_name
    inv.dgi_original_name = file.filename or stored_name
    db.commit()
    return {"ok": True, "original_name": inv.dgi_original_name}


@router.get("/{invoice_id}/dgi-attachment")
def download_dgi_attachment(
    invoice_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    inv = _get_invoice_or_404(invoice_id, db)
    if not inv.dgi_filename:
        raise HTTPException(status_code=404, detail="No hay factura DGI adjunta")
    if not _SAFE_FNAME.match(inv.dgi_filename):
        raise HTTPException(status_code=404)
    file_path = os.path.join(UPLOAD_DIR, "invoices_dgi", str(invoice_id), inv.dgi_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado en disco")
    return FileResponse(file_path, filename=inv.dgi_original_name, media_type="application/pdf")


@router.get("/{invoice_id}/dgi-attachment/my")
def download_dgi_attachment_client(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Client-accessible: download DGI PDF for an invoice that belongs to the authenticated user."""
    inv = _get_invoice_or_404(invoice_id, db)
    email_match = (
        inv.client_email and current_user.email and
        inv.client_email.lower() == current_user.email.lower()
    )
    name_match = inv.client_name and (
        inv.client_name.lower() == (current_user.name or "").lower() or
        (current_user.company and inv.client_name.lower() == current_user.company.lower())
    )
    if not (email_match or name_match):
        raise HTTPException(status_code=403, detail="No autorizado")
    if not inv.dgi_filename:
        raise HTTPException(status_code=404, detail="No hay factura DGI adjunta")
    if not _SAFE_FNAME.match(inv.dgi_filename):
        raise HTTPException(status_code=404)
    file_path = os.path.join(UPLOAD_DIR, "invoices_dgi", str(invoice_id), inv.dgi_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado en disco")
    return FileResponse(file_path, filename=inv.dgi_original_name, media_type="application/pdf")


@router.delete("/{invoice_id}/dgi-attachment")
def delete_dgi_attachment(
    invoice_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    inv = _get_invoice_or_404(invoice_id, db)
    if not inv.dgi_filename:
        raise HTTPException(status_code=404, detail="No hay factura DGI adjunta")
    file_path = os.path.join(UPLOAD_DIR, "invoices_dgi", str(invoice_id), inv.dgi_filename)
    if os.path.exists(file_path):
        os.remove(file_path)
    inv.dgi_filename = None
    inv.dgi_original_name = None
    db.commit()
    return {"ok": True}


# ── Invoice Attachments (up to 5 general files) ───────────────────────────────

def _attachment_dir(invoice_id: int) -> str:
    return os.path.join(UPLOAD_DIR, "invoice_attachments", str(invoice_id))


def _check_client_owns_invoice(inv: models.Invoice, current_user: models.User):
    # B49: prefer FK match; fall back to email only (not name) for legacy records
    if inv.client_id and inv.client_id == current_user.id:
        return
    if not inv.client_id:
        email_match = (
            inv.client_email and current_user.email and
            inv.client_email.lower() == current_user.email.lower()
        )
        if email_match:
            return
    raise HTTPException(status_code=403, detail="No autorizado")


@router.get("/{invoice_id}/attachments", response_model=List[schemas.InvoiceAttachmentOut])
def list_invoice_attachments(
    invoice_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    _get_invoice_or_404(invoice_id, db)
    return db.query(models.InvoiceAttachment).filter(
        models.InvoiceAttachment.invoice_id == invoice_id
    ).order_by(models.InvoiceAttachment.created_at).all()


@router.post("/{invoice_id}/attachments", response_model=schemas.InvoiceAttachmentOut)
async def upload_invoice_attachment(
    invoice_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    inv = _get_invoice_or_404(invoice_id, db)
    count = db.query(models.InvoiceAttachment).filter(
        models.InvoiceAttachment.invoice_id == invoice_id
    ).count()
    if count >= 5:
        raise HTTPException(status_code=400, detail="Máximo 5 adjuntos por factura")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="El archivo excede 20 MB")

    ext = os.path.splitext(file.filename or "file")[1].lower()
    stored_name = f"{uuid.uuid4()}{ext}"
    att_dir = _attachment_dir(invoice_id)
    os.makedirs(att_dir, exist_ok=True)
    with open(os.path.join(att_dir, stored_name), "wb") as f:
        f.write(content)

    att = models.InvoiceAttachment(
        invoice_id=invoice_id,
        filename=stored_name,
        original_name=file.filename or stored_name,
        file_size=len(content),
        content_type=file.content_type,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


@router.get("/{invoice_id}/attachments/{att_id}/download")
def download_invoice_attachment(
    invoice_id: int,
    att_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    att = db.query(models.InvoiceAttachment).filter(
        models.InvoiceAttachment.id == att_id,
        models.InvoiceAttachment.invoice_id == invoice_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    file_path = os.path.join(_attachment_dir(invoice_id), att.filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado en disco")
    return FileResponse(file_path, filename=att.original_name, media_type=att.content_type or "application/octet-stream")


@router.get("/{invoice_id}/attachments/{att_id}/my")
def download_invoice_attachment_client(
    invoice_id: int,
    att_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    inv = _get_invoice_or_404(invoice_id, db)
    _check_client_owns_invoice(inv, current_user)
    att = db.query(models.InvoiceAttachment).filter(
        models.InvoiceAttachment.id == att_id,
        models.InvoiceAttachment.invoice_id == invoice_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    file_path = os.path.join(_attachment_dir(invoice_id), att.filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado en disco")
    return FileResponse(file_path, filename=att.original_name, media_type=att.content_type or "application/octet-stream")


@router.delete("/{invoice_id}/attachments/{att_id}")
def delete_invoice_attachment(
    invoice_id: int,
    att_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    att = db.query(models.InvoiceAttachment).filter(
        models.InvoiceAttachment.id == att_id,
        models.InvoiceAttachment.invoice_id == invoice_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    file_path = os.path.join(_attachment_dir(invoice_id), att.filename)
    if os.path.exists(file_path):
        os.remove(file_path)
    db.delete(att)
    db.commit()
    return {"ok": True}
