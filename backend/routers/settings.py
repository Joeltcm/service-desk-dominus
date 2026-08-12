import os
import re
import imaplib
import base64
import json
import urllib.request
import urllib.error
from typing import Optional
from datetime import timezone, timedelta
import email as _email_lib
from email.header import decode_header as _decode_email_header
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from email.mime.base import MIMEBase
from email import encoders as _email_encoders

from fastapi import APIRouter, Depends, HTTPException, Body, Request
from sqlalchemy.orm import Session

from database import get_db
from auth import get_current_user
import models
import storage

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/_conntest")
def _conntest():
    """DIAGNÓSTICO TEMPORAL: prueba conectividad TCP saliente a puertos SMTP desde el servidor."""
    import socket, time
    targets = [
        ("smtp.gmail.com", 587), ("smtp.gmail.com", 465),
        ("smtp-relay.brevo.com", 587),
        ("cp7112.webempresa.eu", 587), ("cp7112.webempresa.eu", 465), ("cp7112.webempresa.eu", 25),
    ]
    out = []
    for h, p in targets:
        t = time.time()
        try:
            s = socket.create_connection((h, p), timeout=8)
            s.close()
            out.append({"target": f"{h}:{p}", "ok": True, "ms": int((time.time() - t) * 1000)})
        except Exception as e:
            out.append({"target": f"{h}:{p}", "ok": False, "error": f"{type(e).__name__}: {e}", "ms": int((time.time() - t) * 1000)})
    return {"results": out}


SMTP_KEYS = ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_from", "smtp_tls", "brevo_api_key", "admin_notification_email"]
IMAP_KEYS = ["imap_host", "imap_port", "imap_user", "imap_password", "imap_ssl", "imap_enabled", "imap_poll_interval", "imap_create_tickets"]
FORMAT_KEYS = ["fmt_tz", "fmt_date_format", "fmt_time_format"]


def _get_setting(db: Session, key: str) -> str:
    row = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    return row.value if row else ""


def _set_setting(db: Session, key: str, value: str):
    row = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(models.AppSetting(key=key, value=value))


def _smtp_connect(host, port, user, password, use_tls: bool):
    port = int(port or 587)
    if use_tls:
        s = smtplib.SMTP(host, port, timeout=15)
        s.ehlo()
        s.starttls()
    else:
        s = smtplib.SMTP_SSL(host, port, timeout=15)
    if user and password:
        s.login(user, password)
    return s


def _send_via_brevo_api(api_key: str, from_addr: str, to: str, subject: str, body_html: str,
                         inline_images: dict = None, cc: str = None, bcc: str = None, reply_to: str = None,
                         file_attachments: list = None):
    """Send email via Brevo REST API over HTTPS — no SMTP port required."""
    payload = {
        "sender": {"email": from_addr},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": body_html,
    }
    if reply_to:
        payload["replyTo"] = {"email": reply_to}
    if cc:
        cc_list = [a.strip() for a in cc.split(',') if a.strip()]
        if cc_list:
            payload["cc"] = [{"email": e} for e in cc_list]
    if bcc:
        bcc_list = [a.strip() for a in bcc.split(',') if a.strip()]
        if bcc_list:
            payload["bcc"] = [{"email": e} for e in bcc_list]
    if inline_images:
        imgs = []
        for att_id, (name, data, content_type) in inline_images.items():
            imgs.append({"content": base64.b64encode(data).decode(), "name": f"img_{att_id}"})
        payload["inlineImages"] = imgs
    if file_attachments:
        payload["attachment"] = [
            {"content": base64.b64encode(data).decode(), "name": fname}
            for fname, data, _ctype in file_attachments
        ]
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload).encode("utf-8"),
        headers={"accept": "application/json", "api-key": api_key, "content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status >= 400:
                raise Exception(f"Brevo API error {resp.status}: {resp.read().decode()}")
    except urllib.error.HTTPError as e:
        raise Exception(f"Brevo API error {e.code}: {e.read().decode()}")


def _send_email(host, port, user, password, from_addr, use_tls: bool, to: str, subject: str, body_html: str,
                cc: str = None, bcc: str = None, reply_to: str = None, file_attachments: list = None):
    """Simple send without inline images (used for test email)."""
    if file_attachments:
        outer = MIMEMultipart("mixed")
        inner = MIMEMultipart("alternative")
        inner.attach(MIMEText(body_html, "html", "utf-8"))
        outer.attach(inner)
        for fname, data, ctype in file_attachments:
            maintype, subtype = (ctype or "application/octet-stream").split("/", 1)
            part = MIMEBase(maintype, subtype)
            part.set_payload(data)
            _email_encoders.encode_base64(part)
            part.add_header("Content-Disposition", "attachment", filename=fname)
            outer.attach(part)
        msg = outer
    else:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(body_html, "html", "utf-8"))
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to
    if reply_to:
        msg["Reply-To"] = reply_to
    recipients = [to]
    if cc:
        cc_list = [a.strip() for a in cc.split(',') if a.strip()]
        if cc_list:
            msg["Cc"] = ", ".join(cc_list)
            recipients += cc_list
    if bcc:
        bcc_list = [a.strip() for a in bcc.split(',') if a.strip()]
        recipients += bcc_list  # no header — stays hidden
    s = _smtp_connect(host, port, user, password, use_tls)
    s.sendmail(from_addr, recipients, msg.as_string())
    s.quit()


def _send_email_with_inline_images(
    host, port, user, password, from_addr, use_tls: bool,
    to: str, subject: str, body_html: str,
    inline_images: dict,  # {att_id_str: (original_name, bytes, content_type)}
    cc: str = None,
    bcc: str = None,
    reply_to: str = None,
    file_attachments: list = None,
):
    """Send HTML email with CID-embedded inline images and optional file attachments."""
    related = MIMEMultipart("related")
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(body_html, "html", "utf-8"))
    related.attach(alt)
    for att_id, (original_name, data, content_type) in inline_images.items():
        subtype = (content_type or "image/jpeg").split("/", 1)[-1]
        img_part = MIMEImage(data, _subtype=subtype)
        img_part.add_header("Content-ID", f"<img_{att_id}>")
        img_part.add_header("Content-Disposition", "inline", filename=original_name)
        related.attach(img_part)

    if file_attachments:
        outer = MIMEMultipart("mixed")
        outer.attach(related)
        for fname, data, ctype in file_attachments:
            maintype, subtype = (ctype or "application/octet-stream").split("/", 1)
            part = MIMEBase(maintype, subtype)
            part.set_payload(data)
            _email_encoders.encode_base64(part)
            part.add_header("Content-Disposition", "attachment", filename=fname)
            outer.attach(part)
        msg = outer
    else:
        msg = related

    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to
    if reply_to:
        msg["Reply-To"] = reply_to
    recipients = [to]
    if cc:
        cc_list = [a.strip() for a in cc.split(',') if a.strip()]
        if cc_list:
            msg["Cc"] = ", ".join(cc_list)
            recipients += cc_list
    if bcc:
        bcc_list = [a.strip() for a in bcc.split(',') if a.strip()]
        recipients += bcc_list  # no header — stays hidden

    s = _smtp_connect(host, port, user, password, use_tls)
    s.sendmail(from_addr, recipients, msg.as_string())
    s.quit()


_PRIORITY_LABEL = {"critical": "Crítica", "high": "Alta", "medium": "Media", "low": "Baja"}
_RESOLVED_NAMES = {"resuelto", "resolved", "cerrado", "closed"}
_LOGO_CID = "logo"
_MONTHS_ES = ["enero","febrero","marzo","abril","mayo","junio",
               "julio","agosto","septiembre","octubre","noviembre","diciembre"]
_DAYS_ES   = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"]


def _fmt_scheduled(dt) -> str:
    """Format a scheduled_at datetime in Spanish (Panama UTC-5). Returns 'Por confirmar' if None."""
    if not dt:
        return "Por confirmar"
    try:
        from datetime import timezone, timedelta
        PANAMA = timezone(timedelta(hours=-5))
        if getattr(dt, "tzinfo", None):
            dt = dt.astimezone(PANAMA)
        day   = _DAYS_ES[dt.weekday()].capitalize()
        month = _MONTHS_ES[dt.month - 1]
        hour  = dt.strftime("%I:%M %p")
        return f"{day}, {dt.day} de {month} de {dt.year} · {hour}"
    except Exception:
        return str(dt)


def _load_logo():
    """Read logo.png from frontend dist/public. Returns (bytes, mime) or (None, None)."""
    base = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    for rel in (os.path.join("frontend", "dist", "logo.png"),
                os.path.join("frontend", "public", "logo.png")):
        path = os.path.join(base, rel)
        if os.path.exists(path):
            try:
                with open(path, "rb") as f:
                    return f.read(), "image/png"
            except Exception:
                pass
    return None, None


def _send_with_logo(host, port, user, password, from_addr, use_tls, to, subject, html,
                    extra_images: dict = None, cc: str = None, bcc: str = None, reply_to: str = None,
                    api_key: str = None, file_attachments: list = None):
    """Send HTML email embedding logo.png as CID if available. Uses Brevo API when api_key is set."""
    logo_data, logo_mime = _load_logo()
    images = dict(extra_images or {})
    if logo_data:
        images[_LOGO_CID] = ("logo.png", logo_data, logo_mime)
    if api_key:
        _send_via_brevo_api(api_key, from_addr, to, subject, html,
                            inline_images=images if images else None, cc=cc, bcc=bcc, reply_to=reply_to,
                            file_attachments=file_attachments)
    elif images:
        _send_email_with_inline_images(host, port, user, password, from_addr, use_tls,
                                       to, subject, html, images, cc=cc, bcc=bcc, reply_to=reply_to,
                                       file_attachments=file_attachments)
    else:
        _send_email(host, port, user, password, from_addr, use_tls, to, subject, html, cc=cc, bcc=bcc,
                    reply_to=reply_to, file_attachments=file_attachments)


def _smtp_cfg(db: Session):
    host = _get_setting(db, "smtp_host")
    api_key = _get_setting(db, "brevo_api_key") or None
    if not host and not api_key:
        return None
    return dict(
        host=host or "",
        port=_get_setting(db, "smtp_port") or "587",
        user=_get_setting(db, "smtp_user"),
        password=_get_setting(db, "smtp_password"),
        from_addr=_get_setting(db, "smtp_from") or _get_setting(db, "smtp_user"),
        use_tls=(_get_setting(db, "smtp_tls") or "true").lower() == "true",
        api_key=api_key,
    )


