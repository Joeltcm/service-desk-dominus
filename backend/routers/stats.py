from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from collections import defaultdict
from datetime import datetime
from database import get_db
from auth import require_staff
import models

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/orders")
def orders_stats(
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.Order).filter(models.Order.deleted_at.is_(None))
    if date_from:
        q = q.filter(models.Order.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        dt = datetime.fromisoformat(date_to)
        q = q.filter(models.Order.created_at <= dt.replace(hour=23, minute=59, second=59))
    orders = q.all()

    def _client(o):
        if o.quote and o.quote.client_name:     return o.quote.client_name
        if o.invoice and o.invoice.client_name: return o.invoice.client_name
        if o.ticket and o.ticket.client:        return o.ticket.client.name
        return "Sin cliente"

    def _cost(val):
        try:    return float(str(val).replace(",", "").replace("$", "").strip()) if val else 0.0
        except: return 0.0

    total_cost = 0.0
    by_status = defaultdict(lambda: {"count": 0, "total": 0.0})
    by_client = defaultdict(lambda: {"count": 0, "total": 0.0})
    by_month  = defaultdict(lambda: {"count": 0, "total": 0.0})

    for o in orders:
        c = _cost(o.purchase_total)
        total_cost += c
        by_status[o.status]["count"] += 1
        by_status[o.status]["total"] += c
        name = _client(o)
        by_client[name]["count"] += 1
        by_client[name]["total"] += c
        mk = o.created_at.strftime("%Y-%m") if o.created_at else "?"
        by_month[mk]["count"] += 1
        by_month[mk]["total"] += c

    top = sorted(by_client.items(), key=lambda x: x[1]["total"], reverse=True)[:10]
    return {
        "total_orders": len(orders),
        "total_cost":   round(total_cost, 2),
        "by_status":    dict(by_status),
        "by_client":    [{"name": k, **v} for k, v in top],
        "by_month":     {k: dict(v) for k, v in sorted(by_month.items())},
    }


@router.get("/despacho")
def despacho_stats(
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.Dispatch).filter(models.Dispatch.deleted_at.is_(None))
    if date_from:
        q = q.filter(models.Dispatch.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        dt = datetime.fromisoformat(date_to)
        q = q.filter(models.Dispatch.created_at <= dt.replace(hour=23, minute=59, second=59))
    dispatches = q.all()

    def _money(val):
        try:    return float(str(val).replace(",", "").replace("$", "").strip()) if val else 0.0
        except: return 0.0

    total_revenue = 0.0
    by_status = defaultdict(lambda: {"count": 0, "total": 0.0})
    by_client = defaultdict(lambda: {"count": 0, "total": 0.0})
    by_month  = defaultdict(lambda: {"count": 0, "total": 0.0})

    for d in dispatches:
        rev = _money(d.total)
        total_revenue += rev
        by_status[d.status]["count"] += 1
        by_status[d.status]["total"] += rev
        client = d.client_name or "Sin cliente"
        by_client[client]["count"] += 1
        by_client[client]["total"] += rev
        mk = d.created_at.strftime("%Y-%m") if d.created_at else "?"
        by_month[mk]["count"] += 1
        by_month[mk]["total"] += rev

    top = sorted(by_client.items(), key=lambda x: x[1]["total"], reverse=True)[:10]
    return {
        "total_orders":  len(dispatches),
        "total_cost":    round(total_revenue, 2),
        "by_status":     dict(by_status),
        "by_client":     [{"name": k, **v} for k, v in top],
        "by_month":      {k: dict(v) for k, v in sorted(by_month.items())},
    }
