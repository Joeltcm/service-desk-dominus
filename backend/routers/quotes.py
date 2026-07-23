from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone
from pydantic import BaseModel
import base64
import json
import logging

from sqlalchemy import or_, and_, func
from database import get_db
from auth import require_staff, get_current_user
from routers.settings import _get_setting, _send_with_logo, _load_logo
from audit_helper import log_action
import models, schemas


class SendEmailBody(BaseModel):
    to: str
    message: Optional[str] = None


def _parse_money(s) -> float:
    if not s:
        return 0.0
    try:
        return float(str(s).replace("$", "").replace(",", "").strip())
    except Exception:
        return 0.0


def _logo_img_tag() -> str:
    # Logo is attached as CID by _send_with_logo — reference via cid:img_logo
    return '<img src="cid:img_logo" width="52" height="52" alt="DG Solutions" style="border-radius:10px;display:block;background:#fff;padding:4px" />'


def _build_quote_email_html(quote: models.Quote, message: Optional[str], db=None, _logo=None) -> str:
    logo_tag = _logo if _logo is not None else _logo_img_tag()
    num = quote.quote_number or f"#{quote.id}"
    client = quote.client_name or "Cliente"
    date_str = str(quote.date) if quote.date else "—"
    co_name    = (_get_setting(db, "company_name")    if db else "") or "DG Solutions"
    co_address = (_get_setting(db, "company_address") if db else "") or "Panamá, Punta Pacífica"
    co_ruc     = (_get_setting(db, "company_ruc")     if db else "") or "4-754-575 DV 85"

    try:
        items = json.loads(quote.items or "[]")
    except Exception:
        items = []

    subtotal = sum((float(it.get("qty") or 0)) * (float(it.get("unit_price") or 0)) for it in items)
    itbms = subtotal * 0.07 if quote.itbms_enabled else 0.0
    import re as _re
    shipping = float(_re.sub(r"[^\d.]", "", str(quote.shipping_cost or "0")) or "0")
    total = subtotal + itbms + shipping

    rows = ""
    for it in items:
        if not str(it.get("description", "")).strip():
            continue
        line = float(it.get("qty") or 0) * float(it.get("unit_price") or 0)
        rows += f"""<tr>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1f2937">{it.get('description','')}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:13px;color:#374151">{it.get('qty','')}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;color:#374151">${float(it.get('unit_price') or 0):.2f}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:600;color:#111827">${line:.2f}</td>
        </tr>"""

    msg_block = ""
    if message:
        msg_block = f"""<div style="background:#f0f9ff;border-left:4px solid #3b82f6;border-radius:4px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#1e40af;line-height:1.6">
            {message.replace(chr(10), '<br>')}
        </div>"""

    itbms_row = ""
    if quote.itbms_enabled:
        itbms_row = f'<tr><td colspan="3" style="padding:5px 10px;text-align:right;font-size:13px;color:#b45309">ITBMS 7%</td><td style="padding:5px 10px;text-align:right;font-size:13px;color:#b45309">${itbms:.2f}</td></tr>'

    shipping_row = ""
    if shipping > 0:
        shipping_row = f'<tr><td colspan="3" style="padding:5px 10px;text-align:right;font-size:13px;color:#555">Costo de entrega</td><td style="padding:5px 10px;text-align:right;font-size:13px;color:#374151">${shipping:.2f}</td></tr>'

    return f"""<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#111827">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e3a5f;border-radius:10px 10px 0 0;border-collapse:collapse">
    <tr>
      <td style="padding:14px 12px 14px 20px;width:60px;vertical-align:middle">
        {logo_tag}
      </td>
      <td style="padding:14px 20px 14px 8px;vertical-align:middle">
        <div style="color:#fff;font-size:18px;font-weight:700;line-height:1.2">{co_name}</div>
        <div style="color:#93c5fd;font-size:11px;margin-top:3px">{co_address} · RUC: {co_ruc}</div>
      </td>
    </tr>
  </table>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:24px 28px">
    <div style="font-size:20px;font-weight:700;color:#1e3a5f;margin-bottom:4px">COTIZACIÓN {num}</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:16px">Cliente: <strong>{client}</strong> · Fecha: {date_str}</div>
    {msg_block}
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;border-bottom:2px solid #e5e7eb">Descripción</th>
          <th style="padding:8px 10px;text-align:center;font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;border-bottom:2px solid #e5e7eb">Cant.</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;border-bottom:2px solid #e5e7eb">Precio unit.</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;border-bottom:2px solid #e5e7eb">Subtotal</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
      <tfoot>
        <tr><td colspan="3" style="padding:5px 10px;text-align:right;font-size:13px;color:#6b7280">Subtotal</td><td style="padding:5px 10px;text-align:right;font-size:13px;color:#374151">${subtotal:.2f}</td></tr>
        {itbms_row}
        {shipping_row}
        <tr style="background:#1e3a5f"><td colspan="3" style="padding:8px 10px;text-align:right;font-size:14px;font-weight:700;color:#fff">TOTAL</td><td style="padding:8px 10px;text-align:right;font-size:14px;font-weight:700;color:#fff">${total:.2f}</td></tr>
      </tfoot>
    </table>
    {f'<div style="font-size:12px;color:#9ca3af;margin-top:4px">Válida hasta: {quote.valid_until}</div>' if quote.valid_until else ''}
    {f'<div style="font-size:12px;color:#6b7280;margin-top:8px;padding-top:8px;border-top:1px solid #f1f5f9;white-space:pre-line">{quote.notes}</div>' if quote.notes else ''}
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center">{co_name} · {co_address} · RUC: {co_ruc}</div>
  </div>
</div>"""