def _merge_bcc(*parts) -> Optional[str]:
    merged = ", ".join(p.strip() for p in parts if p and p.strip())
    return merged or None


def _resolve_inline_images(content: str, ticket_id: int, db) -> tuple[str, dict]:
    """Parse [img:N] markers in content.
    If Railway public domain is set, replace with public <img src> URLs (no CID needed).
    Otherwise load files from disk and return CID inline_images dict for MIME embedding.
    Returns (html_content, inline_images_dict).
    """
    upload_dir = os.getenv("UPLOAD_DIR", "uploads")
    railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN")
    inline_images = {}

    att_map = {}
    for att_id in re.findall(r'\[img:(\d+)\]', content):
        if att_id in att_map:
            continue
        att = db.query(models.TicketAttachment).filter(
            models.TicketAttachment.id == int(att_id),
            models.TicketAttachment.ticket_id == ticket_id,
        ).first()
        if att:
            att_map[att_id] = att

    def _replace(m):
        aid = m.group(1)
        att = att_map.get(aid)
        if not att:
            return "[imagen adjunta]"
        img_style = 'style="max-width:100%;max-height:400px;border-radius:4px;border:1px solid #e5e7eb;margin:6px 0;display:block"'
        if railway_domain:
            return f'<img src="https://{railway_domain}/u/{ticket_id}/{att.filename}" {img_style} />'
        # CID path: load from storage
        _key = f"{ticket_id}/{att.filename}"
        if storage.file_exists(_key):
            inline_images[aid] = (att.original_name, storage.read_file(_key), att.content_type or "image/jpeg")
            return f'<img src="cid:img_{aid}" {img_style} />'
        return "[imagen adjunta]"

    html = re.sub(r'\[img:(\d+)\]', _replace, content)
    return html, inline_images


def _ticket_email_wrap(body_inner: str, db=None) -> str:
    # Prefer public URL for logo (Gmail blocks CID inline images); fall back to CID for SMTP.
    railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN")
    if railway_domain:
        logo_src = f"https://{railway_domain}/logo.png"
    else:
        logo_src = "cid:img_logo"
    logo_img = f'<img src="{logo_src}" width="52" height="52" alt="Logo" style="border-radius:10px;display:block;background:#fff;padding:4px" />'
    co_name = (_get_setting(db, "company_name") if db else "") or "Service Desk"
    return f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1d4ed8;border-radius:10px 10px 0 0;border-collapse:collapse">
    <tr>
      <td style="padding:14px 12px 14px 20px;width:60px;vertical-align:middle">
        {logo_img}
      </td>
      <td style="padding:14px 20px 14px 8px;vertical-align:middle">
        <div style="color:#fff;font-size:18px;font-weight:700;line-height:1.2">{co_name}</div>
        <div style="color:#93c5fd;font-size:11px;margin-top:3px">Service Desk</div>
      </td>
    </tr>
  </table>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:24px 28px">
    {body_inner}
    <p style="font-size:12px;color:#94a3b8;margin:20px 0 0;line-height:1.6">
      Si tiene alguna consulta puede contactarnos directamente o iniciar sesión en el portal de soporte.
    </p>
  </div>
  <div style="text-align:center;padding:14px;font-size:11px;color:#94a3b8">
    {co_name} &nbsp;·&nbsp; Service Desk
  </div>
</div>"""


def try_send_ticket_open_email(ticket_id: int):
    """Notify the client when a new ticket is opened. Silently fails."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        cfg = _smtp_cfg(db)
        if not cfg:
            return
        ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
        if not ticket or not ticket.client or not ticket.client.email:
            return
        client_email    = ticket.client.email
        client_name     = ticket.client.name or "Cliente"
        priority_label  = _PRIORITY_LABEL.get(ticket.priority, ticket.priority or "—")
        desc_html       = (ticket.description or "").replace("\n", "<br>") if ticket.description else ""
        agent_label     = ticket.assigned_agent.name if ticket.assigned_agent else "Por asignar"
        agent_pending   = not ticket.assigned_to_id
        scheduled_label = _fmt_scheduled(ticket.scheduled_at)
        sched_pending   = not ticket.scheduled_at
        location_label  = ticket.location or "Por confirmar"
        loc_pending     = not ticket.location

        def _pending(v): return f'<span style="color:#9ca3af;font-style:italic">{v}</span>'
        agent_val    = _pending(agent_label)    if agent_pending  else f'<strong style="color:#111827">{agent_label}</strong>'
        sched_val    = _pending(scheduled_label) if sched_pending  else f'<strong style="color:#111827">{scheduled_label}</strong>'
        location_val = _pending(location_label)  if loc_pending    else f'<strong style="color:#111827">{location_label}</strong>'

        body = _ticket_email_wrap(f"""
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#64748b">
      <strong style="color:#1d4ed8">Ticket #{ticket.id}</strong> &nbsp;·&nbsp; {ticket.title}
    </div>
    <p style="font-size:14px;color:#1e293b;margin:0 0 6px;font-weight:600">Estimado/a {client_name},</p>
    <p style="font-size:13px;color:#475569;margin:0 0 18px;line-height:1.6">
      Hemos recibido su solicitud de soporte. A continuación encontrará el resumen de su ticket:
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px">
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:7px 10px;color:#6b7280;width:38%">Número de ticket</td>
        <td style="padding:7px 10px;font-weight:600;color:#111827">#{ticket.id}</td>
      </tr>
      <tr style="border-bottom:1px solid #f1f5f9;background:#f8fafc">
        <td style="padding:7px 10px;color:#6b7280">Asunto</td>
        <td style="padding:7px 10px;font-weight:600;color:#111827">{ticket.title}</td>
      </tr>
      {"" if not ticket.category else f'<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:7px 10px;color:#6b7280">Categoría</td><td style="padding:7px 10px;color:#111827">{ticket.category}</td></tr>'}
      <tr style="border-bottom:1px solid #f1f5f9{"" if ticket.category else ";background:#f8fafc"}">
        <td style="padding:7px 10px;color:#6b7280">Prioridad</td>
        <td style="padding:7px 10px;color:#111827">{priority_label}</td>
      </tr>
      <tr style="border-bottom:1px solid #f1f5f9;background:#f8fafc">
        <td style="padding:7px 10px;color:#6b7280">Técnico asignado</td>
        <td style="padding:7px 10px">{agent_val}</td>
      </tr>
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:7px 10px;color:#6b7280">Fecha y hora de atención</td>
        <td style="padding:7px 10px">{sched_val}</td>
      </tr>
      <tr>
        <td style="padding:7px 10px;color:#6b7280">Lugar de atención</td>
        <td style="padding:7px 10px">{location_val}</td>
      </tr>
    </table>
    {"" if not desc_html else f'<div style="background:#f0f9ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:18px;font-size:13px;color:#1e293b;line-height:1.7">{desc_html}</div>'}
    <p style="font-size:13px;color:#475569;margin:0;line-height:1.6">
      Le notificaremos en cuanto haya novedades. El tiempo de respuesta dependerá de la prioridad asignada.
    </p>""", db)
        subject = f"[Ticket #{ticket.id}] Tu solicitud de soporte ha sido recibida — {ticket.title}"
        cc_email = getattr(ticket, "cc_email", None) or None
        admin_bcc = _get_setting(db, "admin_notification_email") or None
        reply_to = _get_setting(db, "imap_user") or None
        _send_with_logo(cfg["host"], cfg["port"], cfg["user"], cfg["password"], cfg["from_addr"], cfg["use_tls"],
                        client_email, subject, body, cc=cc_email, bcc=admin_bcc, reply_to=reply_to, api_key=cfg.get("api_key"))
    except Exception as e:
        logging.warning("Ticket open email failed for ticket %s: %s", ticket_id, e)
    finally:
        db.close()


