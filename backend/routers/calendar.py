from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db
import models, schemas
from auth import get_current_user, require_agent_or_admin
import os, json
from datetime import datetime, timedelta, timezone

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8080/api/calendar/callback")
SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]


def _get_flow():
    try:
        from google_auth_oauthlib.flow import Flow
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "redirect_uris": [GOOGLE_REDIRECT_URI],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            },
            scopes=SCOPES,
            redirect_uri=GOOGLE_REDIRECT_URI,
        )
        return flow
    except Exception:
        return None


def _build_event_title(ticket_id: int, location: str, subject: str, client_name: str = "", client_company: str = "") -> str:
    """Formato: Ticket #ID - Contacto (Empresa) - Ubicación - Asunto"""
    parts = [f"Ticket #{ticket_id}"]
    contact = client_name.strip() if client_name else ""
    if client_company and client_company.strip():
        contact = f"{contact} ({client_company.strip()})" if contact else client_company.strip()
    if contact:
        parts.append(contact)
    if location and location.strip():
        parts.append(location.strip())
    if subject and subject.strip():
        parts.append(subject.strip())
    return " - ".join(parts)


@router.get("/status")
def get_calendar_status(current_user: models.User = Depends(get_current_user)):
    """Retorna el estado de conexión de Google Calendar del usuario actual."""
    if not current_user.google_token:
        return {"connected": False, "google_email": None}
    try:
        token_data = json.loads(current_user.google_token)
        email = token_data.get("google_email")
        return {"connected": True, "google_email": email}
    except Exception:
        return {"connected": False, "google_email": None}


