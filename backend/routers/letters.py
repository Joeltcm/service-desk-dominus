from datetime import date as _date
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
import models, schemas
from database import get_db
from auth import require_agent_or_admin
from routers.settings import _get_setting, _smtp_cfg, _send_with_logo

router = APIRouter(prefix="/api/letters", tags=["letters"])

MONTHS_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def _next_letter_number(db: Session) -> str:
    last = (
        db.query(models.Letter)
        .filter(models.Letter.letter_number.isnot(None))
        .filter(models.Letter.letter_number.like("CARTA-%"))
        .order_by(models.Letter.id.desc())
        .first()
    )
    if last and last.letter_number:
        try:
            n = int(last.letter_number.split("-")[1]) + 1
        except Exception:
            # Malformed existing number (doesn't match CARTA-XXXX) silently restarts
            # the count at 1 instead of failing, which can produce a duplicate number.
            n = 1
    else:
        n = 1
    return f"CARTA-{n:04d}"


@router.get("/next-number")
def get_next_number(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    return {"number": _next_letter_number(db)}


@router.get("", response_model=list[schemas.LetterOut])
def list_letters(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    return db.query(models.Letter).order_by(models.Letter.created_at.desc()).all()


@router.get("/{lid}", response_model=schemas.LetterOut)
def get_letter(
    lid: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    letter = db.query(models.Letter).filter(models.Letter.id == lid).first()
    if not letter:
        raise HTTPException(status_code=404, detail="Carta no encontrada")
    return letter


def _apply_data(letter: models.Letter, data: schemas.LetterCreate):
    for field in [
        "letter_number", "letter_type", "status",
        "recipient_name", "recipient_company", "recipient_ruc",
        "recipient_address", "recipient_email",
        "subject", "body", "attention_to",
        "signer_name", "signer_title", "notes",
    ]:
        val = getattr(data, field, None)
        setattr(letter, field, val or None)
    if data.date:
        try:
            letter.date = _date.fromisoformat(data.date)
        except Exception:
            pass
    else:
        letter.date = None


@router.post("", response_model=schemas.LetterOut, status_code=201)
def create_letter(
    data: schemas.LetterCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    letter = models.Letter(
        status="Borrador",
        created_by_id=current_user.id,
        date=_date.today(),
    )
    if not data.letter_number:
        letter_num = _next_letter_number(db)
        if db.query(models.Letter.id).filter(models.Letter.letter_number == letter_num).first():
            letter_num = _next_letter_number(db)
        data.letter_number = letter_num
    _apply_data(letter, data)
    db.add(letter)
    db.commit()
    db.refresh(letter)
    return letter


@router.put("/{lid}", response_model=schemas.LetterOut)
def update_letter(
    lid: int,
    data: schemas.LetterCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    letter = db.query(models.Letter).filter(models.Letter.id == lid).first()
    if not letter:
        raise HTTPException(status_code=404, detail="Carta no encontrada")
    _apply_data(letter, data)
    db.commit()
    db.refresh(letter)
    return letter


@router.delete("/{lid}", status_code=204)
def delete_letter(
    lid: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    letter = db.query(models.Letter).filter(models.Letter.id == lid).first()
    if not letter:
        raise HTTPException(status_code=404, detail="Carta no encontrada")
    db.delete(letter)
    db.commit()


@router.post("/{lid}/send-email")
def send_letter_email(
    lid: int,
    data: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    letter = db.query(models.Letter).filter(models.Letter.id == lid).first()
    if not letter:
        raise HTTPException(status_code=404, detail="Carta no encontrada")

    to_email = data.get("email") or letter.recipient_email
    if not to_email:
        raise HTTPException(status_code=400, detail="No hay dirección de correo")

    cfg = _smtp_cfg(db)
    if not cfg:
        raise HTTPException(status_code=400, detail="SMTP no configurado. Configúralo en Ajustes → Email.")

    co_name = _get_setting(db, "company_name") or "DG Solutions"
    co_address = _get_setting(db, "company_address") or "Panamá"
    co_ruc = _get_setting(db, "company_ruc") or ""
    co_phone = _get_setting(db, "company_phone") or ""
    co_email = _get_setting(db, "company_email") or ""

    html = _build_letter_email_html(letter, co_name, co_address, co_ruc, co_phone, co_email)
    subject = data.get("subject") or f"Carta: {letter.subject or letter.letter_number or 'Comunicado'}"

    try:
        _send_with_logo(
            cfg["host"], cfg["port"], cfg["user"], cfg["password"],
            cfg["from_addr"], cfg["use_tls"],
            to=to_email,
            subject=subject,
            html=html,
        )
        letter.status = "Enviada"
        db.commit()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error enviando correo: {exc}")

    return {"ok": True}


def _esc(s):
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _build_letter_email_html(letter, co_name, co_address, co_ruc, co_phone, co_email):
    date_str = ""
    if letter.date:
        d = letter.date
        date_str = f"{d.day} de {MONTHS_ES[d.month - 1]} de {d.year}"

    recipient_block = ""
    if letter.recipient_name or letter.recipient_company:
        recipient_block = (
            "<div style='margin-bottom:20px'>"
            + (f"<div style='font-weight:600;font-size:13px'>{_esc(letter.recipient_name)}</div>" if letter.recipient_name else "")
            + (f"<div style='font-size:12px;color:#374151'>{_esc(letter.recipient_company)}</div>" if letter.recipient_company else "")
            + (f"<div style='font-size:12px;color:#374151'>{_esc(letter.recipient_address)}</div>" if letter.recipient_address else "")
            + "</div>"
        )

    attention_line = (
        f"<div style='font-size:12px;margin-bottom:12px'>Att. <strong>{_esc(letter.attention_to)}</strong></div>"
        if letter.attention_to else ""
    )

    subject_line = (
        f"<div style='font-weight:700;font-size:14px;margin-bottom:16px;text-decoration:underline'>Asunto: {_esc(letter.subject)}</div>"
        if letter.subject else ""
    )

    body_html = _esc(letter.body or "").replace("\n", "<br>")

    signer_block = ""
    if letter.signer_name or co_name:
        signer_block = (
            "<div style='margin-top:30px'>"
            "<div style='font-size:12px;color:#6b7280'>Atentamente,</div>"
            "<div style='margin-top:20px'>"
            f"<div style='font-weight:600;font-size:13px'>{_esc(letter.signer_name or co_name)}</div>"
            + (f"<div style='font-size:11px;color:#6b7280'>{_esc(letter.signer_title)}</div>" if letter.signer_title else "")
            + f"<div style='font-size:11px;color:#6b7280'>{_esc(co_name)}</div>"
            "</div></div>"
        )

    footer_parts = [_esc(co_name)]
    if co_ruc:
        footer_parts.append(f"RUC: {_esc(co_ruc)}")
    if co_phone:
        footer_parts.append(f"Tel: {_esc(co_phone)}")
    if co_email:
        footer_parts.append(_esc(co_email))
    footer = " · ".join(footer_parts)

    header_sub = _esc(co_address)
    if co_ruc:
        header_sub += f" · RUC: {_esc(co_ruc)}"

    return f"""<div style="font-family:Arial,sans-serif;max-width:650px;margin:0 auto;color:#111">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e3a5f;border-radius:10px 10px 0 0;border-collapse:collapse">
    <tr>
      <td style="padding:14px 12px 14px 20px;width:60px;vertical-align:middle">
        <img src="cid:img_logo" width="52" height="52" alt="{_esc(co_name)}" style="border-radius:8px;display:block;background:#fff;padding:3px"/>
      </td>
      <td style="padding:14px 20px 14px 8px;vertical-align:middle">
        <div style="color:#fff;font-size:18px;font-weight:700;line-height:1.2">{_esc(co_name)}</div>
        <div style="color:#93c5fd;font-size:11px;margin-top:3px">{header_sub}</div>
      </td>
    </tr>
  </table>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:28px 32px;background:#fff">
    <div style="text-align:right;font-size:12px;color:#6b7280;margin-bottom:20px">{_esc(date_str)}</div>
    {recipient_block}
    {attention_line}
    {subject_line}
    <div style="font-size:13px;line-height:1.8;color:#1f2937">{body_html}</div>
    {signer_block}
    <div style="margin-top:30px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;text-align:center">{footer}</div>
  </div>
</div>"""