def try_send_status_change_email(ticket_id: int, old_status: str, new_status: str, agent_name: str, comment_content: str = None, bcc_email: str = None):
    """Notify the client of a status change (non-resolution). Silently fails."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        cfg = _smtp_cfg(db)
        if not cfg:
            return
        ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
        if not ticket or not ticket.client or not ticket.client.email:
            return
        client_email = ticket.client.email
        client_name  = ticket.client.name or "Cliente"

        is_resolved = new_status.lower() in _RESOLVED_NAMES
        if is_resolved:
            accent = "#16a34a"
            icon = "✔"
            heading = "Su ticket ha sido resuelto"
            intro = "Nos complace informarle que su solicitud de soporte ha sido <strong>resuelta</strong>."
            note = "Si el problema persiste o necesita soporte adicional, no dude en abrir un nuevo ticket."
        else:
            accent = "#2563eb"
            icon = "⟳"
            heading = "Estado de su ticket actualizado"
            intro = "Le informamos que el estado de su solicitud de soporte ha cambiado."
            note = "Le notificaremos cuando haya nuevas actualizaciones."

        comment_block = ""
        inline_images = {}
        if comment_content:
            comment_html, inline_images = _resolve_inline_images(comment_content, ticket.id, db)
            comment_html = comment_html.replace("\n", "<br>")
            comment_block = f"""
    <div style="margin-top:18px">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;font-weight:600;margin-bottom:8px">Comentario del agente</div>
      <div style="background:#f0f9ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;padding:14px 18px;font-size:13px;color:#1e293b;line-height:1.7">{comment_html}</div>
    </div>"""

        body = _ticket_email_wrap(f"""
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#64748b">
      <strong style="color:#1d4ed8">Ticket #{ticket.id}</strong> &nbsp;·&nbsp; {ticket.title}
      &nbsp;·&nbsp; <strong>Agente:</strong> {agent_name}
    </div>
    <p style="font-size:14px;color:#1e293b;margin:0 0 6px;font-weight:600">Estimado/a {client_name},</p>
    <p style="font-size:13px;color:#475569;margin:0 0 18px;line-height:1.6">{intro}</p>
    <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:18px">
      <div style="background:{accent};padding:12px 16px;text-align:center;color:#fff;font-size:15px;font-weight:700">
        {icon} &nbsp;{heading}
      </div>
      <div style="display:flex;align-items:stretch;background:#fff">
        <div style="flex:1;padding:16px 20px;text-align:center;border-right:1px solid #f1f5f9">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:600;margin-bottom:4px">Estado anterior</div>
          <div style="font-size:14px;font-weight:600;color:#6b7280">{old_status}</div>
        </div>
        <div style="flex:1;padding:16px 20px;text-align:center">
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:600;margin-bottom:4px">Estado actual</div>
          <div style="font-size:14px;font-weight:700;color:{accent}">{new_status}</div>
        </div>
      </div>
    </div>
    <p style="font-size:13px;color:#475569;margin:0;line-height:1.6">{note}</p>{comment_block}""", db)

        if is_resolved:
            subject = f"[Ticket #{ticket.id}] Tu ticket ha sido resuelto — {ticket.title}"
        else:
            subject = f"[Ticket #{ticket.id}] Cambio de estado: {new_status} — {ticket.title}"
        cc_email = ticket.cc_email or None
        admin_bcc = _get_setting(db, "admin_notification_email") or None
        reply_to = _get_setting(db, "imap_user") or None
        file_attachments = _generate_linked_doc_pdfs(ticket, db)
        _send_with_logo(cfg["host"], cfg["port"], cfg["user"], cfg["password"], cfg["from_addr"], cfg["use_tls"],
                        client_email, subject, body, extra_images=inline_images or None,
                        cc=cc_email, bcc=_merge_bcc(bcc_email, admin_bcc), reply_to=reply_to, api_key=cfg.get("api_key"),
                        file_attachments=file_attachments or None)
    except Exception as e:
        logging.warning("Status change email failed for ticket %s: %s", ticket_id, e)
    finally:
        db.close()


def try_send_new_ticket_to_agents(ticket_id: int):
    """Notify the assigned agent (or all active agents/admins) when a client opens a new ticket."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        cfg = _smtp_cfg(db)
        if not cfg:
            return
        ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
        if not ticket:
            return
        client_name    = ticket.client.name if ticket.client else "Cliente"
        client_company = (ticket.client.company if ticket.client else None) or ""
        priority_label = _PRIORITY_LABEL.get(ticket.priority, ticket.priority or "—")
        desc_html      = (ticket.description or "").replace("\n", "<br>") if ticket.description else ""

        # Determine recipients: assigned agent or all agents+admins
        if ticket.assigned_agent and ticket.assigned_agent.email:
            recipients = [(ticket.assigned_agent.name, ticket.assigned_agent.email)]
        else:
            rows = db.query(models.User).filter(
                models.User.role.in_([models.UserRole.agent, models.UserRole.admin]),
                models.User.is_active == True,
                models.User.email.isnot(None),
            ).all()
            recipients = [(u.name, u.email) for u in rows if u.email]

        if not recipients:
            return

        subject = f"[Nuevo Ticket #{ticket.id}] {ticket.title}"
        reply_to = ticket.client.email if ticket.client else None

        for agent_name, agent_email in recipients:
            body = _ticket_email_wrap(f"""
    <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#92400e">
      <strong>Nuevo ticket abierto por cliente</strong> &nbsp;·&nbsp; Requiere atención
    </div>
    <p style="font-size:14px;color:#1e293b;margin:0 0 6px;font-weight:600">Hola {agent_name},</p>
    <p style="font-size:13px;color:#475569;margin:0 0 18px;line-height:1.6">
      Un cliente ha abierto una nueva solicitud de soporte que requiere tu atención:
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px">
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:7px 10px;color:#6b7280;width:38%">Ticket #</td>
        <td style="padding:7px 10px;font-weight:600;color:#111827">#{ticket.id}</td>
      </tr>
      <tr style="border-bottom:1px solid #f1f5f9;background:#f8fafc">
        <td style="padding:7px 10px;color:#6b7280">Asunto</td>
        <td style="padding:7px 10px;font-weight:600;color:#111827">{ticket.title}</td>
      </tr>
      <tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:7px 10px;color:#6b7280">Cliente</td>
        <td style="padding:7px 10px;color:#111827">{client_name}{f" — {client_company}" if client_company else ""}</td>
      </tr>
      {"" if not ticket.category else f'<tr style="border-bottom:1px solid #f1f5f9;background:#f8fafc"><td style="padding:7px 10px;color:#6b7280">Categoría</td><td style="padding:7px 10px;color:#111827">{ticket.category}</td></tr>'}
      <tr>
        <td style="padding:7px 10px;color:#6b7280">Prioridad</td>
        <td style="padding:7px 10px;font-weight:600;color:{"#dc2626" if ticket.priority == "critical" else "#ea580c" if ticket.priority == "high" else "#111827"}">{priority_label}</td>
      </tr>
    </table>
    {"" if not desc_html else f'<div style="background:#f0f9ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:0;font-size:13px;color:#1e293b;line-height:1.7">{desc_html}</div>'}""", db)
            _send_with_logo(cfg["host"], cfg["port"], cfg["user"], cfg["password"], cfg["from_addr"], cfg["use_tls"],
                            agent_email, subject, body, reply_to=reply_to, api_key=cfg.get("api_key"))
    except Exception as e:
        logging.warning("New ticket agent email failed for ticket %s: %s", ticket_id, e)
    finally:
        db.close()


def try_send_client_comment_to_agent(ticket_id: int, comment_content: str, client_name: str):
    """Notify the assigned agent when a client adds a comment to a ticket."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        cfg = _smtp_cfg(db)
        if not cfg:
            return
        ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
        if not ticket:
            return
        if ticket.assigned_agent and ticket.assigned_agent.email:
            agent_name, agent_email = ticket.assigned_agent.name, ticket.assigned_agent.email
        else:
            admin = db.query(models.User).filter(
                models.User.role == models.UserRole.admin,
                models.User.is_active == True,
                models.User.email.isnot(None),
            ).first()
            if not admin:
                return
            agent_name, agent_email = admin.name, admin.email

        comment_html = comment_content.replace("\n", "<br>")
        subject = f"[Ticket #{ticket.id}] Nuevo comentario del cliente — {ticket.title}"
        reply_to = ticket.client.email if ticket.client else None

        body = _ticket_email_wrap(f"""
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#64748b">
      <strong style="color:#1d4ed8">Ticket #{ticket.id}</strong> &nbsp;·&nbsp; {ticket.title}
      &nbsp;·&nbsp; <strong>Cliente:</strong> {client_name}
    </div>
    <p style="font-size:14px;color:#1e293b;margin:0 0 6px;font-weight:600">Hola {agent_name},</p>
    <p style="font-size:13px;color:#475569;margin:0 0 18px;line-height:1.6">
      El cliente <strong>{client_name}</strong> ha agregado un nuevo comentario en el ticket #{ticket.id}:
    </p>
    <div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0 8px 8px 0;padding:14px 18px;font-size:13px;color:#1e293b;line-height:1.7">
      {comment_html}
    </div>""", db)

        admin_bcc = _get_setting(db, "admin_notification_email") or None
        _send_with_logo(cfg["host"], cfg["port"], cfg["user"], cfg["password"], cfg["from_addr"], cfg["use_tls"],
                        agent_email, subject, body, bcc=admin_bcc, reply_to=reply_to, api_key=cfg.get("api_key"))
    except Exception as e:
        logging.warning("Client comment agent email failed for ticket %s: %s", ticket_id, e)
    finally:
        db.close()


def try_notify_agents_of_activity(ticket_id: int, actor_user_id: int, event_type: str, content: str = ""):
    """Notify all relevant agents/admins of any ticket activity, excluding the actor."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        cfg = _smtp_cfg(db)
        if not cfg:
            return
        ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
        if not ticket:
            return

        client_name = (ticket.client.name if ticket.client else None) or "—"

        # Collect recipients: assigned agent + all active agents/admins, excluding the actor
        recipient_map = {}
        if ticket.assigned_agent and ticket.assigned_agent.email and ticket.assigned_agent.id != actor_user_id:
            recipient_map[ticket.assigned_agent.id] = (ticket.assigned_agent.name, ticket.assigned_agent.email)

        all_agents = db.query(models.User).filter(
            models.User.role.in_([models.UserRole.admin, models.UserRole.agent]),
            models.User.is_active == True,
            models.User.email.isnot(None),
            models.User.id != actor_user_id,
        ).all()
        for u in all_agents:
            if u.id not in recipient_map:
                recipient_map[u.id] = (u.name, u.email)

        if not recipient_map:
            return

        # Event-specific styling
        if event_type == "client_comment":
            event_label = "Comentario del cliente"
            accent = "#16a34a"
            border_color = "#22c55e"
            bg_color = "#f0fdf4"
        elif event_type == "status_change":
            event_label = "Cambio de estado"
            accent = "#7c3aed"
            border_color = "#7c3aed"
            bg_color = "#faf5ff"
        else:
            event_label = "Nuevo comentario"
            accent = "#2563eb"
            border_color = "#3b82f6"
            bg_color = "#f0f9ff"

        # Get actor name
        actor = db.query(models.User).filter(models.User.id == actor_user_id).first()
        actor_name = actor.name if actor else "Sistema"

        content_html = re.sub(r'\[img:\d+\]', '[imagen]', content).replace("\n", "<br>") if content else ""
        subject = f"[Ticket #{ticket.id}] {event_label} — {ticket.title}"

        for uid, (recipient_name, recipient_email) in recipient_map.items():
            body = _ticket_email_wrap(f"""
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#64748b">
      <strong style="color:{accent}">Ticket #{ticket.id}</strong> &nbsp;·&nbsp; {ticket.title}
      &nbsp;·&nbsp; <strong>Cliente:</strong> {client_name}
    </div>
    <p style="font-size:14px;color:#1e293b;margin:0 0 6px;font-weight:600">Hola {recipient_name},</p>
    <p style="font-size:13px;color:#475569;margin:0 0 14px;line-height:1.6">
      Hay nueva actividad en el ticket <strong>#{ticket.id}</strong> por <strong>{actor_name}</strong>:
    </p>
    <div style="display:inline-block;background:{accent}18;border:1px solid {accent}50;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600;color:{accent};margin-bottom:14px">
      {event_label}
    </div>
    {"" if not content_html else f'<div style="background:{bg_color};border-left:4px solid {border_color};border-radius:0 8px 8px 0;padding:14px 18px;font-size:13px;color:#1e293b;line-height:1.7">{content_html}</div>'}""", db)
            try:
                _send_with_logo(cfg["host"], cfg["port"], cfg["user"], cfg["password"], cfg["from_addr"], cfg["use_tls"],
                                recipient_email, subject, body, api_key=cfg.get("api_key"))
                logging.info("Agent activity email sent: ticket=%s event=%s to=%s", ticket_id, event_type, recipient_email)
            except Exception as send_err:
                logging.warning("Agent activity email failed for %s: %s", recipient_email, send_err)
    except Exception as e:
        logging.warning("try_notify_agents_of_activity failed for ticket %s: %s", ticket_id, e)
    finally:
        db.close()


