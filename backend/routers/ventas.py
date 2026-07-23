from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date
from database import get_db
from auth import require_staff
import models

router = APIRouter(prefix="/api/ventas", tags=["ventas"])


def _parse_money(s) -> float:
    if not s:
        return 0.0
    try:
        return float(str(s).replace("$", "").replace(",", "").strip())
    except Exception:
        return 0.0


def _status_counts(db, model):
    rows = db.query(model.status, func.count(model.id)).group_by(model.status).all()
    return {s: c for s, c in rows}


@router.get("/dashboard")
def ventas_dashboard(
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    today = date.today()
    first_this_month = today.replace(day=1)

    # Previous month
    y, m = today.year, today.month - 1
    if m == 0:
        m, y = 12, y - 1
    first_last_month = date(y, m, 1)

    # ── Totals ──────────────────────────────────────────────
    total_cot = db.query(func.count(models.Quote.id)).scalar() or 0
    total_ped = db.query(func.count(models.Order.id)).scalar() or 0
    total_dsp = db.query(func.count(models.Dispatch.id)).scalar() or 0
    total_fac = db.query(func.count(models.Invoice.id)).scalar() or 0

    active_cot = db.query(func.count(models.Quote.id)).filter(
        models.Quote.status.in_(["Borrador", "Enviada", "Aprobada"])
    ).scalar() or 0

    pending_ped = db.query(func.count(models.Order.id)).filter(
        models.Order.status.in_(["Pendiente", "En proceso", "En despacho"])
    ).scalar() or 0

    pending_dsp = db.query(func.count(models.Dispatch.id)).filter(
        models.Dispatch.status.in_(["Borrador", "Emitido"])
    ).scalar() or 0

    pending_fac = db.query(func.count(models.Invoice.id)).filter(
        models.Invoice.status.in_(["Borrador", "Emitida"])
    ).scalar() or 0

    # ── Revenue ─────────────────────────────────────────────
    all_invoices = db.query(models.Invoice).filter(models.Invoice.deleted_at.is_(None)).all()
    total_revenue = sum(_parse_money(inv.total) for inv in all_invoices)

    def _ym(d):
        return f"{d.year}-{d.month:02d}"

    rev_this_month = sum(
        _parse_money(inv.total) for inv in all_invoices
        if inv.date and str(inv.date)[:7] == _ym(first_this_month)
    )
    rev_last_month = sum(
        _parse_money(inv.total) for inv in all_invoices
        if inv.date and str(inv.date)[:7] == _ym(first_last_month)
    )

    # ── Payments received ───────────────────────────────────
    all_payments = db.query(models.InvoicePayment).all()
    total_pagado      = sum(_parse_money(p.amount) for p in all_payments)
    pagado_this_month = sum(_parse_money(p.amount) for p in all_payments if p.date and str(p.date)[:7] == f"{today.year}-{today.month:02d}")
    pagado_last_month = sum(_parse_money(p.amount) for p in all_payments if p.date and str(p.date)[:7] == f"{first_last_month.year}-{first_last_month.month:02d}")

    # ── Monthly revenue — last 6 months ─────────────────────
    month_keys = []
    yy, mm = today.year, today.month
    for i in range(5, -1, -1):
        mo = mm - i
        yr = yy
        while mo <= 0:
            mo += 12
            yr -= 1
        month_keys.append(f"{yr}-{mo:02d}")

    monthly: dict = {k: 0.0 for k in month_keys}
    for inv in all_invoices:
        if inv.date:
            k = str(inv.date)[:7]
            if k in monthly:
                monthly[k] += _parse_money(inv.total)

    monthly_pagado: dict = {k: 0.0 for k in month_keys}
    for p in all_payments:
        if p.date:
            k = str(p.date)[:7]
            if k in monthly_pagado:
                monthly_pagado[k] += _parse_money(p.amount)

    # Monthly quoted (by quote date)
    all_quotes_list = db.query(models.Quote).filter(models.Quote.deleted_at.is_(None)).all()
    monthly_quoted: dict = {k: 0.0 for k in month_keys}
    for q in all_quotes_list:
        if q.date:
            k = str(q.date)[:7]
            if k in monthly_quoted:
                monthly_quoted[k] += _parse_money(q.total)

    # Monthly expenses
    all_expenses = db.query(models.Expense).filter(models.Expense.deleted_at.is_(None)).all()
    monthly_gastos: dict = {k: 0.0 for k in month_keys}
    for e in all_expenses:
        if e.date:
            k = str(e.date)[:7]
            if k in monthly_gastos:
                monthly_gastos[k] += _parse_money(e.amount)

    monthly_revenue = [
        {
            "month": k,
            "revenue": round(monthly[k], 2),
            "quoted": round(monthly_quoted[k], 2),
            "gastos": round(monthly_gastos[k], 2),
            "pagado": round(monthly_pagado[k], 2),
        }
        for k in month_keys
    ]

    # ── Status breakdown ────────────────────────────────────
    quotes_by_status     = _status_counts(db, models.Quote)
    orders_by_status     = _status_counts(db, models.Order)
    dispatches_by_status = _status_counts(db, models.Dispatch)
    invoices_by_status   = _status_counts(db, models.Invoice)

    # ── Funnel ──────────────────────────────────────────────
    quotes_converted = db.query(func.count(models.Quote.id)).filter(
        models.Quote.order_id.isnot(None)
    ).scalar() or 0

    orders_dispatched = db.query(func.count(models.Order.id)).filter(
        models.Order.status.in_(["En despacho", "Entregado al cliente"])
    ).scalar() or 0

    invoices_paid = db.query(func.count(models.Invoice.id)).filter(
        models.Invoice.status == "Pagada"
    ).scalar() or 0

    # ── Top clients ─────────────────────────────────────────
    client_totals: dict = {}
    for inv in all_invoices:
        name = (inv.client_name or "").strip() or "Sin nombre"
        client_totals[name] = client_totals.get(name, 0.0) + _parse_money(inv.total)

    top_clients = sorted(
        [{"client": k, "total": round(v, 2)} for k, v in client_totals.items() if v > 0],
        key=lambda x: x["total"],
        reverse=True,
    )[:6]

    # ── Recent records ──────────────────────────────────────
    recent_fac = db.query(models.Invoice).filter(models.Invoice.deleted_at.is_(None)).order_by(models.Invoice.created_at.desc()).limit(6).all()
    recent_cot = db.query(models.Quote).filter(models.Quote.deleted_at.is_(None)).order_by(models.Quote.created_at.desc()).limit(5).all()

    return {
        "total_cotizaciones":   total_cot,
        "total_pedidos":        total_ped,
        "total_despachos":      total_dsp,
        "total_facturas":       total_fac,
        "active_cotizaciones":  active_cot,
        "pending_pedidos":      pending_ped,
        "pending_despachos":    pending_dsp,
        "pending_facturas":     pending_fac,
        "total_revenue":        round(total_revenue, 2),
        "revenue_this_month":   round(rev_this_month, 2),
        "revenue_last_month":   round(rev_last_month, 2),
        "total_pagado":         round(total_pagado, 2),
        "pagado_this_month":    round(pagado_this_month, 2),
        "pagado_last_month":    round(pagado_last_month, 2),
        "monthly_revenue":      monthly_revenue,
        "quotes_by_status":     quotes_by_status,
        "orders_by_status":     orders_by_status,
        "dispatches_by_status": dispatches_by_status,
        "invoices_by_status":   invoices_by_status,
        "quotes_converted":     quotes_converted,
        "orders_dispatched":    orders_dispatched,
        "invoices_paid":        invoices_paid,
        "top_clients":          top_clients,
        "recent_facturas": [
            {
                "id": inv.id,
                "invoice_number": inv.invoice_number,
                "client_name": inv.client_name,
                "total": inv.total,
                "status": inv.status,
                "date": str(inv.date) if inv.date else None,
            }
            for inv in recent_fac
        ],
        "recent_quotes": [
            {
                "id": q.id,
                "quote_number": q.quote_number,
                "title": q.title,
                "client_name": q.client_name,
                "total": q.total,
                "status": q.status,
            }
            for q in recent_cot
        ],
    }
