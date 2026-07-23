from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import Optional
from database import get_db
import models, schemas, auth as auth_module
import secrets, time, smtplib, random, base64, json, os, urllib.request, urllib.error, threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from routers.settings import _get_setting

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ── In-memory captcha store: {id: (answer, expires_ts)} ──
_captchas: dict = {}
_captcha_requests: dict[str, list] = {}   # {ip: [timestamps]} — rate limit
_reset_requests:   dict[str, list] = {}   # {ip: [timestamps]} — rate limit forgot-password
_rate_lock = threading.Lock()             # B50: protect rate limit dicts from race conditions


def _check_rate(store: dict, ip: str, window: int, limit: int) -> bool:
    """Thread-safe rate check. Returns True if allowed, False if limit exceeded."""
    with _rate_lock:
        now = time.time()
        recent = [t for t in store.get(ip, []) if now - t < window]
        if len(recent) >= limit:
            return False
        recent.append(now)
        store[ip] = recent
        return True

def _clean_captchas():
    now = time.time()
    for k in [k for k, v in list(_captchas.items()) if v[1] < now]:
        del _captchas[k]


@router.get("/captcha")
def get_captcha(request: Request):
    ip = request.client.host if request.client else "unknown"
    if not _check_rate(_captcha_requests, ip, window=60, limit=8):
        raise HTTPException(status_code=429, detail="Demasiadas solicitudes. Espera un momento.")
    _clean_captchas()
    a, b = random.randint(1, 9), random.randint(1, 9)
    cid = secrets.token_hex(16)
    _captchas[cid] = (str(a + b), time.time() + 300)
    return {"id": cid, "question": f"¿Cuánto es {a} + {b}?"}


class LoginJSON(BaseModel):
    email: str
    password: str
    captcha_id: str
    captcha_answer: str
    remember_me: bool = False


@router.post("/login", response_model=schemas.Token)
def login_json(data: LoginJSON, db: Session = Depends(get_db)):
    entry = _captchas.pop(data.captcha_id, None)
    if not entry:
        raise HTTPException(status_code=400, detail="Captcha expirado, recarga la página")
    expected, expires = entry
    if time.time() > expires or data.captcha_answer.strip() != expected:
        raise HTTPException(status_code=400, detail="Respuesta incorrecta")

    user = db.query(models.User).filter(
        models.User.email == data.email.strip().lower()
    ).first()
    if not user or not auth_module.verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email o contraseña incorrectos")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Usuario desactivado")

    expires_delta = timedelta(days=30) if data.remember_me else None
    access_token = auth_module.create_access_token(data={"sub": str(user.id)}, expires_delta=expires_delta)
    return {"access_token": access_token, "token_type": "bearer", "user": user}


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    phone: Optional[str] = None
    company: Optional[str] = None
    captcha_id: str
    captcha_answer: str