def _make_doc_pdf(doc_type: str, num: str, client: str, ruc: str, doc_date, items_json: str,
                  itbms_enabled: bool, notes: str, db=None,
                  client_address: str = '', client_email: str = '', client_phone: str = '',
                  payment_terms: str = '', due_date=None, payments: list = None) -> Optional[bytes]:
    """Generate a PDF for an invoice or quote using reportlab."""
    try:
        from reportlab.pdfgen import canvas as rl_canvas
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.colors import HexColor, white, black
        import json as _json
        import io as _io
        import math as _math

        def safe(s):
            return str(s or '').encode('latin-1', errors='replace').decode('latin-1')

        def fmt_date(d):
            if not d:
                return ''
            if hasattr(d, 'strftime'):
                return d.strftime('%d/%m/%Y')
            return safe(str(d))

        def fmt_money(v):
            try:
                return f'${float(str(v or "0").replace(",", "")):.2f}'
            except Exception:
                return '$0.00'

        try:
            items = _json.loads(items_json or "[]")
        except Exception:
            items = []

        visible_items = [it for it in items if str(it.get('description', '')).strip()]
        payments = payments or []

        buf = _io.BytesIO()
        PW, PH = A4
        MM = PW / 210

        ml = 15 * MM
        mr = 15 * MM
        mb = 22 * MM
        uw = PW - ml - mr

        dark_blue  = HexColor('#1e3a5f')
        mid_blue   = HexColor('#2d4d7a')
        light_gray = HexColor('#f8f9fb')
        border_c   = HexColor('#d1d5db')
        green_bg   = HexColor('#dcfce7')
        green_fg   = HexColor('#15803d')
        green_bd   = HexColor('#86efac')
        pay_bg     = HexColor('#f0fdf4')
        pay_bd     = HexColor('#bbf7d0')
        muted_c    = HexColor('#6b7280')

        co_name    = safe((_get_setting(db, "company_name")    if db else "") or "Service Desk")
        co_address = safe((_get_setting(db, "company_address") if db else "") or "Panama, Punta Pacifica, PH Pacific Wind")
        co_ruc     = safe((_get_setting(db, "company_ruc")     if db else "") or "4-754-575 DV 85")

        # column widths: # | description | qty | unit_price | total
        cw = [8 * MM, uw - 78 * MM, 16 * MM, 24 * MM, 24 * MM]
        cx = [ml]
        for w in cw[:-1]:
            cx.append(cx[-1] + w)

        c = rl_canvas.Canvas(buf, pagesize=A4)

        # ── HEADER ──────────────────────────────────────────────────────────────
        hh = 18 * MM
        c.setFillColor(dark_blue)
        c.rect(0, PH - hh, PW, hh, fill=1, stroke=0)
        # top line separator
        c.setStrokeColor(mid_blue)
        c.line(0, PH - hh, PW, PH - hh)

        c.setFillColor(white)
        c.setFont('Helvetica-Bold', 15)
        c.drawString(ml, PH - 12 * MM, co_name)

        label = 'FACTURA' if doc_type == 'invoice' else 'COTIZACION'
        c.setFont('Helvetica-Bold', 11)
        c.drawRightString(PW - mr, PH - 9 * MM, label)
        c.setFont('Helvetica', 9)
        c.drawRightString(PW - mr, PH - 14 * MM, safe(f'N\xb0 {num}'))

        # sub-header: address line
        c.setFillColor(HexColor('#93c5fd'))
        c.setFont('Helvetica', 7)
        y = PH - hh - 5 * MM
        c.setFillColor(HexColor('#374151'))
        c.drawString(ml, y, f'{co_address}')
        c.drawRightString(PW - mr, y, f'RUC: {co_ruc}')
        y -= 8 * MM

        # ── INFO BOXES: client (left) + date/terms (right) ──────────────────────
        box_h_start = y
        half = (uw - 4 * MM) / 2
        lx = ml
        rx = ml + half + 4 * MM

        # collect client lines
        cl_lines = []
        if ruc:
            cl_lines.append(f'RUC: {safe(ruc)}')
        if client_address:
            cl_lines.append(safe(client_address))
        if client_email:
            cl_lines.append(safe(client_email))
        if client_phone:
            cl_lines.append(safe(client_phone))
        box_rows = max(3, len(cl_lines) + 2)
        bh = box_rows * 4.5 * MM + 6 * MM

        # left box
        c.setFillColor(light_gray)
        c.setStrokeColor(border_c)
        c.rect(lx, y - bh, half, bh, fill=1, stroke=1)
        ty = y - 5 * MM
        c.setFillColor(muted_c)
        c.setFont('Helvetica-Bold', 6)
        c.drawString(lx + 3 * MM, ty, 'FACTURAR A')
        ty -= 4.5 * MM
        c.setFillColor(HexColor('#111827'))
        c.setFont('Helvetica-Bold', 9)
        c.drawString(lx + 3 * MM, ty, safe(client or 'Cliente'))
        ty -= 4.5 * MM
        c.setFont('Helvetica', 7.5)
        c.setFillColor(HexColor('#374151'))
        for ln in cl_lines:
            c.drawString(lx + 3 * MM, ty, ln[:55])
            ty -= 4 * MM

        # right box
        c.setFillColor(light_gray)
        c.rect(rx, y - bh, half, bh, fill=1, stroke=1)
        ty = y - 5 * MM
        c.setFillColor(muted_c)
        c.setFont('Helvetica-Bold', 6)
        c.drawString(rx + 3 * MM, ty, 'FECHA DE EMISION')
        ty -= 4.5 * MM
        c.setFillColor(HexColor('#111827'))
        c.setFont('Helvetica-Bold', 8.5)
        c.drawString(rx + 3 * MM, ty, fmt_date(doc_date) or '—')
        ty -= 5 * MM
        if due_date:
            c.setFillColor(muted_c)
            c.setFont('Helvetica-Bold', 6)
            c.drawString(rx + 3 * MM, ty, 'FECHA DE VENCIMIENTO')
            ty -= 4.5 * MM
            c.setFillColor(HexColor('#111827'))
            c.setFont('Helvetica-Bold', 8.5)
            c.drawString(rx + 3 * MM, ty, fmt_date(due_date))
            ty -= 5 * MM
        if payment_terms:
            c.setFillColor(muted_c)
            c.setFont('Helvetica-Bold', 6)
            c.drawString(rx + 3 * MM, ty, 'TERMINOS DE PAGO')
            ty -= 4.5 * MM
            c.setFillColor(HexColor('#111827'))
            c.setFont('Helvetica-Bold', 8.5)
            c.drawString(rx + 3 * MM, ty, safe(payment_terms))

        y -= bh + 6 * MM

        # ── TABLE HEADER ─────────────────────────────────────────────────────────
        rh = 7 * MM
        c.setFillColor(dark_blue)
        c.rect(ml, y - rh, uw, rh, fill=1, stroke=0)
        c.setFillColor(white)
        c.setFont('Helvetica-Bold', 7.5)
        hdr_labels = ['#', 'Descripcion', 'Cant.', 'Precio unit.', 'Total']
        haligns    = ['C', 'L', 'C', 'R', 'R']
        for i, h in enumerate(hdr_labels):
            ty2 = y - rh + 2.2 * MM
            if haligns[i] == 'L':
                c.drawString(cx[i] + 1.5 * MM, ty2, h)
            elif haligns[i] == 'C':
                c.drawCentredString(cx[i] + cw[i] / 2, ty2, h)
            else:
                c.drawRightString(cx[i] + cw[i] - 1.5 * MM, ty2, h)
        y -= rh

        # ── ITEM ROWS ────────────────────────────────────────────────────────────
        subtotal = 0.0
        ih = 6 * MM
        c.setStrokeColor(border_c)
        for idx, it in enumerate(visible_items):
            desc  = safe(it.get('description', ''))
            qty   = float(it.get('qty') or 0)
            price = float(it.get('unit_price') or 0)
            amt   = round(qty * price, 2)
            subtotal += amt

            if y - ih < mb + 40 * MM:
                c.showPage()
                y = PH - 15 * MM

            bg = light_gray if idx % 2 == 0 else white
            c.setFillColor(bg)
            c.rect(ml, y - ih, uw, ih, fill=1, stroke=0)
            c.setStrokeColor(border_c)
            c.line(ml, y - ih, PW - mr, y - ih)

            ty2 = y - ih + 1.8 * MM
            c.setFillColor(HexColor('#111827'))
            c.setFont('Helvetica', 8)
            c.drawCentredString(cx[0] + cw[0] / 2, ty2, str(idx + 1))
            c.drawString(cx[1] + 1.5 * MM, ty2, desc[:62])
            qty_s = str(int(qty)) if qty == int(qty) else str(qty)
            c.drawCentredString(cx[2] + cw[2] / 2, ty2, qty_s)
            c.drawRightString(cx[3] + cw[3] - 1.5 * MM, ty2, f'${price:.2f}')
            c.setFont('Helvetica-Bold', 8)
            c.drawRightString(cx[4] + cw[4] - 1.5 * MM, ty2, f'${amt:.2f}')
            y -= ih

        # ── TOTALS BOX ───────────────────────────────────────────────────────────
        y -= 4 * MM
        itbms_amt = _math.ceil(subtotal * 0.07 * 100) / 100 if itbms_enabled else 0.0
        total = subtotal + itbms_amt

        tot_w = 70 * MM
        tx = PW - mr - tot_w
        th = 6.5 * MM

        def draw_tot_row(lbl, val_str, bold=False, fill_c=None, text_c=None):
            nonlocal y
            tc = text_c or HexColor('#374151')
            if fill_c:
                c.setFillColor(fill_c)
                c.rect(tx, y - th, tot_w, th, fill=1, stroke=0)
                c.setFillColor(text_c or white)
            else:
                c.setFillColor(tc)
            c.setFont('Helvetica-Bold' if bold else 'Helvetica', 8.5)
            ty2 = y - th + 2 * MM
            c.drawString(tx + 3 * MM, ty2, lbl)
            c.drawRightString(tx + tot_w - 3 * MM, ty2, val_str)
            c.setFillColor(black)
            y -= th

        draw_tot_row('Subtotal', f'${subtotal:.2f}')
        if itbms_amt:
            draw_tot_row('ITBMS 7%', f'${itbms_amt:.2f}')

        c.setStrokeColor(dark_blue)
        c.line(tx, y, tx + tot_w, y)
        draw_tot_row('TOTAL A PAGAR', f'${total:.2f}', bold=True, fill_c=dark_blue, text_c=white)

        # payments / abonos
        if payments:
            total_paid = 0.0
            for p in payments:
                try:
                    amt_p = float(str(p.get('amount') if isinstance(p, dict) else getattr(p, 'amount', 0) or 0).replace(',', '') or 0)
                except Exception:
                    amt_p = 0.0
                total_paid += amt_p
                method = p.get('method') if isinstance(p, dict) else getattr(p, 'method', '')
                pdate  = p.get('date') if isinstance(p, dict) else getattr(p, 'date', '')
                lbl = safe(f'Abono · {method} · {fmt_date(pdate)}')
                c.setFillColor(HexColor('#f0fdf4'))
                c.rect(tx, y - th, tot_w, th, fill=1, stroke=0)
                c.setFillColor(green_fg)
                c.setFont('Helvetica', 8)
                ty2 = y - th + 2 * MM
                c.drawString(tx + 3 * MM, ty2, lbl[:38])
                c.drawRightString(tx + tot_w - 3 * MM, ty2, f'-${amt_p:.2f}')
                c.setFillColor(black)
                y -= th

            remaining = max(0.0, total - total_paid)
            if remaining <= 0:
                draw_tot_row('✓ PAGADA COMPLETAMENTE', f'${remaining:.2f}', bold=True, fill_c=green_bg, text_c=green_fg)
            else:
                draw_tot_row('SALDO PENDIENTE', f'${remaining:.2f}', bold=True, fill_c=HexColor('#fef9c3'), text_c=HexColor('#854d0e'))

        # ── NOTES ────────────────────────────────────────────────────────────────
        if notes:
            y -= 6 * MM
            c.setFillColor(light_gray)
            c.setStrokeColor(border_c)
            note_lines = []
            words = safe(notes).split()
            line_buf, line_chars = [], 0
            for word in words:
                if line_chars + len(word) + 1 > 85:
                    note_lines.append(' '.join(line_buf))
                    line_buf, line_chars = [word], len(word)
                else:
                    line_buf.append(word)
                    line_chars += len(word) + 1
            if line_buf:
                note_lines.append(' '.join(line_buf))
            note_bh = (len(note_lines) + 1) * 4.5 * MM + 4 * MM
            c.rect(ml, y - note_bh, uw, note_bh, fill=1, stroke=1)
            ty2 = y - 5 * MM
            c.setFont('Helvetica-Bold', 7)
            c.setFillColor(HexColor('#374151'))
            c.drawString(ml + 3 * MM, ty2, 'NOTAS:')
            ty2 -= 4.5 * MM
            c.setFont('Helvetica', 7.5)
            for ln in note_lines:
                c.drawString(ml + 3 * MM, ty2, ln)
                ty2 -= 4.5 * MM
            y -= note_bh + 4 * MM

        # ── PAYMENT INFO ─────────────────────────────────────────────────────────
        y -= 4 * MM
        pi_h = 22 * MM
        c.setFillColor(pay_bg)
        c.setStrokeColor(pay_bd)
        c.rect(ml, y - pi_h, uw, pi_h, fill=1, stroke=1)
        ty2 = y - 5 * MM
        c.setFillColor(green_fg)
        c.setFont('Helvetica-Bold', 6.5)
        c.drawString(ml + 3 * MM, ty2, 'INFORMACION PARA PAGO  \xb7  DIOGENES GONZALEZ')
        ty2 -= 5 * MM
        mid_x = ml + uw / 2
        c.setFillColor(HexColor('#6b7280'))
        c.setFont('Helvetica-Bold', 6)
        c.drawString(ml + 3 * MM, ty2, 'TRANSFERENCIA BANCARIA')
        c.drawString(mid_x + 3 * MM, ty2, 'YAPPY')
        ty2 -= 4 * MM
        c.setFillColor(HexColor('#374151'))
        c.setFont('Helvetica', 7.5)
        c.drawString(ml + 3 * MM, ty2, 'Banco General  \xb7  Cta. de ahorros')
        ty2 -= 4 * MM
        c.setFillColor(green_fg)
        c.setFont('Helvetica-Bold', 9)
        c.drawString(ml + 3 * MM, ty2, '04-72-98-543918-2')
        c.drawString(mid_x + 3 * MM, ty2 + 4 * MM, '6262-4077')
        c.setStrokeColor(pay_bd)
        c.line(mid_x, y - 6 * MM, mid_x, y - pi_h + 3 * MM)

        # ── FOOTER ───────────────────────────────────────────────────────────────
        fh = 12 * MM
        c.setFillColor(HexColor('#f1f5f9'))
        c.setStrokeColor(border_c)
        c.rect(0, 0, PW, fh, fill=1, stroke=0)
        c.line(0, fh, PW, fh)
        c.setFillColor(HexColor('#6b7280'))
        c.setFont('Helvetica', 6.5)
        c.drawCentredString(PW / 2, fh / 2 - 2,
                            f'{co_name}  \xb7  {co_address}  \xb7  RUC: {co_ruc}  \xb7  {label} N\xb0 {safe(num)}')

        c.save()
        return buf.getvalue()
    except Exception as e:
        logging.warning("reportlab PDF generation failed: %s", e)
        return None


