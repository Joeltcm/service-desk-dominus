from datetime import date as _date
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
import models, schemas
from database import get_db
from auth import require_agent_or_admin
from routers.settings import _get_setting, _smtp_cfg, _send_with_logo

router = APIRouter(prefix="/api/licenses", tags=["licenses"])

MONTHS_ES = ["enero","febrero","marzo","abril","mayo","junio",
             "julio","agosto","septiembre","octubre","noviembre","diciembre"]


def _next_number(db: Session) -> str:
    last = (
        db.query(models.SoftwareLicense)
        .filter(models.SoftwareLicense.license_number.like("LIC-%"))
        .order_by(models.SoftwareLicense.id.desc())
        .first()
    )
    if last and last.license_number:
        try:
            n = int(last.license_number.split("-")[1]) + 1
        except Exception:
            n = 1
    else:
        n = 1
    return f"LIC-{n:04d}"


def _fmt_date(d) -> str:
    if not d:
        return ""
    try:
        if isinstance(d, str):
            from datetime import date
            d = date.fromisoformat(d)
        return f"{d.day} de {MONTHS_ES[d.month - 1]} de {d.year}"
    except Exception:
        return str(d)


def _esc(s):
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _build_license_html(lic, co: dict, origin: str) -> str:
    co_name    = co.get("company_name")    or "DG Solutions"
    co_address = co.get("company_address") or "Panamá"
    co_ruc     = co.get("company_ruc")     or ""
    co_phone   = co.get("company_phone")   or ""
    co_email   = co.get("company_email")   or ""

    footer_parts = [_esc(co_name)]
    if co_ruc:   footer_parts.append(f"RUC: {_esc(co_ruc)}")
    if co_phone: footer_parts.append(f"Tel: {_esc(co_phone)}")
    if co_email: footer_parts.append(_esc(co_email))

    # Rows helper
    def row(label, value, mono=False):
        if not value:
            return ""
        style = "font-family:monospace;font-size:11pt;letter-spacing:0.5px;color:#1a1a1a;" if mono else ""
        return f"""<tr>
          <td style="padding:8px 12px 8px 0;color:#555;font-size:9.5pt;white-space:nowrap;width:160px;vertical-align:top">{_esc(label)}</td>
          <td style="padding:8px 0;font-size:10pt;font-weight:600;color:#111;{style}">{_esc(value)}</td>
        </tr>"""

    key_block = ""
    if lic.license_key:
        key_block = f"""
        <div style="margin:24px 0;background:#f4f6f9;border:1px solid #d0d9e8;border-radius:10px;padding:18px 20px">
          <div style="font-size:8.5pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Clave / Serial de licencia</div>
          <div style="font-family:monospace;font-size:13pt;letter-spacing:2px;color:#1a1a1a;word-break:break-all;line-height:1.6">{_esc(lic.license_key)}</div>
        </div>"""

    seats_str = f"{lic.seats} usuario{'s' if lic.seats != 1 else ''}" if lic.seats else ""

    return f"""<div style="font-family:Arial,sans-serif;font-size:11pt;color:#111;max-width:720px;margin:0 auto;padding:24px 32px">

  <!-- Letterhead -->
  <div style="display:flex;align-items:center;border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:20px;gap:14px">
    <img src="cid:img_logo" alt="Logo" style="width:56px;height:56px;object-fit:contain;border-radius:8px">
    <div style="flex:1">
      <div style="font-size:18pt;font-weight:bold;color:#1e3a5f">{_esc(co_name)}</div>
      <div style="font-size:9pt;color:#555;margin-top:2px">{_esc(co_address)}{(' · RUC: ' + _esc(co_ruc)) if co_ruc else ''}</div>
      {('<div style="font-size:9pt;color:#555">' + ' · '.join(filter(None, [co_phone and f'Tel: {_esc(co_phone)}', co_email and _esc(co_email)])) + '</div>') if co_phone or co_email else ''}
    </div>
    <div style="text-align:right;min-width:120px">
      <div style="font-size:8.5pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase;letter-spacing:0.5px">Licencia de Software</div>
      <div style="font-size:9pt;font-family:monospace;color:#444;margin-top:3px">{_esc(lic.license_number or '')}</div>
    </div>
  </div>

  <!-- Title -->
  <div style="text-align:center;margin:24px 0 28px">
    <div style="font-size:14pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase;letter-spacing:1px">Certificado de Licencia de Software</div>
    <div style="font-size:9pt;color:#888;margin-top:4px">Por medio del presente documento se certifica la adquisición de la siguiente licencia</div>
  </div>

  <!-- Software info -->
  <div style="background:#1e3a5f;border-radius:10px;padding:16px 20px;margin-bottom:20px;color:#fff">
    <div style="font-size:16pt;font-weight:bold;letter-spacing:0.3px">{_esc(lic.software_name)}</div>
    {(f'<div style="font-size:10pt;opacity:0.8;margin-top:4px">Versión: {_esc(lic.software_version)}</div>') if lic.software_version else ''}
    {(f'<div style="font-size:10pt;opacity:0.8;margin-top:2px">{_esc(lic.license_type)}</div>') if lic.license_type else ''}
  </div>

  <!-- License key -->
  {key_block}

  <!-- Details table -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    {row('Cantidad de usuarios', seats_str)}
    {row('Fecha de compra', _fmt_date(lic.purchase_date))}
    {row('Período de vigencia', lic.validity_period)}
    {row('Fecha de vencimiento', _fmt_date(lic.expiry_date))}
    {row('Proveedor', lic.supplier)}
    {row('Ref. Factura', lic.invoice_ref)}
  </table>

  <!-- Separator -->
  <div style="border-top:1px solid #ddd;margin:20px 0"></div>

  <!-- Client -->
  {(f'''<div style="margin-bottom:20px">
    <div style="font-size:8.5pt;font-weight:bold;color:#1e3a5f;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Licenciado a</div>
    <table style="width:100%;border-collapse:collapse">
      {row('Nombre', lic.client_name)}
      {row('RUC', lic.client_ruc)}
      {row('Email', lic.client_email)}
      {row('Teléfono', lic.client_phone)}
      {row('Dirección', lic.client_address)}
    </table>
  </div>''') if any([lic.client_name, lic.client_ruc]) else ''}

  <!-- Notes -->
  {(f'<div style="background:#fffbea;border:1px solid #f0e68c;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:10pt;color:#7a6000">{_esc(lic.notes)}</div>') if lic.notes else ''}

  <!-- Footer -->
  <div style="margin-top:32px;padding-top:8px;border-top:1px solid #ddd;font-size:7.5pt;color:#999;text-align:center">
    {' · '.join(footer_parts)}
  </div>
</div>"""


