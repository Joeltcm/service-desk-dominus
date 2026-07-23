from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Optional, List
from datetime import date as date_type, datetime, timedelta
import json
import models
import schemas
from database import get_db
from auth import require_staff, require_agent_or_admin


def _try_google_service(current_user, db):
    """Return Google Calendar service if user has a valid token, else None."""
    if not current_user.google_token:
        return None
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
        token_data = json.loads(current_user.google_token)
        expiry = None
        if token_data.get("expiry"):
            try:
                expiry = datetime.fromisoformat(token_data["expiry"])
            except Exception:
                pass
        creds = Credentials(
            token=token_data.get("token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri=token_data.get("token_uri"),
            client_id=token_data.get("client_id"),
            client_secret=token_data.get("client_secret"),
            scopes=token_data.get("scopes"),
            expiry=expiry,
        )
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            token_data["token"] = creds.token
            token_data["expiry"] = creds.expiry.isoformat() if creds.expiry else None
            current_user.google_token = json.dumps(token_data)
            db.commit()
        return build("calendar", "v3", credentials=creds, cache_discovery=False)
    except Exception:
        return None

router = APIRouter(prefix="/api/oportunidades", tags=["opportunities"])

STATUSES = ["Nueva", "Contactada", "Calificada", "Propuesta", "Negociación", "Ganada", "Perdida", "Cancelada"]
CLOSED_WON = "Ganada"
CLOSED_LOST = {"Perdida", "Cancelada"}


@router.get("", response_model=List[schemas.OpportunityOut])
def list_opportunities(
    search: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    assigned_to_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    q = db.query(models.Opportunity)
    if search:
        term = f"%{search}%"
        q = q.filter(
            models.Opportunity.title.ilike(term)
            | models.Opportunity.client_name.ilike(term)
            | models.Opportunity.client_ruc.ilike(term)
        )
    if status:
        q = q.filter(models.Opportunity.status == status)
    if priority:
        q = q.filter(models.Opportunity.priority == priority)
    if assigned_to_id:
        q = q.filter(models.Opportunity.assigned_to_id == assigned_to_id)
    return q.order_by(desc(models.Opportunity.created_at)).all()


@router.post("", response_model=schemas.OpportunityOut)
def create_opportunity(
    data: schemas.OpportunityCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    opp = models.Opportunity(**data.model_dump(), created_by_id=current_user.id)
    db.add(opp)
    db.commit()
    db.refresh(opp)
    return opp


@router.get("/reports")
def get_reports(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    opps = db.query(models.Opportunity).all()
    by_user: dict = {}
    status_totals: dict = {}

    for opp in opps:
        # per-status totals
        status_totals[opp.status] = status_totals.get(opp.status, 0) + 1

        uid = opp.assigned_to_id or 0
        name = (opp.assignee.name if opp.assignee else None) or "Sin asignar"
        if uid not in by_user:
            by_user[uid] = {
                "id": uid,
                "name": name,
                "total": 0,
                "ganada": 0,
                "perdida": 0,
                "cancelada": 0,
                "pipeline_value": 0.0,
                "won_value": 0.0,
            }
        r = by_user[uid]
        r["total"] += 1
        st = opp.status
        if st == "Ganada":
            r["ganada"] += 1
        elif st == "Perdida":
            r["perdida"] += 1
        elif st == "Cancelada":
            r["cancelada"] += 1

        try:
            val = float(str(opp.estimated_value or "0").replace("$", "").replace(",", ""))
        except Exception:
            val = 0.0

        if st not in CLOSED_LOST:
            r["pipeline_value"] += val
        if st == "Ganada":
            r["won_value"] += val

    result = sorted(by_user.values(), key=lambda x: x["won_value"], reverse=True)
    for r in result:
        closed = r["ganada"] + r["perdida"]
        r["win_rate"] = round(r["ganada"] / closed * 100) if closed else 0
        r["pipeline_value"] = round(r["pipeline_value"], 2)
        r["won_value"] = round(r["won_value"], 2)

    return {"by_user": result, "by_status": status_totals}


@router.get("/{opp_id}", response_model=schemas.OpportunityOut)
def get_opportunity(
    opp_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    opp = db.query(models.Opportunity).filter(models.Opportunity.id == opp_id).first()
    if not opp:
        raise HTTPException(status_code=404, detail="Oportunidad no encontrada")
    return opp


@router.put("/{opp_id}", response_model=schemas.OpportunityOut)
def update_opportunity(
    opp_id: int,
    data: schemas.OpportunityUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    opp = db.query(models.Opportunity).filter(models.Opportunity.id == opp_id).first()
    if not opp:
        raise HTTPException(status_code=404, detail="Oportunidad no encontrada")
    updates = data.model_dump(exclude_unset=True)
    new_status = updates.get("status")
    _OPP_ESTADOS = {"Nueva","Contactada","Calificada","Propuesta","Negociación","Ganada","Perdida","Cancelada"}
    if new_status and new_status not in _OPP_ESTADOS:
        raise HTTPException(status_code=400,
            detail=f"Estado no válido. Usa uno de: {', '.join(sorted(_OPP_ESTADOS))}")
    for field, val in updates.items():
        setattr(opp, field, val)
    # Sync linked quote status when opportunity closes
    if new_status and opp.quote_id:
        quote = db.query(models.Quote).filter(models.Quote.id == opp.quote_id).first()
        if quote:
            if new_status == "Ganada":
                quote.status = "Aprobada"
            elif new_status in ("Perdida", "Cancelada"):
                quote.status = "Rechazada"
    db.commit()
    db.refresh(opp)
    return opp


@router.delete("/{opp_id}")
def delete_opportunity(
    opp_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    opp = db.query(models.Opportunity).filter(models.Opportunity.id == opp_id).first()
    if not opp:
        raise HTTPException(status_code=404, detail="Oportunidad no encontrada")
    db.delete(opp)
    db.commit()
    return {"ok": True}


@router.post("/{opp_id}/link-quote")
def link_quote(
    opp_id: int,
    quote_id: int = Body(..., embed=True),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    opp = db.query(models.Opportunity).filter(models.Opportunity.id == opp_id).first()
    if not opp:
        raise HTTPException(status_code=404, detail="Oportunidad no encontrada")
    if not quote_id:
        raise HTTPException(status_code=422, detail="quote_id requerido")
    quote = db.query(models.Quote).filter(models.Quote.id == quote_id, models.Quote.deleted_at == None).first()
    if not quote:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")
    opp.quote_id = quote.id
    db.commit()
    db.refresh(opp)
    return {"ok": True, "quote_id": quote.id, "quote_number": quote.quote_number}


@router.delete("/{opp_id}/link-quote")
def unlink_quote(
    opp_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    opp = db.query(models.Opportunity).filter(models.Opportunity.id == opp_id).first()
    if not opp:
        raise HTTPException(status_code=404, detail="Oportunidad no encontrada")
    opp.quote_id = None
    db.commit()
    return {"ok": True}


@router.post("/{opp_id}/convert-to-quote", response_model=schemas.QuoteOut)
def convert_to_quote(
    opp_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    opp = db.query(models.Opportunity).filter(models.Opportunity.id == opp_id).first()
    if not opp:
        raise HTTPException(status_code=404, detail="Oportunidad no encontrada")
    if opp.quote_id:
        raise HTTPException(status_code=400, detail="Esta oportunidad ya tiene una cotización vinculada")

    rows = db.query(models.Quote.quote_number).filter(models.Quote.quote_number.like("COT-%")).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    quote_number = f"COT-{(max(nums) + 1) if nums else 1:04d}"

    quote = models.Quote(
        title=opp.title,
        quote_number=quote_number,
        status="Borrador",
        client_name=opp.client_name,
        client_ruc=opp.client_ruc,
        client_email=opp.client_email,
        client_phone=opp.client_phone,
        client_address=opp.client_address,
        date=date_type.today(),
        notes=opp.notes,
    )
    db.add(quote)
    db.flush()

    opp.quote_id = quote.id
    opp.status = "Propuesta"
    db.commit()
    db.refresh(quote)
    return quote


# ── Visits ──────────────────────────────────────────────

@router.post("/{opp_id}/visits", response_model=schemas.OppVisitOut)
def create_opp_visit(
    opp_id: int,
    data: schemas.OppVisitCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    opp = db.query(models.Opportunity).filter(models.Opportunity.id == opp_id).first()
    if not opp:
        raise HTTPException(status_code=404, detail="Oportunidad no encontrada")

    visit_count = db.query(models.OppVisit).filter(models.OppVisit.opportunity_id == opp_id).count()
    if visit_count >= 10:
        raise HTTPException(status_code=400, detail="Límite de 10 visitas por oportunidad")

    calendar_event_id = None
    calendar_event_link = None

    service = _try_google_service(current_user, db)
    if service:
        try:
            start_dt = data.scheduled_at
            end_dt = start_dt + timedelta(minutes=data.duration_minutes)
            subject = f"Visita - {opp.title}"
            if opp.client_name:
                subject += f" ({opp.client_name})"
            event_body = {
                "summary": subject,
                "location": data.location or "",
                "description": (
                    f"Oportunidad: {opp.title}\n"
                    f"Cliente: {opp.client_name or ''}\n"
                    f"Valor estimado: {opp.estimated_value or ''}\n\n"
                    f"Notas: {data.notes or ''}"
                ),
                "start": {"dateTime": start_dt.isoformat(), "timeZone": "America/Panama"},
                "end":   {"dateTime": end_dt.isoformat(),   "timeZone": "America/Panama"},
                "reminders": {"useDefault": True},
            }
            event = service.events().insert(calendarId="primary", body=event_body).execute()
            calendar_event_id = event.get("id")
            calendar_event_link = event.get("htmlLink")
        except Exception:
            pass  # Calendar is optional — save visit locally regardless

    visit = models.OppVisit(
        opportunity_id=opp_id,
        scheduled_at=data.scheduled_at,
        duration_minutes=data.duration_minutes,
        calendar_event_id=calendar_event_id,
        calendar_event_link=calendar_event_link,
        notes=data.notes,
    )
    db.add(visit)
    db.commit()
    db.refresh(visit)
    return visit


@router.put("/{opp_id}/visits/{visit_id}", response_model=schemas.OppVisitOut)
def reschedule_opp_visit(
    opp_id: int,
    visit_id: int,
    data: schemas.OppVisitUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    visit = db.query(models.OppVisit).filter(
        models.OppVisit.id == visit_id,
        models.OppVisit.opportunity_id == opp_id,
    ).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    visit.scheduled_at = data.scheduled_at
    visit.duration_minutes = data.duration_minutes
    visit.notes = data.notes

    service = _try_google_service(current_user, db)
    if service and visit.calendar_event_id:
        try:
            end_dt = data.scheduled_at + timedelta(minutes=data.duration_minutes)
            service.events().patch(
                calendarId="primary",
                eventId=visit.calendar_event_id,
                body={
                    "start": {"dateTime": data.scheduled_at.isoformat(), "timeZone": "America/Panama"},
                    "end":   {"dateTime": end_dt.isoformat(),            "timeZone": "America/Panama"},
                    "description": data.notes or "",
                },
            ).execute()
        except Exception:
            pass

    db.commit()
    db.refresh(visit)
    return visit


@router.post("/{opp_id}/visits/{visit_id}/cancel", response_model=schemas.OppVisitOut)
def cancel_opp_visit(
    opp_id: int,
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    visit = db.query(models.OppVisit).filter(
        models.OppVisit.id == visit_id,
        models.OppVisit.opportunity_id == opp_id,
    ).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    if visit.status == "cancelled":
        raise HTTPException(status_code=400, detail="La visita ya está cancelada")

    visit.status = "cancelled"

    service = _try_google_service(current_user, db)
    if service and visit.calendar_event_id:
        try:
            service.events().delete(calendarId="primary", eventId=visit.calendar_event_id).execute()
        except Exception:
            pass

    db.commit()
    db.refresh(visit)
    return visit


@router.delete("/{opp_id}/visits/{visit_id}")
def delete_opp_visit(
    opp_id: int,
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    visit = db.query(models.OppVisit).filter(
        models.OppVisit.id == visit_id,
        models.OppVisit.opportunity_id == opp_id,
    ).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    service = _try_google_service(current_user, db)
    if service and visit.calendar_event_id:
        try:
            service.events().delete(calendarId="primary", eventId=visit.calendar_event_id).execute()
        except Exception:
            pass

    db.delete(visit)
    db.commit()
    return {"ok": True}