def _html_to_pdf(html: str) -> Optional[bytes]:
    """Convert HTML string to PDF bytes using Playwright (headless Chromium)."""
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-setuid-sandbox"])
            page = browser.new_page()
            page.set_content(html, wait_until="domcontentloaded")
            pdf_bytes = page.pdf(format="A4", print_background=True)
            browser.close()
            return pdf_bytes
    except Exception as e:
        logging.warning("playwright PDF failed: %s", e)
    # Fallback: weasyprint
    try:
        from weasyprint import HTML, CSS
        import io as _io
        css = CSS(string="@page{size:A4;margin:0}body{margin:0;padding:0;font-family:Arial,sans-serif}*{box-sizing:border-box}")
        buf = _io.BytesIO()
        HTML(string=html).write_pdf(buf, stylesheets=[css])
        return buf.getvalue()
    except Exception as e2:
        logging.warning("weasyprint PDF failed: %s", e2)
        return None


def _logo_b64_tag() -> str:
    """Return <img> tag with base64-encoded logo for PDF embedding, or empty string if unavailable."""
    logo_data, _ = _load_logo()
    if logo_data:
        b64 = base64.b64encode(logo_data).decode()
        return f'<img src="data:image/png;base64,{b64}" width="52" height="52" alt="Logo" style="border-radius:6px;display:block;object-fit:contain" />'
    return ''


_PDF_CSS = """
  @page { size: A4; margin: 12mm 10mm; }
  body { margin: 0; padding: 0; font-family: Arial, sans-serif; font-size: 11pt; color: #111; }
  * { box-sizing: border-box; }
  div[style*="max-width:680"] { max-width: 100% !important; padding: 0 !important; }
  table { border-collapse: collapse; }
"""


def _wrap_html(body: str) -> str:
    return f'<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_PDF_CSS}</style></head><body>{body}</body></html>'


def _invoice_to_pdf(inv, db) -> Optional[bytes]:
    """Generate PDF for an invoice using the same HTML template as the email/frontend."""
    try:
        from routers.invoices import _build_invoice_email_html
        html_body = _build_invoice_email_html(inv, None, db, _logo=_logo_b64_tag() or None)
        return _html_to_pdf(_wrap_html(html_body))
    except Exception as e:
        logging.warning("_invoice_to_pdf failed: %s", e)
        return None


def _quote_to_pdf(q, db) -> Optional[bytes]:
    """Generate PDF for a quote using the same HTML template as the email/frontend."""
    try:
        from routers.quotes import _build_quote_email_html
        html_body = _build_quote_email_html(q, None, db, _logo=_logo_b64_tag() or None)
        return _html_to_pdf(_wrap_html(html_body))
    except Exception as e:
        logging.warning("_quote_to_pdf failed: %s", e)
        return None


def _generate_linked_doc_pdfs(ticket, db) -> list:
    """Return [(filename, bytes, 'application/pdf')] for non-draft invoices/quotes linked to the ticket."""
    result = []
    try:
        invoices = db.query(models.Invoice).filter(
            models.Invoice.ticket_id == ticket.id,
            models.Invoice.deleted_at.is_(None),
            models.Invoice.status != "Borrador",
        ).all()
        for inv in invoices:
            pdf = _invoice_to_pdf(inv, db)
            if not pdf:
                pdf = _make_doc_pdf(
                    'invoice', inv.invoice_number or f'#{inv.id}',
                    inv.client_name or '', inv.client_ruc or '',
                    inv.date, inv.items, inv.itbms_enabled, inv.notes or '', db,
                    client_address=inv.client_address or '',
                    client_email=inv.client_email or '',
                    client_phone=inv.client_phone or '',
                    payment_terms=inv.payment_terms or '',
                    due_date=inv.due_date,
                    payments=list(inv.payments) if inv.payments else [],
                )
            if pdf:
                result.append((f"{inv.invoice_number or f'Factura-{inv.id}'}.pdf", pdf, "application/pdf"))

        quotes = db.query(models.Quote).filter(
            models.Quote.ticket_id == ticket.id,
            models.Quote.deleted_at.is_(None),
            models.Quote.status != "Borrador",
        ).all()
        for q in quotes:
            pdf = _quote_to_pdf(q, db)
            if pdf:
                result.append((f"{q.quote_number or f'Cotizacion-{q.id}'}.pdf", pdf, "application/pdf"))
    except Exception as e:
        logging.warning("_generate_linked_doc_pdfs failed: %s", e)
    return result


