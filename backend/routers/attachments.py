from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from typing import List
import os, uuid, re, aiofiles, base64, urllib.request, json
from database import get_db
import models, schemas, storage
from auth import get_current_user

_FD_DOMAIN  = os.getenv("FRESHDESK_DOMAIN", "")
_FD_API_KEY = os.getenv("FRESHDESK_API_KEY")  # B46: no hardcoded default


def _fd_get_attachment_url(fd_conversation_id: int, fd_attachment_index: int) -> str:
    """Fetch fresh pre-signed S3 URL for a Freshdesk attachment."""
    auth = base64.b64encode(f"{_FD_API_KEY}:X".encode()).decode()
    url = f"https://{_FD_DOMAIN}/api/v2/conversations/{fd_conversation_id}"
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {auth}"})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read())
    attachments = data.get("attachments") or []
    if fd_attachment_index >= len(attachments):
        raise HTTPException(status_code=404, detail="Adjunto no encontrado en Freshdesk")
    return attachments[fd_attachment_index]["attachment_url"]

_SAFE_FNAME = re.compile(r'^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+$')

router = APIRouter(prefix="/api/tickets", tags=["attachments"])

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

# B47: whitelist of allowed extensions (must pair with ALLOWED_TYPES)
ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    ".pdf",
    ".doc", ".docx",
    ".xls", ".xlsx",
    ".txt", ".csv",
    ".zip",
}


def _safe_cd_filename(name: str) -> str:
    """B48: return sanitized Content-Disposition header value."""
    safe = re.sub(r'["\r\n\\]', '_', name or "archivo")
    return f'attachment; filename="{safe}"'


@router.post("/{ticket_id}/attachments", response_model=schemas.AttachmentOut)
async def upload_attachment(
    ticket_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    if current_user.role == models.UserRole.client and ticket.client_id != current_user.id:
        raise HTTPException(status_code=403)

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de archivo no permitido")

    # B47: validate extension, not just Content-Type (client can spoof Content-Type)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Extensión de archivo no permitida")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="El archivo excede 20MB")

    stored_name = f"{uuid.uuid4()}{ext}"
    storage_key = f"{ticket_id}/{stored_name}"
    storage.save_file(storage_key, content, file.content_type)

    # B53: clean up file if DB commit fails
    try:
        attachment = models.TicketAttachment(
            ticket_id=ticket_id,
            filename=stored_name,
            original_name=file.filename or stored_name,
            file_size=len(content),
            content_type=file.content_type,
            uploaded_by_id=current_user.id,
        )
        db.add(attachment)

        entry = models.TicketTimeline(
            ticket_id=ticket_id,
            user_id=current_user.id,
            content=f"Archivo adjunto: {file.filename}",
            entry_type="attachment",
        )
        db.add(entry)
        db.commit()
        db.refresh(attachment)
        return attachment
    except Exception:
        db.rollback()
        storage.delete_file(storage_key)
        raise HTTPException(status_code=500, detail="Error guardando adjunto")


@router.get("/{ticket_id}/attachments", response_model=List[schemas.AttachmentOut])
def list_attachments(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")
    if current_user.role == models.UserRole.client:
        from routers.tickets import _client_can_access_ticket
        if not _client_can_access_ticket(ticket, current_user, db):
            raise HTTPException(status_code=403)
    return db.query(models.TicketAttachment).filter(
        models.TicketAttachment.ticket_id == ticket_id
    ).all()


@router.get("/{ticket_id}/attachments/{attachment_id}/download")
def download_attachment(
    ticket_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    att = db.query(models.TicketAttachment).filter(
        models.TicketAttachment.id == attachment_id,
        models.TicketAttachment.ticket_id == ticket_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    if current_user.role == models.UserRole.client:
        ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
        if not ticket or ticket.client_id != current_user.id:
            raise HTTPException(status_code=403)

    # Adjuntos importados desde Freshdesk: stream through backend.
    # A 302 redirect fails because fetch() forwards our Authorization header to S3,
    # and S3 rejects requests that carry both a pre-signed signature and an Authorization header.
    if att.fd_conversation_id is not None:
        try:
            fresh_url = _fd_get_attachment_url(att.fd_conversation_id, att.fd_attachment_index or 0)
            with urllib.request.urlopen(fresh_url, timeout=30) as resp:
                content = resp.read()
                content_type = resp.headers.get("Content-Type", "application/octet-stream")
            fname = att.original_name or "archivo"
            return Response(
                content=content,
                media_type=content_type,
                headers={"Content-Disposition": _safe_cd_filename(fname)},
            )
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=502, detail="No se pudo recuperar el adjunto de Freshdesk")

    # Defense in depth: filename is server-generated (uuid4+ext) but this guards
    # against path traversal in case a record was ever created with a bad value.
    if not att.filename or not _SAFE_FNAME.match(att.filename):
        raise HTTPException(status_code=404)
    storage_key = f"{ticket_id}/{att.filename}"
    if not storage.file_exists(storage_key):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    return Response(
        content=storage.read_file(storage_key),
        media_type=att.content_type or "application/octet-stream",
        headers={"Content-Disposition": _safe_cd_filename(att.original_name or att.filename)},
    )


@router.delete("/{ticket_id}/attachments/{attachment_id}")
def delete_attachment(
    ticket_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    att = db.query(models.TicketAttachment).filter(
        models.TicketAttachment.id == attachment_id,
        models.TicketAttachment.ticket_id == ticket_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    if current_user.role == models.UserRole.client and att.uploaded_by_id != current_user.id:
        raise HTTPException(status_code=403)

    if att.filename:
        storage.delete_file(f"{ticket_id}/{att.filename}")

    db.delete(att)
    db.commit()
    return {"ok": True}