@router.post("/register", response_model=schemas.Token)
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    entry = _captchas.pop(data.captcha_id, None)
    if not entry:
        raise HTTPException(status_code=400, detail="Captcha expirado, recarga la página")
    expected, expires = entry
    if time.time() > expires or data.captcha_answer.strip() != expected:
        raise HTTPException(status_code=400, detail="Respuesta incorrecta")

    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")

    existing = db.query(models.User).filter(
        models.User.email == data.email.strip().lower()
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ese correo ya está registrado")

    user = models.User(
        name=data.name.strip(),
        email=data.email.strip().lower(),
        password_hash=auth_module.get_password_hash(data.password),
        role=models.UserRole.client,
        phone=data.phone or None,
        company=data.company or None,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = auth_module.create_access_token(data={"sub": str(user.id)})
    return {"access_token": access_token, "token_type": "bearer", "user": user}


@router.post("/token", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(
        models.User.email == form_data.username.strip().lower()
    ).first()
    if not user or not auth_module.verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email o contraseña incorrectos")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Usuario desactivado")
    access_token = auth_module.create_access_token(data={"sub": str(user.id)})
    return {"access_token": access_token, "token_type": "bearer", "user": user}


@router.get("/me", response_model=schemas.UserOut)
def get_me(current_user: models.User = Depends(auth_module.get_current_user)):
    return current_user


@router.put("/me", response_model=schemas.UserOut)
def update_me(
    data: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth_module.get_current_user),
):
    if data.name is not None:
        current_user.name = data.name
    if data.email is not None:
        existing = db.query(models.User).filter(
            models.User.email == data.email,
            models.User.id != current_user.id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Ese correo ya está en uso por otra cuenta")
        current_user.email = data.email
    if data.phone is not None:
        current_user.phone = data.phone
    if data.company is not None:
        current_user.company = data.company
    if data.password:
        if not getattr(data, 'old_password', None):
            raise HTTPException(status_code=400, detail="Se requiere la contraseña actual para cambiarla")
        if not auth_module.verify_password(data.old_password, current_user.password_hash):
            raise HTTPException(status_code=401, detail="Contraseña actual incorrecta")
        current_user.password_hash = auth_module.get_password_hash(data.password)
    db.commit()
    db.refresh(current_user)
    return current_user


# ── Password recovery ──────────────────────────────────────────────────────────

def _get_smtp(db: Session):
    def gs(k):
        row = db.query(models.AppSetting).filter_by(key=k).first()
        return row.value if row else None
    host = gs("smtp_host")
    api_key = gs("brevo_api_key") or None
    if not host and not api_key:
        return None
    return dict(
        host=host or "",
        port=gs("smtp_port") or "587",
        user=gs("smtp_user"),
        password=gs("smtp_password"),
        from_addr=gs("smtp_from") or gs("smtp_user"),
        use_tls=(gs("smtp_tls") or "true").lower() == "true",
        api_key=api_key,
    )


class ForgotRequest(BaseModel):
    email: str
    base_url: str = ""


@router.post("/forgot-password")
def forgot_password(data: ForgotRequest, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    if not _check_rate(_reset_requests, ip, window=300, limit=3):
        return {"ok": True}

    user = db.query(models.User).filter(models.User.email == data.email.strip().lower()).first()
    if not user:
        return {"ok": True}

    cfg = _get_smtp(db)
    if not cfg:
        raise HTTPException(
            status_code=400,
            detail="El sistema no tiene email configurado. Contacte al administrador."
        )

    token = secrets.token_urlsafe(32)
    user.reset_token = token
    user.reset_token_expires = datetime.utcnow() + timedelta(hours=1)
    db.commit()

    _rd = os.getenv("RAILWAY_PUBLIC_DOMAIN")
    base = (
        f"https://{_rd}"
        if _rd
        else (_get_setting(db, "app_base_url") or "http://localhost:5173")
    )
    link = f"{base.rstrip('/')}/reset-password?token={token}"
    co_name = _get_setting(db, "company_name") or "DG Solutions"

    body = f"""
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <div style="background:#1a3353;padding:20px;border-radius:12px 12px 0 0;text-align:center">
        <h2 style="color:#fff;margin:0;font-size:20px">Recuperación de Contraseña</h2>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px">
        <p style="color:#374151;margin-top:0">Hola <strong>{user.name}</strong>,</p>
        <p style="color:#374151">Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>{co_name}</strong>.</p>
        <p style="text-align:center;margin:28px 0">
          <a href="{link}" style="display:inline-block;padding:14px 28px;background:#1a3353;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px">
            Restablecer contraseña
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px">Este enlace expira en <strong>1 hora</strong>. Si no solicitaste este cambio, ignora este mensaje.</p>
        <p style="color:#6b7280;font-size:12px;word-break:break-all">O copia este enlace: {link}</p>
      </div>
    </div>
    """

    try:
        if cfg.get("api_key"):
            payload = {
                "sender": {"email": cfg["from_addr"]},
                "to": [{"email": user.email}],
                "subject": f"Recuperación de contraseña — {co_name}",
                "htmlContent": body,
            }
            req = urllib.request.Request(
                "https://api.brevo.com/v3/smtp/email",
                data=json.dumps(payload).encode("utf-8"),
                headers={"accept": "application/json", "api-key": cfg["api_key"], "content-type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    if resp.status >= 400:
                        raise Exception(f"Brevo API error {resp.status}")
            except urllib.error.HTTPError as e:
                raise Exception(f"Brevo API error {e.code}: {e.read().decode()}")
        else:
            port = int(cfg["port"])
            if cfg["use_tls"]:
                s = smtplib.SMTP(cfg["host"], port, timeout=15)
                s.ehlo()
                s.starttls()
            else:
                s = smtplib.SMTP_SSL(cfg["host"], port, timeout=15)
            if cfg["user"] and cfg["password"]:
                s.login(cfg["user"], cfg["password"])
            msg = MIMEMultipart("alternative")
            msg["Subject"] = f"Recuperación de contraseña — {co_name}"
            msg["From"] = cfg["from_addr"]
            msg["To"] = user.email
            msg.attach(MIMEText(body, "html", "utf-8"))
            s.sendmail(cfg["from_addr"], [user.email], msg.as_string())
            s.quit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error enviando email: {e}")

    return {"ok": True}


class ResetRequest(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password")
def reset_password(data: ResetRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.reset_token == data.token).first()
    if not user or not user.reset_token_expires or datetime.utcnow() > user.reset_token_expires:
        raise HTTPException(status_code=400, detail="Enlace inválido o expirado")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")
    user.password_hash = auth_module.get_password_hash(data.new_password)
    user.reset_token = None
    user.reset_token_expires = None
    db.commit()
    return {"ok": True}