def try_send_comment_email(ticket_id: int, comment_content: str, author_name: str, bcc_email: str = None, cc_email: str = None, attachment_ids: list = None, attach_invoice_pdfs: bool = True):
    """Notify the ticket client by email when a public comment is added. Silently fails."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        api_key = _get_setting(db, "brevo_api_key") or None
        host = _get_setting(db, "smtp_host")
        if not host and not api_key:
            return
        port = _get_setting(db, "smtp_port") or "587"
        user = _get_setting(db, "smtp_user")
        password = _get_setting(db, "smtp_password")
        from_addr = _get_setting(db, "smtp_from") or user
        use_tls = (_get_setting(db, "smtp_tls") or "true").lower() == "true"

        ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
        if not ticket or not ticket.client or not ticket.client.email:
            return
        client_email = ticket.client.email

        # Replace [img:N] with public URL or CID inline image
        content_html, inline_images = _resolve_inline_images(comment_content, ticket.id, db)
        content_html = content_html.replace("\n", "<br>")

        client_name = ticket.client.name or "Cliente"
        subject = f"[Ticket #{ticket.id}] Actualización de su ticket de servicio - {ticket.title}"
        body = _ticket_email_wrap(f"""
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#64748b">
      <strong style="color:#1d4ed8">Ticket #{ticket.id}</strong> &nbsp;·&nbsp; {ticket.title}
      &nbsp;·&nbsp; <strong>Agente:</strong> {author_name}
    </div>
    <p style="font-size:14px;color:#1e293b;margin:0 0 6px;font-weight:600">Estimado/a {client_name},</p>
    <p style="font-size:13px;color:#475569;margin:0 0 18px;line-height:1.6">
      Le informamos sobre las nuevas actualizaciones referentes a su ticket de servicio:
    </p>
    <div style="background:#f0f9ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:4px;font-size:13px;color:#1e293b;line-height:1.7">
      {content_html}
    </div>""", db)

        # Load non-inline file attachments requested by the caller
        file_attachments = []
        for att_id in (attachment_ids or []):
            att = db.query(models.TicketAttachment).filter(
                models.TicketAttachment.id == int(att_id),
                models.TicketAttachment.ticket_id == ticket.id,
            ).first()
            if att:
                file_path = os.path.join(upload_dir, str(ticket.id), att.filename)
                if os.path.exists(file_path):
                    with open(file_path, "rb") as f:
                        data = f.read()
                    file_attachments.append((att.original_name, data, att.content_type or "application/octet-stream"))

        # Auto-attach PDFs for linked non-draft invoices/quotes (only if requested)
        if attach_invoice_pdfs:
            file_attachments.extend(_generate_linked_doc_pdfs(ticket, db))

        effective_cc = cc_email or ticket.cc_email or None
        admin_bcc = _get_setting(db, "admin_notification_email") or None
        effective_bcc = _merge_bcc(bcc_email, admin_bcc)
        reply_to = _get_setting(db, "imap_user") or None
        logging.info("Sending comment email for ticket %s → to=%s cc=%s bcc=%s attachments=%d", ticket.id, client_email, effective_cc, effective_bcc, len(file_attachments))
        _send_with_logo(host, port, user, password, from_addr, use_tls,
                        client_email, subject, body, extra_images=inline_images, cc=effective_cc, bcc=effective_bcc,
                        reply_to=reply_to, api_key=api_key, file_attachments=file_attachments or None)
        logging.info("Comment email sent OK for ticket %s", ticket_id)
    except Exception as e:
        logging.exception("Email send failed for ticket %s: %s", ticket_id, e)
    finally:
        db.close()


def try_send_reschedule_email(ticket_id: int, scheduled_at, duration_minutes: int, location: str, subject_text: str, agent_name: str, bcc_email: str = None, is_reschedule: bool = False):
    """Notify the client when a visit is scheduled or rescheduled. Silently fails."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        cfg = _smtp_cfg(db)
        if not cfg:
            return
        ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
        if not ticket or not ticket.client or not ticket.client.email:
            return
        client_email = ticket.client.email
        client_name  = ticket.client.name or "Cliente"

        # Convert UTC datetime to Panama time (UTC-5)
        panama_tz = timezone(timedelta(hours=-5))
        local_dt = scheduled_at.astimezone(panama_tz) if scheduled_at.tzinfo else scheduled_at.replace(tzinfo=timezone.utc).astimezone(panama_tz)
        DAYS_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
        MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
        day_name = DAYS_ES[local_dt.weekday()]
        date_str = f"{day_name}, {local_dt.day} de {MONTHS_ES[local_dt.month - 1]} de {local_dt.year}"
        h = local_dt.hour
        ampm = "AM" if h < 12 else "PM"
        h12 = h % 12 or 12
        time_str = f"{h12}:{local_dt.strftime('%M')} {ampm}"
        end_dt = local_dt + timedelta(minutes=duration_minutes)
        eh = end_dt.hour
        eampm = "AM" if eh < 12 else "PM"
        eh12 = eh % 12 or 12
        end_str = f"{eh12}:{end_dt.strftime('%M')} {eampm}"

        location_block = f"""
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #f1f5f9">
      <div style="width:32px;text-align:center;font-size:16px">📍</div>
      <div><div style="font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:600">Ubicación</div>
      <div style="font-size:13px;font-weight:600;color:#1e293b">{location}</div></div>
    </div>""" if location and location.strip() else ""

        subject_block = f"""
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #f1f5f9">
      <div style="width:32px;text-align:center;font-size:16px">🔧</div>
      <div><div style="font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:600">Asunto</div>
      <div style="font-size:13px;font-weight:600;color:#1e293b">{subject_text}</div></div>
    </div>""" if subject_text and subject_text.strip() else ""

        body = _ticket_email_wrap(f"""
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#64748b">
      <strong style="color:#1d4ed8">Ticket #{ticket.id}</strong> &nbsp;·&nbsp; {ticket.title}
      &nbsp;·&nbsp; <strong>Agente:</strong> {agent_name}
    </div>
    <p style="font-size:14px;color:#1e293b;margin:0 0 6px;font-weight:600">Estimado/a {client_name},</p>
    <p style="font-size:13px;color:#475569;margin:0 0 18px;line-height:1.6">
      Le informamos que su visita de servicio técnico ha sido <strong>{'reagendada' if is_reschedule else 'confirmada'}</strong>.
    </p>
    <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:18px">
      <div style="background:#2563eb;padding:12px 16px;text-align:center;color:#fff;font-size:15px;font-weight:700">
        📅 &nbsp;{'Visita reagendada' if is_reschedule else 'Visita agendada'}
      </div>
      <div style="background:#fff;padding:4px 16px 8px">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0">
          <div style="width:32px;text-align:center;font-size:16px">🗓️</div>
          <div><div style="font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:600">Fecha</div>
          <div style="font-size:13px;font-weight:600;color:#1e293b">{date_str}</div></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #f1f5f9">
          <div style="width:32px;text-align:center;font-size:16px">🕐</div>
          <div><div style="font-size:10px;color:#9ca3af;text-transform:uppercase;font-weight:600">Hora</div>
          <div style="font-size:13px;font-weight:600;color:#1e293b">{time_str} → {end_str}</div></div>
        </div>{location_block}{subject_block}
      </div>
    </div>
    <p style="font-size:13px;color:#475569;margin:0;line-height:1.6">
      Si necesita reprogramar o tiene alguna consulta, no dude en contactarnos respondiendo a este correo.
    </p>""", db)

        action = "Visita reagendada" if is_reschedule else "Visita agendada"
        email_subject = f"[Ticket #{ticket.id}] {action}: {date_str} {time_str} — {ticket.title}"
        cc_email = getattr(ticket, "cc_email", None) or None
        admin_bcc = _get_setting(db, "admin_notification_email") or None
        reply_to = _get_setting(db, "imap_user") or None
        _send_with_logo(cfg["host"], cfg["port"], cfg["user"], cfg["password"], cfg["from_addr"], cfg["use_tls"],
                        client_email, email_subject, body, cc=cc_email, bcc=_merge_bcc(bcc_email, admin_bcc), reply_to=reply_to, api_key=cfg.get("api_key"))
    except Exception as e:
        logging.warning("Reschedule email failed for ticket %s: %s", ticket_id, e)
    finally:
        db.close()


def _imap_cfg(db: Session):
    host = _get_setting(db, "imap_host")
    if not host:
        return None
    return dict(
        host=host,
        port=int(_get_setting(db, "imap_port") or "993"),
        user=_get_setting(db, "imap_user"),
        password=_get_setting(db, "imap_password"),
        ssl=(_get_setting(db, "imap_ssl") or "true").lower() == "true",
        enabled=(_get_setting(db, "imap_enabled") or "false").lower() == "true",
        poll_interval=int(_get_setting(db, "imap_poll_interval") or "120"),
        create_tickets=(_get_setting(db, "imap_create_tickets") or "true").lower() == "true",
    )


def _decode_header_str(value: str) -> str:
    parts = _decode_email_header(value or "")
    result = []
    for fragment, enc in parts:
        if isinstance(fragment, bytes):
            result.append(fragment.decode(enc or "utf-8", errors="replace"))
        else:
            result.append(str(fragment))
    return "".join(result)