router = APIRouter(prefix="/api/quotes", tags=["quotes"])


def _next_quote_num(db: Session) -> str:
    rows = db.query(models.Quote.quote_number).filter(
        models.Quote.quote_number.like("COT-%"),
        models.Quote.deleted_at.is_(None),
    ).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    return f"COT-{(max(nums) + 1) if nums else 1:04d}"


def _check_quote_number_unique(db: Session, number: str, exclude_id: int = None):
    q = db.query(models.Quote).filter(
        models.Quote.quote_number == number,
        models.Quote.deleted_at.is_(None),
    )
    if exclude_id:
        q = q.filter(models.Quote.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=409, detail=f"Ya existe una cotización con el número {number}")


@router.get("/next-number")
def next_quote_number(db: Session = Depends(get_db), _=Depends(require_staff)):
    return {"number": _next_quote_num(db)}


@router.get("/my", response_model=List[schemas.QuoteOut])
def list_my_quotes(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Cotizaciones del cliente autenticado: FK client_id primero; fallback por email
    solo para registros legado sin client_id. B49: eliminado matching por nombre."""
    conditions = [models.Quote.client_id == current_user.id]
    if current_user.email:
        conditions.append(
            and_(
                models.Quote.client_id.is_(None),
                func.lower(models.Quote.client_email) == current_user.email.lower(),
            )
        )
    return (
        db.query(models.Quote)
        .filter(models.Quote.deleted_at.is_(None))
        .filter(or_(*conditions))
        .order_by(models.Quote.created_at.desc())
        .all()
    )


@router.get("", response_model=List[schemas.QuoteOut])
def list_quotes(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    ticket_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.Quote).filter(models.Quote.deleted_at.is_(None))
    if status:
        q = q.filter(models.Quote.status == status)
    if ticket_id is not None:
        q = q.filter(models.Quote.ticket_id == ticket_id)
    if search:
        like = f"%{search}%"
        q = q.filter(
            models.Quote.title.ilike(like)
            | models.Quote.client_name.ilike(like)
            | models.Quote.quote_number.ilike(like)
            | models.Quote.items.ilike(like)
            | models.Quote.notes.ilike(like)
        )
    return q.order_by(models.Quote.created_at.desc()).all()


@router.get("/item-suggestions")
def item_suggestions(
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    """Distinct item descriptions from quotes + orders to power autocomplete."""
    seen: set = set()
    results: list = []

    for (items_json,) in db.query(models.Quote.items).filter(models.Quote.items.isnot(None)).all():
        try:
            for it in json.loads(items_json):
                desc = (it.get("description") or "").strip()
                if desc and desc not in seen:
                    seen.add(desc)
                    results.append(desc)
        except Exception:
            pass

    for (items_json,) in db.query(models.Order.purchase_items).filter(models.Order.purchase_items.isnot(None)).all():
        try:
            for it in json.loads(items_json):
                desc = (it.get("description") or "").strip()
                if desc and desc not in seen:
                    seen.add(desc)
                    results.append(desc)
        except Exception:
            pass

    return results[:150]


@router.post("", response_model=schemas.QuoteOut)
def create_quote(
    data: schemas.QuoteCreate,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    if data.quote_number:
        _check_quote_number_unique(db, data.quote_number)
    quote = models.Quote(**data.model_dump())
    db.add(quote)
    db.commit()
    db.refresh(quote)
    return quote


@router.get("/{quote_id}", response_model=schemas.QuoteOut)
def get_quote(
    quote_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")
    return quote


@router.put("/{quote_id}", response_model=schemas.QuoteOut)
def update_quote(
    quote_id: int,
    data: schemas.QuoteUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")
    if data.quote_number and data.quote_number != quote.quote_number:
        _check_quote_number_unique(db, data.quote_number, exclude_id=quote_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(quote, field, value)
    db.commit()
    db.refresh(quote)
    return quote


@router.delete("/{quote_id}")
def delete_quote(
    quote_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    quote = db.query(models.Quote).filter(
        models.Quote.id == quote_id,
        models.Quote.deleted_at.is_(None),
    ).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")
    quote.deleted_at = datetime.now(timezone.utc)
    log_action(db, current_user, "delete", "cotizacion", quote.id, quote.title or f"#{quote.id}")
    db.commit()
    return {"ok": True}


@router.post("/{quote_id}/send-email")
def send_quote_email(
    quote_id: int,
    body: SendEmailBody,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")

    api_key = _get_setting(db, "brevo_api_key") or None
    host = _get_setting(db, "smtp_host")
    if not host and not api_key:
        raise HTTPException(status_code=400, detail="Configure el servidor SMTP o la API key de Brevo en Ajustes")
    port = _get_setting(db, "smtp_port") or "587"
    user = _get_setting(db, "smtp_user")
    password = _get_setting(db, "smtp_password")
    from_addr = _get_setting(db, "smtp_from") or user
    use_tls = (_get_setting(db, "smtp_tls") or "true").lower() == "true"

    num = quote.quote_number or f"#{quote.id}"
    co_name = (_get_setting(db, "company_name") or "DG Solutions")
    subject = f"Cotización {num} — {co_name}"
    html = _build_quote_email_html(quote, body.message, db)

    try:
        _send_with_logo(host, port, user, password, from_addr, use_tls, body.to, subject, html, api_key=api_key)
    except Exception as e:
        logging.warning("Quote email failed for quote %s: %s", quote_id, e)
        raise HTTPException(status_code=400, detail=str(e))

    return {"ok": True}


@router.post("/{quote_id}/convert-to-order", response_model=schemas.OrderOut)
def convert_to_order(
    quote_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    """Convert a quote into a purchase order and mark it as En Pedido."""
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")
    if quote.status in ("En Pedido", "Cancelada"):
        raise HTTPException(status_code=400, detail="Esta cotización ya fue convertida o cancelada")

    rows = db.query(models.Order.order_number).filter(models.Order.order_number.like("PED-%")).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    order_number = f"PED-{(max(nums) + 1) if nums else 1:04d}"

    client_notes = quote.client_name or ""
    if quote.client_ruc:
        client_notes += f" · RUC: {quote.client_ruc}"
    if quote.client_address:
        client_notes += f" · {quote.client_address}"

    # Zero out sale prices — order tracks purchase cost, not sale price
    zeroed_items = quote.items
    if quote.items:
        try:
            parsed = json.loads(quote.items)
            zeroed_items = json.dumps([
                {**it, "unit_price": 0, "subtotal": 0} for it in parsed
            ])
        except Exception:
            pass

    order = models.Order(
        title=quote.title,
        order_number=order_number,
        status="Pendiente",
        ticket_id=quote.ticket_id,
        purchase_items=zeroed_items,
        purchase_total="0.00",
        itbms_enabled=quote.itbms_enabled,
        client_invoice_notes=client_notes or None,
        payment_terms=quote.payment_terms,
        notes=quote.notes,
    )
    db.add(order)
    db.flush()

    quote.status = "En Pedido"
    quote.order_id = order.id
    db.commit()
    db.refresh(order)
    return order


@router.post("/{quote_id}/convert-to-invoice", response_model=schemas.InvoiceOut)
def convert_to_invoice(
    quote_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    """Convert a quote directly into an invoice (skipping the order step)."""
    from datetime import date as date_type
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")
    if quote.status in ("Cancelada", "Rechazada", "Facturada"):
        raise HTTPException(status_code=400, detail="Esta cotización ya fue facturada, cancelada o rechazada")

    from routers.invoices import _next_invoice_num, _ensure_quote_link
    invoice_number = _next_invoice_num(db)

    # Recalculate totals directly from the quote's items (client sale prices).
    # This is the authoritative source — never use the linked order's purchase_items.
    inv_items = quote.items
    inv_subtotal = quote.subtotal
    inv_itbms_amount = quote.itbms_amount
    inv_total = quote.total
    if inv_items:
        try:
            parsed = json.loads(inv_items)
            sub = sum(
                round((float(it.get("qty") or 0)) * (float(it.get("unit_price") or 0)) * 100) / 100
                for it in parsed
            )
            if quote.itbms_enabled:
                taxable = sum(
                    round((float(it.get("qty") or 0)) * (float(it.get("unit_price") or 0)) * 100) / 100
                    for it in parsed if it.get("itbms") is not False
                )
                itbms_amt = round(taxable * 0.07 * 100) / 100
            else:
                itbms_amt = 0.0
            total = sub + itbms_amt
            inv_subtotal = f"{sub:.2f}"
            inv_itbms_amount = f"{itbms_amt:.2f}"
            inv_total = f"{total:.2f}"
        except Exception:
            pass

    invoice = models.Invoice(
        invoice_number=invoice_number,
        status="Borrador",
        quote_id=quote.id,
        ticket_id=quote.ticket_id,
        client_name=quote.client_name,
        client_ruc=quote.client_ruc,
        client_address=quote.client_address,
        client_email=quote.client_email,
        client_phone=quote.client_phone,
        date=date_type.today(),
        items=inv_items,
        itbms_enabled=quote.itbms_enabled,
        subtotal=inv_subtotal,
        itbms_amount=inv_itbms_amount,
        total=inv_total,
        payment_terms=quote.payment_terms,
        notes=quote.notes,
        inventory_applied=False,
    )
    db.add(invoice)
    db.flush()

    _ensure_quote_link(invoice.id, quote.id, db)
    quote.status = "Facturada"
    db.commit()
    db.refresh(invoice)
    return invoice


@router.post("/{quote_id}/create-ticket", response_model=schemas.TicketOut)
def create_ticket_from_quote(
    quote_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    """Create a new ticket linked to this quote (quote.ticket_id), so the work
    described in the quote can be tracked/scheduled like any other ticket."""
    from routers.tickets import create_ticket as _create_ticket

    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")
    if quote.ticket_id:
        raise HTTPException(status_code=400, detail="Esta cotización ya tiene un ticket vinculado")
    if not quote.client_id:
        raise HTTPException(status_code=400, detail="Vincula primero un cliente del portal a esta cotización para poder crear el ticket")

    default_status = (
        db.query(models.TicketStatus).filter(models.TicketStatus.is_default == True).first()
        or db.query(models.TicketStatus).filter(models.TicketStatus.is_active == True).order_by(models.TicketStatus.order).first()
    )
    if not default_status:
        raise HTTPException(status_code=400, detail="No hay un estado de ticket configurado")

    description = f"Ticket generado desde la cotización {quote.quote_number or f'#{quote.id}'}."
    if quote.notes:
        description += f"\n\n{quote.notes}"

    data = schemas.TicketCreate(
        title=f"{quote.quote_number or f'COT-{quote.id}'} — {quote.title}",
        description=description,
        priority="medium",
        status_id=default_status.id,
        client_id=quote.client_id,
    )
    ticket = _create_ticket(data=data, background_tasks=background_tasks, db=db, current_user=current_user)

    quote.ticket_id = ticket.id
    db.commit()
    db.refresh(ticket)
    return ticket


@router.post("/{quote_id}/clone", response_model=schemas.QuoteOut)
def clone_quote(
    quote_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    """Clonar una cotización: copia datos pero genera número nuevo, fecha de hoy, estado Borrador."""
    from datetime import date as date_type
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")

    rows = db.query(models.Quote.quote_number).filter(models.Quote.quote_number.like("COT-%")).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    new_number = f"COT-{(max(nums) + 1) if nums else 1:04d}"

    clone = models.Quote(
        title=f"Copia de {quote.title}",
        quote_number=new_number,
        status="Borrador",
        client_name=quote.client_name,
        client_ruc=quote.client_ruc,
        client_address=quote.client_address,
        client_email=quote.client_email,
        client_phone=quote.client_phone,
        date=date_type.today(),
        valid_until=None,
        items=quote.items,
        itbms_enabled=quote.itbms_enabled,
        subtotal=quote.subtotal,
        itbms_amount=quote.itbms_amount,
        total=quote.total,
        payment_terms=quote.payment_terms,
        notes=quote.notes,
        ticket_id=quote.ticket_id,
    )
    db.add(clone)
    db.commit()
    db.refresh(clone)
    return clone


@router.get("/{quote_id}/invoices")
def get_quote_invoices(
    quote_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    quote = db.query(models.Quote).filter(
        models.Quote.id == quote_id,
        models.Quote.deleted_at.is_(None),
    ).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")
    links = db.query(models.InvoiceQuoteLink).filter_by(quote_id=quote_id).all()
    invoice_ids = [lnk.invoice_id for lnk in links]
    if not invoice_ids:
        return []
    invoices = db.query(models.Invoice).filter(
        models.Invoice.id.in_(invoice_ids),
        models.Invoice.deleted_at.is_(None),
    ).order_by(models.Invoice.created_at.desc()).all()
    return [
        {
            "id": inv.id,
            "invoice_number": inv.invoice_number,
            "status": inv.status,
            "total": inv.total,
            "date": str(inv.date) if inv.date else None,
            "client_name": inv.client_name,
        }
        for inv in invoices
    ]