@router.get("/next-number")
def get_next_number(db: Session = Depends(get_db), current_user=Depends(require_agent_or_admin)):
    return {"number": _next_number(db)}


@router.get("", response_model=list[schemas.SoftwareLicenseOut])
def list_licenses(db: Session = Depends(get_db), current_user=Depends(require_agent_or_admin)):
    return db.query(models.SoftwareLicense).order_by(models.SoftwareLicense.created_at.desc()).all()


@router.post("", response_model=schemas.SoftwareLicenseOut, status_code=201)
def create_license(data: schemas.SoftwareLicenseCreate, db: Session = Depends(get_db), current_user=Depends(require_agent_or_admin)):
    if not data.license_number:
        data.license_number = _next_number(db)
    lic = models.SoftwareLicense(**data.model_dump(), created_by_id=current_user.id)
    db.add(lic)
    db.commit()
    db.refresh(lic)
    return lic


@router.get("/{lid}", response_model=schemas.SoftwareLicenseOut)
def get_license(lid: int, db: Session = Depends(get_db), current_user=Depends(require_agent_or_admin)):
    lic = db.query(models.SoftwareLicense).filter(models.SoftwareLicense.id == lid).first()
    if not lic:
        raise HTTPException(status_code=404, detail="Licencia no encontrada")
    return lic


@router.put("/{lid}", response_model=schemas.SoftwareLicenseOut)
def update_license(lid: int, data: schemas.SoftwareLicenseUpdate, db: Session = Depends(get_db), current_user=Depends(require_agent_or_admin)):
    lic = db.query(models.SoftwareLicense).filter(models.SoftwareLicense.id == lid).first()
    if not lic:
        raise HTTPException(status_code=404, detail="Licencia no encontrada")
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(lic, field, val)
    db.commit()
    db.refresh(lic)
    return lic


@router.delete("/{lid}", status_code=204)
def delete_license(lid: int, db: Session = Depends(get_db), current_user=Depends(require_agent_or_admin)):
    lic = db.query(models.SoftwareLicense).filter(models.SoftwareLicense.id == lid).first()
    if not lic:
        raise HTTPException(status_code=404, detail="Licencia no encontrada")
    db.delete(lic)
    db.commit()


@router.post("/{lid}/send-email")
def send_license_email(lid: int, data: dict = Body(...), db: Session = Depends(get_db), current_user=Depends(require_agent_or_admin)):
    lic = db.query(models.SoftwareLicense).filter(models.SoftwareLicense.id == lid).first()
    if not lic:
        raise HTTPException(status_code=404, detail="Licencia no encontrada")

    to_email = data.get("email") or lic.client_email
    if not to_email:
        raise HTTPException(status_code=400, detail="No hay dirección de correo")

    cfg = _smtp_cfg(db)
    if not cfg:
        raise HTTPException(status_code=400, detail="SMTP no configurado. Configúralo en Ajustes → Email.")

    co = {
        "company_name":    _get_setting(db, "company_name"),
        "company_address": _get_setting(db, "company_address"),
        "company_ruc":     _get_setting(db, "company_ruc"),
        "company_phone":   _get_setting(db, "company_phone"),
        "company_email":   _get_setting(db, "company_email"),
    }
    origin = data.get("origin", "")
    html = _build_license_html(lic, co, origin)
    subject = data.get("subject") or f"Licencia de Software — {lic.software_name} ({lic.license_number or ''})"

    try:
        _send_with_logo(
            cfg["host"], cfg["port"], cfg["user"], cfg["password"],
            cfg["from_addr"], cfg["use_tls"],
            to=to_email, subject=subject, html=html,
        )
        lic.status = "Enviada"
        db.commit()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error enviando correo: {exc}")

    return {"ok": True}