def _get_email_text(msg) -> str:
    """Extract the best plaintext body from a parsed email message."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and "attachment" not in str(part.get("Content-Disposition") or ""):
                charset = part.get_content_charset() or "utf-8"
                return part.get_payload(decode=True).decode(charset, errors="replace")
    else:
        charset = msg.get_content_charset() or "utf-8"
        return msg.get_payload(decode=True).decode(charset, errors="replace")
    return ""


def _strip_quoted(body: str) -> str:
    """Remove quoted reply lines and standard email separators."""
    lines = body.splitlines()
    clean = []
    for line in lines:
        s = line.strip()
        if s.startswith(">"):
            break
        if re.match(r"^[-_]{3,}$", s):
            break
        if re.match(r"^On .{5,} wrote:$", s, re.DOTALL):
            break
        if re.match(r"^(El|De|From|Le)\s*:", s, re.IGNORECASE):
            break
        clean.append(line)
    return "\n".join(clean).strip()


def _get_email_body_for_ticket(msg) -> str:
    """Like _get_email_text but falls back to tag-stripped HTML so HTML-only emails work."""
    plain = _get_email_text(msg)
    if plain.strip():
        return plain
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/html" and "attachment" not in str(part.get("Content-Disposition") or ""):
                charset = part.get_content_charset() or "utf-8"
                html = part.get_payload(decode=True).decode(charset, errors="replace")
                return re.sub(r"<[^>]+>", " ", html).strip()
    elif msg.get_content_type() == "text/html":
        charset = msg.get_content_charset() or "utf-8"
        html = msg.get_payload(decode=True).decode(charset, errors="replace")
        return re.sub(r"<[^>]+>", " ", html).strip()
    return ""


def _get_or_create_email_client(db, email: str, name: str) -> models.User:
    """Return existing user by email or create a new client user."""
    user = db.query(models.User).filter(models.User.email.ilike(email)).first()
    if user:
        return user
    import bcrypt, secrets
    rand_pw = secrets.token_urlsafe(16)
    hashed = bcrypt.hashpw(rand_pw.encode(), bcrypt.gensalt()).decode()
    user = models.User(
        name=name or email.split("@")[0],
        email=email.lower(),
        password_hash=hashed,
        role=models.UserRole.client,
        is_active=True,
    )
    db.add(user)
    db.flush()
    logging.info("IMAP: auto-created client user %s", email)
    return user


def poll_imap_replies() -> dict:
    """Connect to IMAP, find unseen ticket replies, and save them as timeline comments."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        cfg = _imap_cfg(db)
        if not cfg or not cfg["enabled"]:
            return {"processed": 0, "skipped": 0}

        if cfg["ssl"]:
            M = imaplib.IMAP4_SSL(cfg["host"], cfg["port"])
        else:
            M = imaplib.IMAP4(cfg["host"], cfg["port"])
            M.starttls()  # B51: upgrade to TLS even without implicit SSL
        M.login(cfg["user"], cfg["password"])
        M.select("INBOX")

        _, data = M.search(None, "UNSEEN")
        msg_nums = data[0].split()
        processed = skipped = 0

        for num in msg_nums:
            try:
                _, raw_data = M.fetch(num, "(RFC822)")
                raw = raw_data[0][1]
                msg = _email_lib.message_from_bytes(raw)

                subject = _decode_header_str(msg.get("Subject", ""))
                from_raw = msg.get("From", "")
                email_match = re.search(r"[\w.+\-]+@[\w.\-]+\.\w+", from_raw)
                if not email_match:
                    M.store(num, "+FLAGS", "\\Seen")
                    skipped += 1
                    continue
                from_email = email_match.group(0).lower()

                ticket_match = re.search(r"\[Ticket #(\d+)\]", subject, re.IGNORECASE)

                if ticket_match:
                    # ── Existing flow: add reply as comment on existing ticket ──
                    ticket_id = int(ticket_match.group(1))

                    body = _get_email_text(msg)
                    content = _strip_quoted(body)
                    if not content:
                        M.store(num, "+FLAGS", "\\Seen")
                        skipped += 1
                        continue

                    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
                    if not ticket:
                        M.store(num, "+FLAGS", "\\Seen")
                        skipped += 1
                        continue

                    sender = db.query(models.User).filter(
                        models.User.email.ilike(from_email),
                        models.User.is_active == True,
                    ).first()
                    if not sender:
                        M.store(num, "+FLAGS", "\\Seen")
                        skipped += 1
                        continue

                    entry = models.TicketTimeline(
                        ticket_id=ticket_id,
                        user_id=sender.id,
                        content=content,
                        entry_type="comment",
                        is_internal=False,
                    )
                    db.add(entry)
                    db.commit()
                    M.store(num, "+FLAGS", "\\Seen")
                    processed += 1
                    logging.info("IMAP: saved reply from %s on ticket #%s", from_email, ticket_id)

                elif cfg.get("create_tickets", True):
                    # ── New flow: create ticket from new email ──

                    # Skip emails sent by the IMAP account itself
                    imap_user = (cfg.get("user") or "").lower()
                    if from_email == imap_user:
                        M.store(num, "+FLAGS", "\\Seen")
                        skipped += 1
                        continue

                    body = _get_email_body_for_ticket(msg)
                    if not body.strip():
                        M.store(num, "+FLAGS", "\\Seen")
                        skipped += 1
                        continue

                    name_match = re.match(r'^"?(.+?)"?\s*<', from_raw)
                    sender_name = name_match.group(1).strip() if name_match else from_email.split("@")[0]

                    client = _get_or_create_email_client(db, from_email, sender_name)

                    from business_hours import add_business_minutes, SLA_MINUTES, PAUSE_STATUSES
                    from datetime import datetime as _dt

                    default_status = db.query(models.TicketStatus).order_by(models.TicketStatus.id).first()
                    if not default_status:
                        M.store(num, "+FLAGS", "\\Seen")
                        skipped += 1
                        continue

                    title = (subject or f"Correo de {sender_name}").strip()[:200]
                    now = _dt.utcnow()
                    ticket = models.Ticket(
                        title=title,
                        description=body.strip(),
                        priority="medium",
                        status_id=default_status.id,
                        client_id=client.id,
                    )
                    db.add(ticket)
                    db.flush()

                    sla_min = int(_get_setting(db, "sla_medium") or SLA_MINUTES.get("medium", 1620))
                    if default_status.name in PAUSE_STATUSES:
                        ticket.sla_paused_at = now
                        ticket.sla_elapsed_minutes = 0
                    else:
                        ticket.sla_deadline = add_business_minutes(now, sla_min)
                        ticket.sla_last_resume = now
                        ticket.sla_elapsed_minutes = 0

                    entry = models.TicketTimeline(
                        ticket_id=ticket.id,
                        user_id=client.id,
                        content=f"Ticket creado automáticamente desde correo de: {from_email}",
                        entry_type="system",
                    )
                    db.add(entry)
                    db.commit()
                    db.refresh(ticket)

                    try_send_ticket_open_email(ticket.id)
                    M.store(num, "+FLAGS", "\\Seen")
                    processed += 1
                    logging.info("IMAP: created ticket #%s from email %s", ticket.id, from_email)

                else:
                    M.store(num, "+FLAGS", "\\Seen")
                    skipped += 1

            except Exception as e:
                logging.warning("IMAP: error processing message %s: %s", num, e)
                skipped += 1

        M.close()
        M.logout()
        return {"processed": processed, "skipped": skipped}

    except Exception as e:
        logging.warning("IMAP poll failed: %s", e)
        return {"processed": 0, "skipped": 0, "error": str(e)}
    finally:
        db.close()


@router.get("/format")
def get_format_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return {
        "tz":          _get_setting(db, "fmt_tz")          or "America/Panama",
        "date_format": _get_setting(db, "fmt_date_format") or "dd/MM/yyyy",
        "time_format": _get_setting(db, "fmt_time_format") or "12h",
    }