@router.delete("/disconnect")
def disconnect_calendar(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Desvincula la cuenta de Google Calendar del usuario actual."""
    current_user.google_token = None
    db.commit()
    return {"ok": True, "message": "Cuenta de Google Calendar desvinculada"}


@router.get("/auth-url")
def get_auth_url(current_user: models.User = Depends(get_current_user)):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=400,
            detail="Google Calendar no está configurado. Agrega GOOGLE_CLIENT_ID en .env",
        )
    flow = _get_flow()
    if not flow:
        raise HTTPException(status_code=500, detail="Error al inicializar OAuth flow")
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=str(current_user.id),
    )
    return {"auth_url": auth_url, "redirect_uri": GOOGLE_REDIRECT_URI}


@router.get("/callback")
def oauth_callback(code: str, state: str, db: Session = Depends(get_db)):
    frontend = os.getenv('FRONTEND_URL', 'http://localhost:5173')
    flow = _get_flow()
    if not flow:
        return RedirectResponse(f"{frontend}/perfil?calendar_error=no_flow")
    try:
        flow.fetch_token(code=code)
    except Exception as e:
        err = str(e)[:120].replace(" ", "_")
        return RedirectResponse(f"{frontend}/perfil?calendar_error={err}")

    credentials = flow.credentials

    # Obtener el email de la cuenta de Google conectada
    google_email = None
    try:
        from googleapiclient.discovery import build
        svc = build("oauth2", "v2", credentials=credentials)
        info = svc.userinfo().get().execute()
        google_email = info.get("email")
    except Exception:
        pass

    token_data = {
        "token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_uri": credentials.token_uri,
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "scopes": list(credentials.scopes) if credentials.scopes else [],
        "expiry": credentials.expiry.isoformat() if credentials.expiry else None,
        "google_email": google_email,
    }
    try:
        user_id = int(state)
    except (ValueError, TypeError):
        return RedirectResponse(f"{frontend}/perfil?calendar_error=invalid_state")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        return RedirectResponse(f"{frontend}/perfil?calendar_error=user_not_found")

    user.google_token = json.dumps(token_data)
    db.commit()
    return RedirectResponse(f"{frontend}/?calendar_connected=1")


@router.post("/create-event")
def create_calendar_event(
    data: schemas.CalendarEventCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    if not current_user.google_token:
        raise HTTPException(
            status_code=400,
            detail="Debes conectar tu cuenta de Google Calendar primero",
        )

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

        # Si el token está vencido, refrescarlo y guardarlo
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            token_data["token"] = creds.token
            token_data["expiry"] = creds.expiry.isoformat() if creds.expiry else None
            current_user.google_token = json.dumps(token_data)
            db.commit()

        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Error de autenticación Google: {str(e)}")

    ticket = db.query(models.Ticket).filter(models.Ticket.id == data.ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")

    is_reschedule = bool(ticket.scheduled_at)

    # Usar location/subject del evento; si no se pasan, tomar los del ticket
    location = data.location or ticket.location or ""
    subject = data.subject or ticket.subject or ticket.title

    # Guardar en el ticket si se proporcionaron
    if data.location:
        ticket.location = data.location
    if data.subject:
        ticket.subject = data.subject

    start_dt = data.scheduled_at
    end_dt = start_dt + timedelta(minutes=data.duration_minutes)

    client_name    = ticket.client.name    if ticket.client else ""
    client_company = ticket.client.company if ticket.client else ""
    event_title = _build_event_title(ticket.id, location, subject, client_name, client_company)

    event_body = {
        "summary": event_title,
        "location": location,
        "description": (
            f"Ticket: {ticket.title}\n"
            f"Cliente: {ticket.client.name if ticket.client else ''}\n"
            f"Prioridad: {ticket.priority}\n\n"
            f"{ticket.description or ''}\n\n"
            f"Notas: {data.notes or ''}"
        ),
        "start": {"dateTime": start_dt.isoformat(), "timeZone": "America/Panama"},
        "end": {"dateTime": end_dt.isoformat(), "timeZone": "America/Panama"},
        "attendees": [{"email": e} for e in (data.attendee_emails or [])],
        "reminders": {"useDefault": True},
    }

    # Si ya existe un evento previo, eliminarlo antes de crear uno nuevo
    if ticket.calendar_event_id:
        try:
            service.events().delete(calendarId="primary", eventId=ticket.calendar_event_id).execute()
        except Exception:
            pass  # Si ya no existe en Google, ignorar el error

    try:
        event = service.events().insert(calendarId="primary", body=event_body).execute()
    except Exception as e:
        err_str = str(e)
        if 'invalid_grant' in err_str or 'Token has been expired' in err_str or 'revoked' in err_str.lower():
            current_user.google_token = None
            db.commit()
            raise HTTPException(status_code=401, detail="Sesión de Google expirada. Reconecta tu cuenta en Configuración de perfil.")
        raise HTTPException(status_code=500, detail=f"Error creando evento: {err_str}")

    ticket.scheduled_at = start_dt
    ticket.duration_minutes = data.duration_minutes
    ticket.calendar_event_id = event.get("id")
    ticket.calendar_event_link = event.get("htmlLink")

    # Cambiar estatus a "Programado" automáticamente
    programado = db.query(models.TicketStatus).filter(models.TicketStatus.name == "Programado").first()
    old_status_name = ticket.status_rel.name if ticket.status_rel else ""
    if programado and ticket.status_id != programado.id:
        ticket.status_id = programado.id
        db.add(models.TicketTimeline(
            ticket_id=ticket.id,
            user_id=current_user.id,
            content=f"Estado cambiado de \"{old_status_name}\" a \"Programado\" (ticket agendado automáticamente)",
            entry_type="status",
        ))

    action_label = "reagendado" if is_reschedule else "agendado"
    PANAMA = timezone(timedelta(hours=-5))
    local_dt = start_dt.astimezone(PANAMA) if start_dt.tzinfo else start_dt.replace(tzinfo=timezone.utc).astimezone(PANAMA)
    entry = models.TicketTimeline(
        ticket_id=ticket.id,
        user_id=current_user.id,
        content=f"Evento {action_label}: \"{event_title}\" para {local_dt.strftime('%d/%m/%Y %I:%M %p')}",
        entry_type="calendar",
    )
    db.add(entry)
    db.commit()
    db.refresh(ticket)

    from routers.settings import try_send_reschedule_email
    background_tasks.add_task(
        try_send_reschedule_email,
        ticket.id,
        scheduled_at=start_dt,
        duration_minutes=data.duration_minutes,
        location=location,
        subject_text=subject,
        agent_name=current_user.name,
        bcc_email=data.bcc_email,
        is_reschedule=is_reschedule,
    )

    return {
        "event_id": event.get("id"),
        "event_link": event.get("htmlLink"),
        "event_title": event_title,
        "scheduled_at": start_dt.isoformat(),
    }


@router.delete("/event/{ticket_id}")
def delete_calendar_event(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket or not ticket.calendar_event_id:
        raise HTTPException(status_code=404, detail="No hay evento de calendario para este ticket")

    if current_user.google_token:
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
            service = build("calendar", "v3", credentials=creds)
            service.events().delete(calendarId="primary", eventId=ticket.calendar_event_id).execute()
        except Exception:
            pass

    ticket.calendar_event_id = None
    ticket.calendar_event_link = None
    ticket.scheduled_at = None
    db.commit()
    return {"ok": True}


# ── Agenda ────────────────────────────────────────────
@router.get("/agenda")
def get_agenda(
    year: int = Query(default=None),
    month: int = Query(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    y = year or now.year
    m = month or now.month

    # Month range as UTC-aware so TIMESTAMPTZ comparisons are unambiguous.
    # Extend by ±1 day so Panama events near month boundaries (UTC offset -5)
    # are never clipped.
    start = datetime(y, m, 1, tzinfo=timezone.utc) - timedelta(days=1)
    if m == 12:
        end = datetime(y + 1, 1, 1, tzinfo=timezone.utc) + timedelta(days=1)
    else:
        end = datetime(y, m + 1, 1, tzinfo=timezone.utc) + timedelta(days=1)

    # Tickets with visits — show each visit as a separate agenda entry
    visits_q = db.query(models.TicketVisit).filter(
        models.TicketVisit.scheduled_at >= start,
        models.TicketVisit.scheduled_at < end,
    )
    if current_user.role == models.UserRole.client:
        visits_q = visits_q.join(models.Ticket).filter(models.Ticket.client_id == current_user.id)

    linked_event_ids = set()
    events = []

    ticket_ids_with_visits = set()
    for v in visits_q.order_by(models.TicketVisit.scheduled_at).all():
        t = v.ticket
        if not t:
            continue
        ticket_ids_with_visits.add(t.id)
        if v.calendar_event_id:
            linked_event_ids.add(v.calendar_event_id)
        location = t.location or ""
        subject = t.subject or t.title
        events.append({
            "source": "ticket",
            "ticket_id": t.id,
            "visit_id": v.id,
            "visit_status": v.status,
            "is_remote": v.is_remote,
            "order_id": None,
            "dispatch_id": None,
            "google_event_id": None,
            "title": _build_event_title(t.id, location, subject, t.client.name if t.client else "", t.client.company if t.client else ""),
            "raw_title": t.title,
            "location": location,
            "subject": subject,
            "scheduled_at": v.scheduled_at.isoformat(),
            "duration_minutes": v.duration_minutes or 60,
            "priority": t.priority,
            "status": {"id": t.status_rel.id, "name": t.status_rel.name, "color": t.status_rel.color} if t.status_rel else None,
            "client": t.client.name if t.client else "",
            "assigned_agent": t.assigned_agent.name if t.assigned_agent else None,
            "calendar_event_link": v.calendar_event_link,
        })

    # Backward compat: tickets with scheduled_at but no visits table entry
    q = db.query(models.Ticket).filter(
        models.Ticket.scheduled_at >= start,
        models.Ticket.scheduled_at < end,
        ~models.Ticket.id.in_(ticket_ids_with_visits) if ticket_ids_with_visits else models.Ticket.id.isnot(None),
    )
    if current_user.role == models.UserRole.client:
        q = q.filter(models.Ticket.client_id == current_user.id)

    for t in q.order_by(models.Ticket.scheduled_at).all():
        if t.calendar_event_id:
            linked_event_ids.add(t.calendar_event_id)
        location = t.location or ""
        subject = t.subject or t.title
        events.append({
            "source": "ticket",
            "ticket_id": t.id,
            "visit_id": None,
            "order_id": None,
            "dispatch_id": None,
            "google_event_id": None,
            "title": _build_event_title(t.id, location, subject, t.client.name if t.client else "", t.client.company if t.client else ""),
            "raw_title": t.title,
            "location": location,
            "subject": subject,
            "scheduled_at": t.scheduled_at.isoformat(),
            "duration_minutes": t.duration_minutes or 60,
            "priority": t.priority,
            "status": {"id": t.status_rel.id, "name": t.status_rel.name, "color": t.status_rel.color} if t.status_rel else None,
            "client": t.client.name if t.client else "",
            "assigned_agent": t.assigned_agent.name if t.assigned_agent else None,
            "calendar_event_link": t.calendar_event_link,
        })

    # Orders with scheduled_at (not visible to clients)
    orders_q = db.query(models.Order).filter(
        models.Order.scheduled_at >= start,
        models.Order.scheduled_at < end,
        models.Order.deleted_at.is_(None),
    ).order_by(models.Order.scheduled_at) if current_user.role != models.UserRole.client else []
    for o in orders_q:
        if o.calendar_event_id:
            linked_event_ids.add(o.calendar_event_id)
        supplier_name = o.supplier1.name if o.supplier1 else ""
        events.append({
            "source": "order",
            "ticket_id": None,
            "visit_id": None,
            "order_id": o.id,
            "dispatch_id": None,
            "google_event_id": None,
            "title": _build_order_event_title(o.id, o.title, supplier_name),
            "raw_title": o.title,
            "location": "",
            "subject": supplier_name,
            "scheduled_at": o.scheduled_at.isoformat(),
            "duration_minutes": o.duration_minutes or 60,
            "priority": None,
            "status": {"id": None, "name": o.status, "color": "#8B5CF6"},
            "client": supplier_name,
            "assigned_agent": None,
            "calendar_event_link": o.calendar_event_link,
        })

    # Dispatches with scheduled_at (not visible to clients)
    dispatches_q = db.query(models.Dispatch).filter(
        models.Dispatch.scheduled_at >= start,
        models.Dispatch.scheduled_at < end,
        models.Dispatch.deleted_at.is_(None),
    ).order_by(models.Dispatch.scheduled_at) if current_user.role != models.UserRole.client else []
    for d in dispatches_q:
        if d.calendar_event_id:
            linked_event_ids.add(d.calendar_event_id)
        events.append({
            "source": "dispatch",
            "ticket_id": None,
            "visit_id": None,
            "order_id": None,
            "dispatch_id": d.id,
            "google_event_id": None,
            "title": _build_dispatch_event_title(d.id, d.title, d.client_name or ""),
            "raw_title": d.title,
            "location": "",
            "subject": d.client_name or "",
            "scheduled_at": d.scheduled_at.isoformat(),
            "duration_minutes": d.duration_minutes or 60,
            "priority": None,
            "status": {"id": None, "name": d.status, "color": "#06B6D4"},
            "client": d.client_name or "",
            "assigned_agent": None,
            "calendar_event_link": d.calendar_event_link,
        })

    # Fetch manual Google Calendar events (skip clients, require connected calendar)
    if current_user.role != models.UserRole.client and current_user.google_token:
        try:
            import json as _json
            from googleapiclient.discovery import build as _build
            from google.oauth2.credentials import Credentials as _Creds

            token_data = _json.loads(current_user.google_token)
            creds = _Creds(
                token=token_data.get("token"),
                refresh_token=token_data.get("refresh_token"),
                token_uri="https://oauth2.googleapis.com/token",
                client_id=token_data.get("client_id"),
                client_secret=token_data.get("client_secret"),
            )
            service = _build("calendar", "v3", credentials=creds, cache_discovery=False)

            time_min = start.isoformat() + "Z"
            time_max = end.isoformat() + "Z"
            page_token = None
            while True:
                result = service.events().list(
                    calendarId="primary",
                    timeMin=time_min,
                    timeMax=time_max,
                    singleEvents=True,
                    orderBy="startTime",
                    pageToken=page_token,
                ).execute()
                for ev in result.get("items", []):
                    if ev.get("status") == "cancelled":
                        continue
                    ev_id = ev.get("id", "")
                    if ev_id in linked_event_ids:
                        continue
                    ev_start = ev.get("start", {})
                    ev_end = ev.get("end", {})
                    start_str = ev_start.get("dateTime") or ev_start.get("date")
                    end_str = ev_end.get("dateTime") or ev_end.get("date")
                    if not start_str:
                        continue
                    try:
                        if "T" in start_str:
                            # Parse with timezone, then convert to UTC naive so the
                            # frontend (which appends 'Z') displays the correct local time.
                            sdt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                            sdt = sdt.astimezone(timezone.utc).replace(tzinfo=None)
                        else:
                            sdt = datetime(int(start_str[:4]), int(start_str[5:7]), int(start_str[8:10]))
                        if end_str and "T" in end_str:
                            edt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                            edt = edt.astimezone(timezone.utc).replace(tzinfo=None)
                            dur = max(1, int((edt - sdt).total_seconds() / 60))
                        elif end_str:
                            edt = datetime(int(end_str[:4]), int(end_str[5:7]), int(end_str[8:10]))
                            dur = max(1, int((edt - sdt).total_seconds() / 60))
                        else:
                            dur = 60
                    except Exception:
                        continue
                    events.append({
                        "source": "google",
                        "ticket_id": None,
                        "visit_id": None,
                        "order_id": None,
                        "dispatch_id": None,
                        "google_event_id": ev_id,
                        "title": ev.get("summary") or "(Sin título)",
                        "raw_title": ev.get("summary") or "(Sin título)",
                        "location": ev.get("location") or "",
                        "subject": ev.get("description") or "",
                        "scheduled_at": sdt.isoformat(),
                        "duration_minutes": dur,
                        "priority": None,
                        "status": None,
                        "client": "",
                        "assigned_agent": None,
                        "calendar_event_link": ev.get("htmlLink"),
                    })
                page_token = result.get("nextPageToken")
                if not page_token:
                    break
        except Exception:
            pass  # Don't fail the whole agenda if Google API errors

    events.sort(key=lambda e: e["scheduled_at"])
    return {"year": y, "month": m, "events": events}


def _build_order_event_title(order_id: int, title: str, supplier_name: str = "") -> str:
    parts = [f"Pedido #{order_id}", title.strip()]
    if supplier_name and supplier_name.strip():
        parts.append(supplier_name.strip())
    return " - ".join(parts)


def _build_dispatch_event_title(dispatch_id: int, title: str, client_name: str = "") -> str:
    parts = [f"Pedido #{dispatch_id}", title.strip()]
    if client_name and client_name.strip():
        parts.append(client_name.strip())
    return " - ".join(parts)


def _get_google_service(current_user, db):
    """Build a Google Calendar service from the user's stored token, refreshing if needed."""
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
        try:
            creds.refresh(Request())
        except Exception as e:
            err_str = str(e)
            if 'invalid_grant' in err_str or 'Token has been expired' in err_str or 'revoked' in err_str.lower():
                current_user.google_token = None
                db.commit()
                raise HTTPException(status_code=401, detail="Sesión de Google expirada. Reconecta tu cuenta en Configuración de perfil.")
            raise
        token_data["token"] = creds.token
        token_data["expiry"] = creds.expiry.isoformat() if creds.expiry else None
        current_user.google_token = json.dumps(token_data)
        db.commit()
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


@router.post("/create-event-order")
def create_order_calendar_event(
    data: schemas.CalendarOrderEventCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    if not current_user.google_token:
        raise HTTPException(status_code=400, detail="Debes conectar tu cuenta de Google Calendar primero")

    try:
        service = _get_google_service(current_user, db)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Error de autenticación Google: {str(e)}")

    order = db.query(models.Order).filter(models.Order.id == data.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")

    _ESTADOS_NO_AGENDABLES = ("Cancelado", "Inventariado")
    if order.status in _ESTADOS_NO_AGENDABLES:
        raise HTTPException(
            status_code=422,
            detail=f"No se puede agendar un pedido en estado '{order.status}'"
        )

    supplier_name = order.supplier1.name if order.supplier1 else ""
    event_title = _build_order_event_title(order.id, order.title, supplier_name)

    start_dt = data.scheduled_at
    end_dt = start_dt + timedelta(minutes=data.duration_minutes)

    event_body = {
        "summary": event_title,
        "location": data.location or "",
        "description": f"Pedido: {order.title}\nProveedor: {supplier_name}\n\nNotas: {data.notes or ''}",
        "start": {"dateTime": start_dt.isoformat(), "timeZone": "America/Panama"},
        "end":   {"dateTime": end_dt.isoformat(),   "timeZone": "America/Panama"},
        "reminders": {"useDefault": True},
    }

    if order.calendar_event_id:
        try:
            service.events().delete(calendarId="primary", eventId=order.calendar_event_id).execute()
        except Exception:
            pass

    try:
        event = service.events().insert(calendarId="primary", body=event_body).execute()
    except Exception as e:
        err_str = str(e)
        if 'invalid_grant' in err_str or 'Token has been expired' in err_str or 'revoked' in err_str.lower():
            current_user.google_token = None
            db.commit()
            raise HTTPException(status_code=401, detail="Sesión de Google expirada. Reconecta tu cuenta en Configuración de perfil.")
        raise HTTPException(status_code=500, detail=f"Error creando evento: {err_str}")

    try:
        order.scheduled_at = start_dt
        order.duration_minutes = data.duration_minutes
        order.calendar_event_id = event.get("id")
        order.calendar_event_link = event.get("htmlLink")
        if order.status in ("Pendiente", "Borrador", None):
            order.status = "En proceso"
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error guardando en base de datos: {str(e)}")

    return {
        "event_id": event.get("id"),
        "event_link": event.get("htmlLink"),
        "event_title": event_title,
        "scheduled_at": start_dt.isoformat(),
    }


@router.delete("/event-order/{order_id}")
def delete_order_calendar_event(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order or not order.calendar_event_id:
        raise HTTPException(status_code=404, detail="No hay evento de calendario para este pedido")

    if current_user.google_token:
        try:
            service = _get_google_service(current_user, db)
            service.events().delete(calendarId="primary", eventId=order.calendar_event_id).execute()
        except Exception:
            pass

    order.calendar_event_id = None
    order.calendar_event_link = None
    order.scheduled_at = None
    db.commit()
    return {"ok": True}


@router.post("/create-event-dispatch")
def create_dispatch_calendar_event(
    data: schemas.CalendarDispatchEventCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    if not current_user.google_token:
        raise HTTPException(status_code=400, detail="Debes conectar tu cuenta de Google Calendar primero")

    try:
        service = _get_google_service(current_user, db)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Error de autenticación Google: {str(e)}")

    dispatch = db.query(models.Dispatch).filter(models.Dispatch.id == data.dispatch_id).first()
    if not dispatch:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")

    client_name = dispatch.client_name or ""
    event_title = _build_dispatch_event_title(dispatch.id, dispatch.title, client_name)

    start_dt = data.scheduled_at
    end_dt = start_dt + timedelta(minutes=data.duration_minutes)

    event_body = {
        "summary": event_title,
        "location": data.location or "",
        "description": f"Despacho: {dispatch.title}\nCliente: {client_name}\n\nNotas: {data.notes or ''}",
        "start": {"dateTime": start_dt.isoformat(), "timeZone": "America/Panama"},
        "end":   {"dateTime": end_dt.isoformat(),   "timeZone": "America/Panama"},
        "reminders": {"useDefault": True},
    }

    if dispatch.calendar_event_id:
        try:
            service.events().delete(calendarId="primary", eventId=dispatch.calendar_event_id).execute()
        except Exception:
            pass

    try:
        event = service.events().insert(calendarId="primary", body=event_body).execute()
    except Exception as e:
        err_str = str(e)
        if 'invalid_grant' in err_str or 'Token has been expired' in err_str or 'revoked' in err_str.lower():
            current_user.google_token = None
            db.commit()
            raise HTTPException(status_code=401, detail="Sesión de Google expirada. Reconecta tu cuenta en Configuración de perfil.")
        raise HTTPException(status_code=500, detail=f"Error creando evento: {err_str}")

    try:
        dispatch.scheduled_at = start_dt
        dispatch.duration_minutes = data.duration_minutes
        dispatch.calendar_event_id = event.get("id")
        dispatch.calendar_event_link = event.get("htmlLink")
        dispatch.status = "Pedido Programado"
        if dispatch.order_id:
            order = db.query(models.Order).filter(models.Order.id == dispatch.order_id).first()
            if order and order.status in ("Pendiente", "Borrador", None):
                order.status = "En proceso"
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error guardando en base de datos: {str(e)}")

    return {
        "event_id": event.get("id"),
        "event_link": event.get("htmlLink"),
        "event_title": event_title,
        "scheduled_at": start_dt.isoformat(),
    }


@router.delete("/event-dispatch/{dispatch_id}")
def delete_dispatch_calendar_event(
    dispatch_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    dispatch = db.query(models.Dispatch).filter(models.Dispatch.id == dispatch_id).first()
    if not dispatch or not dispatch.calendar_event_id:
        raise HTTPException(status_code=404, detail="No hay evento de calendario para este despacho")

    if current_user.google_token:
        try:
            service = _get_google_service(current_user, db)
            service.events().delete(calendarId="primary", eventId=dispatch.calendar_event_id).execute()
        except Exception:
            pass

    dispatch.calendar_event_id = None
    dispatch.calendar_event_link = None
    dispatch.scheduled_at = None
    db.commit()
    return {"ok": True}


@router.post("/visits")
def create_ticket_visit(
    data: schemas.CalendarVisitCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == data.ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")

    visit_count = db.query(models.TicketVisit).filter(models.TicketVisit.ticket_id == data.ticket_id).count()
    if visit_count >= 10:
        raise HTTPException(status_code=400, detail="Se ha alcanzado el límite de 10 visitas por ticket")

    is_first_visit = visit_count == 0
    location = data.location or ticket.location or ""
    subject = data.subject or ticket.subject or ticket.title

    if data.location:
        ticket.location = data.location
    if data.subject:
        ticket.subject = data.subject

    start_dt = data.scheduled_at
    end_dt = start_dt + timedelta(minutes=data.duration_minutes)

    client_name    = ticket.client.name    if ticket.client else ""
    client_company = ticket.client.company if ticket.client else ""
    event_title = _build_event_title(ticket.id, location, subject, client_name, client_company)

    # Google Calendar is optional — push event only if user has a valid token
    calendar_event_id = None
    calendar_event_link = None
    if current_user.google_token:
        try:
            service = _get_google_service(current_user, db)
            remote_note = "\n🔗 Visita remota" if data.is_remote else ""
            event_body = {
                "summary": event_title,
                "location": location,
                "description": (
                    f"Ticket: {ticket.title}\n"
                    f"Cliente: {ticket.client.name if ticket.client else ''}\n"
                    f"Prioridad: {ticket.priority}\n\n"
                    f"{ticket.description or ''}\n\n"
                    f"Notas: {data.notes or ''}"
                    f"{remote_note}"
                ),
                "start": {"dateTime": start_dt.isoformat(), "timeZone": "America/Panama"},
                "end":   {"dateTime": end_dt.isoformat(),   "timeZone": "America/Panama"},
                "reminders": {"useDefault": True},
            }
            event = service.events().insert(calendarId="primary", body=event_body).execute()
            calendar_event_id = event.get("id")
            calendar_event_link = event.get("htmlLink")
        except Exception as e:
            err_str = str(e)
            if 'invalid_grant' in err_str or 'Token has been expired' in err_str or 'revoked' in err_str.lower():
                current_user.google_token = None
                db.commit()
            # Calendar failure is non-fatal — visit is still saved locally

    visit = models.TicketVisit(
        ticket_id=ticket.id,
        scheduled_at=start_dt,
        duration_minutes=data.duration_minutes,
        calendar_event_id=calendar_event_id,
        calendar_event_link=calendar_event_link,
        notes=data.notes,
        is_remote=data.is_remote,
    )
    db.add(visit)

    ticket.scheduled_at = start_dt
    ticket.duration_minutes = data.duration_minutes
    ticket.calendar_event_id = calendar_event_id
    ticket.calendar_event_link = calendar_event_link

    if is_first_visit:
        programado = db.query(models.TicketStatus).filter(models.TicketStatus.name == "Programado").first()
        old_status_name = ticket.status_rel.name if ticket.status_rel else ""
        if programado and ticket.status_id != programado.id:
            ticket.status_id = programado.id
            db.add(models.TicketTimeline(
                ticket_id=ticket.id,
                user_id=current_user.id,
                content=f"Estado cambiado de \"{old_status_name}\" a \"Programado\" (ticket agendado automáticamente)",
                entry_type="status",
            ))

    PANAMA = timezone(timedelta(hours=-5))
    local_dt = start_dt.astimezone(PANAMA) if start_dt.tzinfo else start_dt.replace(tzinfo=timezone.utc).astimezone(PANAMA)
    visit_num = visit_count + 1
    db.add(models.TicketTimeline(
        ticket_id=ticket.id,
        user_id=current_user.id,
        content=f"Visita {visit_num} agendada: \"{event_title}\" para {local_dt.strftime('%d/%m/%Y %I:%M %p')}",
        entry_type="calendar",
    ))
    db.commit()
    db.refresh(visit)

    from routers.settings import try_send_reschedule_email
    background_tasks.add_task(
        try_send_reschedule_email,
        ticket.id,
        scheduled_at=start_dt,
        duration_minutes=data.duration_minutes,
        location=location,
        subject_text=subject,
        agent_name=current_user.name,
        bcc_email=data.bcc_email,
        is_reschedule=not is_first_visit,
    )

    return {
        "visit_id": visit.id,
        "event_id": calendar_event_id,
        "event_link": calendar_event_link,
        "event_title": event_title,
        "scheduled_at": start_dt.isoformat(),
        "calendar_linked": calendar_event_id is not None,
    }


@router.post("/visits/{visit_id}/push-to-google")
def push_visit_to_google(
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    """Push an existing local visit to Google Calendar."""
    visit = db.query(models.TicketVisit).filter(models.TicketVisit.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    if not current_user.google_token:
        raise HTTPException(status_code=400, detail="Google Calendar no está conectado")

    ticket = visit.ticket
    location = ticket.location or ""
    subject = ticket.subject or ticket.title
    client_name = ticket.client.name if ticket.client else ""
    client_company = ticket.client.company if ticket.client else ""
    event_title = _build_event_title(ticket.id, location, subject, client_name, client_company)

    start_dt = visit.scheduled_at
    end_dt = start_dt + timedelta(minutes=visit.duration_minutes or 60)

    try:
        service = _get_google_service(current_user, db)
        event_body = {
            "summary": event_title,
            "location": location,
            "description": (
                f"Ticket: {ticket.title}\n"
                f"Cliente: {client_name}\n"
                f"Prioridad: {ticket.priority}\n\n"
                f"Notas: {visit.notes or ''}"
            ),
            "start": {"dateTime": start_dt.isoformat(), "timeZone": "America/Panama"},
            "end":   {"dateTime": end_dt.isoformat(),   "timeZone": "America/Panama"},
            "reminders": {"useDefault": True},
        }
        event = service.events().insert(calendarId="primary", body=event_body).execute()
        visit.calendar_event_id = event.get("id")
        visit.calendar_event_link = event.get("htmlLink")
        ticket.calendar_event_id = event.get("id")
        ticket.calendar_event_link = event.get("htmlLink")
        db.commit()
        return {"ok": True, "event_link": visit.calendar_event_link}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al crear evento: {str(e)}")


@router.delete("/visits/{visit_id}")
def delete_ticket_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    visit = db.query(models.TicketVisit).filter(models.TicketVisit.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    if current_user.google_token and visit.calendar_event_id:
        try:
            service = _get_google_service(current_user, db)
            service.events().delete(calendarId="primary", eventId=visit.calendar_event_id).execute()
        except Exception:
            pass

    ticket = visit.ticket
    db.delete(visit)
    db.flush()

    remaining = db.query(models.TicketVisit).filter(
        models.TicketVisit.ticket_id == ticket.id
    ).order_by(models.TicketVisit.created_at.desc()).first()

    if remaining:
        ticket.scheduled_at = remaining.scheduled_at
        ticket.duration_minutes = remaining.duration_minutes
        ticket.calendar_event_id = remaining.calendar_event_id
        ticket.calendar_event_link = remaining.calendar_event_link
    else:
        ticket.scheduled_at = None
        ticket.calendar_event_id = None
        ticket.calendar_event_link = None

    db.commit()
    return {"ok": True}


@router.put("/visits/{visit_id}", response_model=schemas.TicketVisitOut)
def reschedule_ticket_visit(
    visit_id: int,
    data: schemas.CalendarVisitUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    visit = db.query(models.TicketVisit).filter(models.TicketVisit.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visita no encontrada")

    ticket = visit.ticket
    start_dt = data.scheduled_at
    end_dt = start_dt + timedelta(minutes=data.duration_minutes)

    if current_user.google_token and visit.calendar_event_id:
        try:
            service = _get_google_service(current_user, db)
            location = data.location or ticket.location or ""
            subject = ticket.subject or ticket.title
            client_name = ticket.client.name if ticket.client else ""
            client_company = ticket.client.company if ticket.client else ""
            event_title = _build_event_title(ticket.id, location, subject, client_name, client_company)
            patch_body = {
                "summary": event_title,
                "start": {"dateTime": start_dt.isoformat(), "timeZone": "America/Panama"},
                "end":   {"dateTime": end_dt.isoformat(),   "timeZone": "America/Panama"},
            }
            if data.location:
                patch_body["location"] = data.location
            is_remote_val = data.is_remote if data.is_remote is not None else visit.is_remote
            remote_note = "\n🔗 Visita remota" if is_remote_val else ""
            patch_body["description"] = (
                f"Ticket: {ticket.title}\n"
                f"Cliente: {client_name}\n"
                f"Notas: {data.notes or visit.notes or ''}"
                f"{remote_note}"
            )
            service.events().patch(
                calendarId="primary", eventId=visit.calendar_event_id, body=patch_body
            ).execute()
        except HTTPException:
            raise
        except Exception:
            pass

    visit.scheduled_at = start_dt
    visit.duration_minutes = data.duration_minutes
    if data.notes:
        visit.notes = data.notes
    if data.is_remote is not None:
        visit.is_remote = data.is_remote

    # Update ticket's latest scheduled_at to reflect this visit
    ticket.scheduled_at = start_dt
    ticket.duration_minutes = data.duration_minutes

    PANAMA = timezone(timedelta(hours=-5))
    local_dt = start_dt.astimezone(PANAMA) if start_dt.tzinfo else start_dt.replace(tzinfo=timezone.utc).astimezone(PANAMA)
    db.add(models.TicketTimeline(
        ticket_id=ticket.id,
        user_id=current_user.id,
        content=f"Visita reagendada para {local_dt.strftime('%d/%m/%Y %I:%M %p')}",
        entry_type="calendar",
    ))
    db.commit()
    db.refresh(visit)
    return visit


@router.post("/visits/{visit_id}/cancel", response_model=schemas.TicketVisitOut)
def cancel_ticket_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    visit = db.query(models.TicketVisit).filter(models.TicketVisit.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    if visit.status == "cancelled":
        raise HTTPException(status_code=400, detail="La visita ya está cancelada")

    if current_user.google_token and visit.calendar_event_id:
        try:
            service = _get_google_service(current_user, db)
            service.events().patch(
                calendarId="primary",
                eventId=visit.calendar_event_id,
                body={"colorId": "11"},  # Tomato / red
            ).execute()
        except HTTPException:
            raise
        except Exception:
            pass

    visit.status = "cancelled"
    ticket = visit.ticket
    db.add(models.TicketTimeline(
        ticket_id=ticket.id,
        user_id=current_user.id,
        content="Visita cancelada",
        entry_type="calendar",
    ))
    db.commit()
    db.refresh(visit)
    return visit


@router.patch("/visits/{visit_id}/costo", response_model=schemas.TicketVisitOut)
def update_visit_costo(
    visit_id: int,
    data: schemas.VisitCostoUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in (models.UserRole.admin, models.UserRole.supervisor, models.UserRole.superadmin):
        raise HTTPException(status_code=403, detail="Solo administradores pueden editar el costo")
    visit = db.query(models.TicketVisit).filter(models.TicketVisit.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    visit.costo = data.costo
    db.commit()
    db.refresh(visit)
    return visit


@router.post("/sync")
def sync_calendar_events(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    """Pull latest date/time from Google Calendar back into our records."""
    import logging as _log
    from datetime import timezone as _tz

    if not current_user.google_token:
        raise HTTPException(status_code=400, detail="Google Calendar no está conectado")
    try:
        service = _get_google_service(current_user, db)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error conectando con Google Calendar: {e}")

    # ── helpers ───────────────────────────────────────────────────────────

    def _to_utc_aware(dt):
        if dt is None:
            return None
        if dt.tzinfo is not None:
            return dt.astimezone(_tz.utc)
        return dt.replace(tzinfo=_tz.utc)

    def _parse_iso(s):
        """Parse ISO-8601 datetime string (handles Z and offset suffixes)."""
        s = s.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(s)
        except ValueError:
            # All-day date string "YYYY-MM-DD"
            return datetime(int(s[:4]), int(s[5:7]), int(s[8:10]), tzinfo=_tz.utc)

    def _parse_event_times(ev):
        start_str = ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date")
        end_str   = ev.get("end",   {}).get("dateTime") or ev.get("end",   {}).get("date")
        if not start_str:
            return None, None
        try:
            start_dt = _to_utc_aware(_parse_iso(start_str))
            duration = None
            if end_str:
                end_dt = _to_utc_aware(_parse_iso(end_str))
                duration = max(15, int((end_dt - start_dt).total_seconds() / 60))
            return start_dt, duration
        except Exception as exc:
            _log.warning("sync: cannot parse event times: %s", exc)
            return None, None

    def _diff_sec(a, b):
        ua, ub = _to_utc_aware(a), _to_utc_aware(b)
        if ua is None or ub is None:
            return 0
        return abs((ua - ub).total_seconds())

    # ── fetch ALL calendar events in a wide window via one list() call ────
    # Fetching events one-by-one via events.get() fails silently on the first
    # token or network error; events.list() is one round-trip and returns
    # everything we need in one shot.

    now_utc = datetime.now(_tz.utc)
    time_min = (now_utc - timedelta(days=365)).isoformat()   # up to 1 year back
    time_max = (now_utc + timedelta(days=365)).isoformat()   # up to 1 year ahead

    google_events: dict = {}   # event_id → event dict
    try:
        page_token = None
        while True:
            result = service.events().list(
                calendarId="primary",
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime",
                pageToken=page_token,
                maxResults=2500,
            ).execute()
            for ev in result.get("items", []):
                if ev.get("status") != "cancelled" and ev.get("id"):
                    google_events[ev["id"]] = ev
            page_token = result.get("nextPageToken")
            if not page_token:
                break
        _log.info("sync: fetched %d Google Calendar events", len(google_events))
    except Exception as exc:
        _log.error("sync: events.list() failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Error leyendo Google Calendar: {exc}")

    if not google_events:
        return {"ok": True, "updated": 0, "found": 0}

    updated = 0
    unmatched_ids = []   # DB event IDs that don't exist in Google

    # ── Ticket visits ─────────────────────────────────────────────────────
    visits = db.query(models.TicketVisit).filter(
        models.TicketVisit.calendar_event_id.isnot(None)
    ).all()
    synced_ticket_ids = set()
    visits_matched = 0
    for v in visits:
        ev = google_events.get(v.calendar_event_id)
        if not ev:
            unmatched_ids.append(("visit", v.id, v.calendar_event_id))
            continue
        visits_matched += 1
        start_dt, duration = _parse_event_times(ev)
        changed = False
        if start_dt and _diff_sec(start_dt, v.scheduled_at) > 30:
            v.scheduled_at = start_dt
            if v.ticket:
                v.ticket.scheduled_at = start_dt
                synced_ticket_ids.add(v.ticket_id)
            changed = True
        if duration is not None and duration != v.duration_minutes:
            v.duration_minutes = duration
            changed = True
        if changed:
            updated += 1

    # ── Tickets with direct calendar_event_id (no TicketVisit row) ────────
    direct_tickets = db.query(models.Ticket).filter(
        models.Ticket.calendar_event_id.isnot(None)
    ).all()
    tickets_matched = 0
    for t in direct_tickets:
        if t.id in synced_ticket_ids:
            continue
        ev = google_events.get(t.calendar_event_id)
        if not ev:
            unmatched_ids.append(("ticket", t.id, t.calendar_event_id))
            continue
        tickets_matched += 1
        start_dt, duration = _parse_event_times(ev)
        changed = False
        if start_dt and (not t.scheduled_at or _diff_sec(start_dt, t.scheduled_at) > 30):
            t.scheduled_at = start_dt
            changed = True
        if duration is not None and duration != t.duration_minutes:
            t.duration_minutes = duration
            changed = True
        if changed:
            updated += 1

    # ── Orders ────────────────────────────────────────────────────────────
    orders = db.query(models.Order).filter(models.Order.calendar_event_id.isnot(None)).all()
    orders_matched = 0
    for order in orders:
        ev = google_events.get(order.calendar_event_id)
        if not ev:
            unmatched_ids.append(("order", order.id, order.calendar_event_id))
            continue
        orders_matched += 1
        start_dt, duration = _parse_event_times(ev)
        changed = False
        if start_dt and (not order.scheduled_at or _diff_sec(start_dt, order.scheduled_at) > 30):
            order.scheduled_at = start_dt
            changed = True
        if duration is not None and order.duration_minutes != duration:
            order.duration_minutes = duration
            changed = True
        if changed:
            updated += 1

    # ── Dispatches ────────────────────────────────────────────────────────
    dispatches = db.query(models.Dispatch).filter(models.Dispatch.calendar_event_id.isnot(None), models.Dispatch.deleted_at.is_(None)).all()
    dispatches_matched = 0
    for dispatch in dispatches:
        ev = google_events.get(dispatch.calendar_event_id)
        if not ev:
            unmatched_ids.append(("dispatch", dispatch.id, dispatch.calendar_event_id))
            continue
        dispatches_matched += 1
        start_dt, duration = _parse_event_times(ev)
        changed = False
        if start_dt and (not dispatch.scheduled_at or _diff_sec(start_dt, dispatch.scheduled_at) > 30):
            dispatch.scheduled_at = start_dt
            changed = True
        if duration is not None and dispatch.duration_minutes != duration:
            dispatch.duration_minutes = duration
            changed = True
        if changed:
            updated += 1

    # ── Push local visits without a Google Calendar event ────────────────
    pushed = 0
    unlinked_visits = db.query(models.TicketVisit).filter(
        models.TicketVisit.calendar_event_id.is_(None),
        models.TicketVisit.status != "cancelled",
        models.TicketVisit.scheduled_at.isnot(None),
    ).all()
    for v in unlinked_visits:
        try:
            ticket = v.ticket
            if not ticket:
                continue
            location = ticket.location or ""
            subject = ticket.subject or ticket.title
            client_name = ticket.client.name if ticket.client else ""
            client_company = ticket.client.company if ticket.client else ""
            event_title = _build_event_title(ticket.id, location, subject, client_name, client_company)
            start_dt = _to_utc_aware(v.scheduled_at) if v.scheduled_at else None
            if not start_dt:
                continue
            end_dt = start_dt + timedelta(minutes=v.duration_minutes or 60)
            event_body = {
                "summary": event_title,
                "location": location,
                "description": f"Ticket: {ticket.title}\nCliente: {client_name}\nNotas: {v.notes or ''}",
                "start": {"dateTime": start_dt.isoformat(), "timeZone": "America/Panama"},
                "end":   {"dateTime": end_dt.isoformat(),   "timeZone": "America/Panama"},
                "reminders": {"useDefault": True},
            }
            event = service.events().insert(calendarId="primary", body=event_body).execute()
            v.calendar_event_id = event.get("id")
            v.calendar_event_link = event.get("htmlLink")
            ticket.calendar_event_id = event.get("id")
            ticket.calendar_event_link = event.get("htmlLink")
            pushed += 1
        except Exception:
            pass

    db.commit()
    total_db = len(visits) + len(direct_tickets) + len(orders) + len(dispatches)
    total_matched = visits_matched + tickets_matched + orders_matched + dispatches_matched
    _log.info(
        "sync: done. updated=%d  pushed=%d  google=%d  db_records=%d  matched=%d  unmatched=%d",
        updated, pushed, len(google_events), total_db, total_matched, len(unmatched_ids),
    )
    return {
        "ok": True,
        "updated": updated,
        "pushed": pushed,
        "found": len(google_events),
        "db_records": total_db,
        "matched": total_matched,
        "unmatched": len(unmatched_ids),
    }


@router.get("/conflicts")
def check_conflicts(
    start: str,
    duration_minutes: int = Query(default=60),
    exclude_ticket_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    """Detecta tickets agendados que se solapen con el rango dado."""
    try:
        start_dt = datetime.fromisoformat(start)
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido")

    end_dt = start_dt + timedelta(minutes=duration_minutes)

    q = db.query(models.Ticket).filter(models.Ticket.scheduled_at.isnot(None))
    if exclude_ticket_id:
        q = q.filter(models.Ticket.id != exclude_ticket_id)

    conflicts = []
    for t in q.all():
        t_duration = t.duration_minutes or 60
        t_end = t.scheduled_at + timedelta(minutes=t_duration)
        if start_dt < t_end and end_dt > t.scheduled_at:
            conflicts.append({
                "ticket_id": t.id,
                "title": t.title,
                "client": t.client.name if t.client else "",
                "agent": t.assigned_agent.name if t.assigned_agent else "Sin asignar",
                "scheduled_at": t.scheduled_at.isoformat(),
                "duration_minutes": t_duration,
            })

    return {"conflicts": conflicts}