@router.put("/format")
def save_format_settings(
    data: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
        raise HTTPException(status_code=403, detail="Solo administradores")
    mapping = {"tz": "fmt_tz", "date_format": "fmt_date_format", "time_format": "fmt_time_format"}
    for field, key in mapping.items():
        if field in data and data[field]:
            _set_setting(db, key, str(data[field]))
    db.commit()
    return {"ok": True}


@router.get("/imap")
def get_imap_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
        raise HTTPException(status_code=403)
    result = {key: _get_setting(db, key) for key in IMAP_KEYS}
    if result.get("imap_password"):
        result["imap_password"] = "••••••••"
    return result


@router.put("/imap")
def save_imap_settings(
    data: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
        raise HTTPException(status_code=403)
    for key in IMAP_KEYS:
        if key in data:
            if key == "imap_password" and data[key] == "••••••••":
                continue
            _set_setting(db, key, str(data[key]))
    db.commit()
    return {"ok": True}


@router.post("/imap/poll")
def trigger_imap_poll(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
        raise HTTPException(status_code=403)
    result = poll_imap_replies()
    return result


@router.get("/smtp")
def get_smtp_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
        raise HTTPException(status_code=403)
    result = {key: _get_setting(db, key) for key in SMTP_KEYS}
    for secret_key in ("smtp_password", "brevo_api_key"):
        if result.get(secret_key):
            result[secret_key] = "••••••••"
    return result


@router.put("/smtp")
def save_smtp_settings(
    data: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
        raise HTTPException(status_code=403)
    for key in SMTP_KEYS:
        if key in data:
            if key in ("smtp_password", "brevo_api_key") and data[key] == "••••••••":
                continue
            _set_setting(db, key, str(data[key]))
    db.commit()
    return {"ok": True}


import json as _json

_DEFAULT_ROLE_FEATURES = {
    "agent":    {"dashboard_servicios": True, "dashboard_ventas": True, "tickets": True, "agenda": True, "contacts": True, "quotes": True, "pedidos": True, "facturas": True, "warranties": True, "gastos": True, "cartas": True, "knowledge_base": True, "reports": True, "contratos": True, "impresoras": True, "suministros": True, "inventario": True},
    "supervisor": {"dashboard_servicios": True, "dashboard_ventas": True, "tickets": True, "agenda": True, "contacts": True, "suppliers": True, "quotes": True, "pedidos": True, "facturas": True, "warranties": True, "gastos": True, "cartas": True, "knowledge_base": True, "reports": True, "contratos": True, "impresoras": True, "suministros": True, "inventario": True},
    "ventas":   {"dashboard_ventas": True, "suppliers": True, "quotes": True, "pedidos": True, "facturas": True},
    "supplies": {"tickets": True, "suministros": True, "inventario": True, "impresoras": True, "contratos": True, "reports": True},
    "client":   {"tickets": True, "agenda": True, "mis_documentos": True, "contacts": True, "knowledge_base": True},
}


@router.get("/role-features")
def get_role_features(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    val = _get_setting(db, "role_features")
    if val:
        try:
            stored = _json.loads(val)
            # Merge: new keys in _DEFAULT_ROLE_FEATURES that aren't in the stored
            # value yet (added after last save) inherit their default.
            merged = {}
            for role, defaults in _DEFAULT_ROLE_FEATURES.items():
                stored_role = stored.get(role, {})
                merged[role] = {**defaults, **stored_role}
            # Preserve any extra roles saved in DB
            for role in stored:
                if role not in merged:
                    merged[role] = stored[role]
            return merged
        except Exception:
            pass
    return _DEFAULT_ROLE_FEATURES


@router.put("/role-features")
def save_role_features(data: dict = Body(...), db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
        raise HTTPException(status_code=403)
    _set_setting(db, "role_features", _json.dumps(data))
    db.commit()
    return {"ok": True}


@router.post("/smtp/test")
def test_smtp_settings(
    data: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
        raise HTTPException(status_code=403)

    api_key = data.get("brevo_api_key") or _get_setting(db, "brevo_api_key") or None
    host = data.get("smtp_host") or _get_setting(db, "smtp_host")
    port = data.get("smtp_port") or _get_setting(db, "smtp_port") or "587"
    user = data.get("smtp_user") or _get_setting(db, "smtp_user")
    password = data.get("smtp_password")
    if not password or password == "••••••••":
        password = _get_setting(db, "smtp_password")
    from_addr = data.get("smtp_from") or _get_setting(db, "smtp_from") or user
    use_tls = str(data.get("smtp_tls") or _get_setting(db, "smtp_tls") or "true").lower() == "true"
    to_email = data.get("to") or current_user.email

    if not host and not api_key:
        raise HTTPException(status_code=400, detail="Configure el servidor SMTP o la API key de Brevo")

    try:
        if api_key:
            _send_via_brevo_api(
                api_key, from_addr, to_email,
                "Prueba Brevo — Service Desk",
                "<p>Este es un mensaje de prueba desde <strong>Service Desk</strong>. "
                "La configuración de Brevo funciona correctamente.</p>",
            )
        else:
            _send_email(
                host, port, user, password, from_addr, use_tls, to_email,
                "Prueba SMTP — Service Desk",
                "<p>Este es un mensaje de prueba desde <strong>Service Desk</strong>. "
                "La configuración SMTP funciona correctamente.</p>",
            )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


COMPANY_KEYS = [
    "company_name", "company_address", "company_ruc", "company_phone", "company_email",
    "company_sidebar_color", "company_accent_color", "company_app_name",
]
COMPANY_DEFAULTS = {
    "company_name":          "Service Desk",
    "company_address":       "",
    "company_ruc":           "",
    "company_phone":         "",
    "company_email":         "",
    "company_sidebar_color": "#1a3353",
    "company_accent_color":  "#3b82f6",
    "company_app_name":      "",
}


@router.get("/company")
def get_company_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    data = {k: _get_setting(db, k) or COMPANY_DEFAULTS.get(k, "") for k in COMPANY_KEYS}
    data["has_logo"]     = bool(_get_setting(db, "company_logo_b64"))
    data["has_favicon"]  = bool(_get_setting(db, "company_favicon_b64"))
    data["has_pwa_icon"] = bool(_get_setting(db, "company_pwa_icon_b64"))
    # Vertical de producto por instancia: 'mps' (impresión, default) | 'it_support'
    # (soporte IT general → el frontend generaliza "Impresoras/Flota" a "Equipos").
    data["vertical"] = os.getenv("PRODUCT_VERTICAL", "mps")
    return data


@router.put("/company")
def save_company_settings(
    data: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
        raise HTTPException(status_code=403, detail="Solo administradores")
    for key in COMPANY_KEYS:
        if key in data:
            _set_setting(db, key, str(data[key]))
    db.commit()
    return {"ok": True}


@router.get("/public-info")
def get_public_company_info(db: Session = Depends(get_db)):
    name = _get_setting(db, "company_name") or COMPANY_DEFAULTS.get("company_name", "")
    has_logo = bool(_get_setting(db, "company_logo_b64"))
    sidebar_color = _get_setting(db, "company_sidebar_color") or COMPANY_DEFAULTS.get("company_sidebar_color", "#1a3353")
    app_name = _get_setting(db, "company_app_name") or COMPANY_DEFAULTS.get("company_app_name", "")
    # Módulos habilitados → el login muestra solo las tarjetas activas.
    try:
        from routers.system import _get_modules
        modules = _get_modules(db)
    except Exception:
        modules = {}
    return {"company_name": name, "company_app_name": app_name, "company_sidebar_color": sidebar_color, "has_logo": has_logo, "modules": modules}


@router.get("/logo")
def get_company_logo(db: Session = Depends(get_db)):
    import base64 as _b64
    from fastapi.responses import Response as _Response
    b64 = _get_setting(db, "company_logo_b64")
    if not b64:
        raise HTTPException(status_code=404, detail="No logo")
    data = _b64.b64decode(b64)
    mime = "image/png"
    if data[:2] == b'\xff\xd8':
        mime = "image/jpeg"
    elif len(data) > 11 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        mime = "image/webp"
    return _Response(content=data, media_type=mime, headers={"Cache-Control": "public, max-age=3600"})


@router.post("/logo")
async def upload_logo(
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    import base64
    if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
        raise HTTPException(status_code=403, detail="Solo administradores")
    body = await request.body()
    if len(body) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Logo demasiado grande (máx 2 MB)")
    b64 = base64.b64encode(body).decode()
    _set_setting(db, "company_logo_b64", b64)
    db.commit()
    return {"ok": True}


@router.delete("/logo")
def delete_logo(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
        raise HTTPException(status_code=403, detail="Solo administradores")
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "company_logo_b64").first()
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


def _squareify(data: bytes, mime: str, size: int = 512) -> tuple[bytes, str]:
    """Pad a raster image onto a square transparent canvas at `size`x`size`.
    macOS (Safari 'Agregar al Dock' y Chrome 'Instalar app') valida que el ícono
    realmente tenga las dimensiones cuadradas que el manifest declara (192x192/512x512);
    si el logo subido no es cuadrado, lo descarta en silencio y usa un ícono genérico."""
    if mime not in ("image/png", "image/jpeg", "image/webp"):
        return data, mime
    from io import BytesIO
    from PIL import Image
    im = Image.open(BytesIO(data)).convert("RGBA")
    if im.width != im.height:
        side = max(im.width, im.height)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
        im = canvas
    if im.width != size:
        im = im.resize((size, size), Image.LANCZOS)
    buf = BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue(), "image/png"


def _asset_endpoint(setting_key: str, max_bytes: int, label: str, fallback_setting: str = None, fallback_file: str = None, squareify: bool = False):
    """Factory that returns (get_fn, post_fn, delete_fn) for a binary-asset AppSetting.
    fallback_setting: si no hay asset propio, usa el de otra clave (ej. el favicon cae
    al logo de la empresa → concuerdan sin subir dos imágenes).
    fallback_file: último recurso, sirve un archivo de dist/public (en vez de 404) —
    así index.html puede apuntar al endpoint y el primer render ya muestra algo.
    squareify: fuerza el ícono a un lienzo cuadrado (ver _squareify) — usado por
    favicon/pwa-icon, NO por /logo (que debe mantenerse rectangular tal cual se subió)."""
    def _get(db: Session = Depends(get_db)):
        import base64 as _b64, os as _os
        from fastapi.responses import Response as _Response, FileResponse as _FileResponse
        b64 = _get_setting(db, setting_key)
        if not b64 and fallback_setting:
            b64 = _get_setting(db, fallback_setting)
        if not b64:
            if fallback_file:
                base = _os.path.normpath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", ".."))
                for rel in (_os.path.join("frontend", "dist", fallback_file),
                            _os.path.join("frontend", "public", fallback_file)):
                    p = _os.path.join(base, rel)
                    if _os.path.exists(p):
                        return _FileResponse(p, headers={"Cache-Control": "public, max-age=300"})
            raise HTTPException(status_code=404, detail=f"No hay {label}")
        data = _b64.b64decode(b64)
        if data[:4] == b'\x89PNG': mime = "image/png"
        elif data[:2] == b'\xff\xd8': mime = "image/jpeg"
        elif len(data) > 11 and data[:4] == b'RIFF' and data[8:12] == b'WEBP': mime = "image/webp"
        elif data[:4] == b'\x00\x00\x01\x00': mime = "image/x-icon"
        elif data[:4] == b'<svg' or data[:5] == b'<?xml': mime = "image/svg+xml"
        else: mime = "image/png"
        if squareify:
            data, mime = _squareify(data, mime)
        return _Response(content=data, media_type=mime, headers={"Cache-Control": "public, max-age=3600"})

    async def _post(request: Request, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
        import base64
        if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
            raise HTTPException(status_code=403, detail="Solo administradores")
        body = await request.body()
        if len(body) > max_bytes:
            raise HTTPException(status_code=413, detail=f"{label} demasiado grande (máx {max_bytes // (1024*1024)} MB)")
        _set_setting(db, setting_key, base64.b64encode(body).decode())
        db.commit()
        return {"ok": True}

    def _delete(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
        if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
            raise HTTPException(status_code=403, detail="Solo administradores")
        row = db.query(models.AppSetting).filter(models.AppSetting.key == setting_key).first()
        if row:
            db.delete(row)
            db.commit()
        return {"ok": True}

    return _get, _post, _delete


_get_favicon, _post_favicon, _del_favicon = _asset_endpoint("company_favicon_b64",  1 * 1024 * 1024, "Favicon", fallback_setting="company_logo_b64", fallback_file="default-icon.png", squareify=True)
_get_pwa,     _post_pwa,     _del_pwa     = _asset_endpoint("company_pwa_icon_b64", 2 * 1024 * 1024, "Ícono PWA", fallback_setting="company_logo_b64", squareify=True)

router.add_api_route("/favicon",  _get_favicon,  methods=["GET"])
router.add_api_route("/favicon",  _post_favicon, methods=["POST"])
router.add_api_route("/favicon",  _del_favicon,  methods=["DELETE"])
router.add_api_route("/pwa-icon", _get_pwa,      methods=["GET"])
router.add_api_route("/pwa-icon", _post_pwa,     methods=["POST"])
router.add_api_route("/pwa-icon", _del_pwa,      methods=["DELETE"])


# SLA defaults (business minutes per priority)
SLA_KEYS = ["sla_critical", "sla_high", "sla_medium", "sla_low"]
SLA_DEFAULTS = {"sla_critical": "240", "sla_high": "540", "sla_medium": "1620", "sla_low": "2700"}


@router.get("/sla")
def get_sla_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return {k: int(_get_setting(db, k) or SLA_DEFAULTS[k]) for k in SLA_KEYS}


@router.put("/sla")
def save_sla_settings(
    data: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in (models.UserRole.admin, models.UserRole.superadmin):
        raise HTTPException(status_code=403, detail="Solo administradores")
    for key in SLA_KEYS:
        if key in data:
            minutes = max(1, int(data[key]))
            _set_setting(db, key, str(minutes))
    db.commit()
    return {"ok": True}
