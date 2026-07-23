import os, base64, logging
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database import get_db
from auth import get_current_user
import models
from push_helper import send_push

router = APIRouter(prefix="/api/push", tags=["push"])


class SubscribeRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


@router.get("/vapid-public-key")
def get_vapid_public_key():
    key = os.getenv("VAPID_PUBLIC_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="Push notifications no configuradas")
    return {"public_key": key}


@router.post("/subscribe", status_code=201)
def subscribe(
    data: SubscribeRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    existing = db.query(models.PushSubscription).filter(
        models.PushSubscription.endpoint == data.endpoint
    ).first()
    if existing:
        existing.p256dh = data.p256dh
        existing.auth = data.auth
        existing.user_id = current_user.id
    else:
        sub = models.PushSubscription(
            user_id=current_user.id,
            endpoint=data.endpoint,
            p256dh=data.p256dh,
            auth=data.auth,
        )
        db.add(sub)
    db.commit()
    return {"ok": True}


@router.post("/unsubscribe")
def unsubscribe(
    data: SubscribeRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db.query(models.PushSubscription).filter(
        models.PushSubscription.endpoint == data.endpoint,
        models.PushSubscription.user_id == current_user.id,
    ).delete()
    db.commit()
    return {"ok": True}


@router.get("/status")
def push_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    subs = db.query(models.PushSubscription).filter(
        models.PushSubscription.user_id == current_user.id
    ).all()
    return {
        "count": len(subs),
        "subscriptions": [
            {"id": s.id, "domain": urlparse(s.endpoint).netloc}
            for s in subs
        ],
        "vapid_configured": bool(os.getenv("VAPID_PUBLIC_KEY")),
    }


@router.get("/debug-subs")
def debug_subs(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    subs = db.query(models.PushSubscription).filter(
        models.PushSubscription.user_id == current_user.id
    ).all()
    result = []
    for s in subs:
        try:
            # Browsers hand back p256dh/auth as unpadded base64url; b64decode needs
            # the '=' padding restored manually before it will accept the string.
            n = len(s.p256dh) % 4
            pad = '' if n == 0 else '=' * (4 - n)
            decoded = base64.urlsafe_b64decode(s.p256dh + pad)
            p256dh_len = len(decoded)
            first_byte = hex(decoded[0]) if decoded else 'empty'
        except Exception as e:
            p256dh_len = f"ERR:{e}"
            first_byte = "err"
        result.append({
            "id": s.id,
            "p256dh_chars": len(s.p256dh),
            "p256dh_decoded_bytes": p256dh_len,
            "p256dh_first_byte": first_byte,
            "auth_chars": len(s.auth),
            "endpoint_domain": urlparse(s.endpoint).netloc,
        })
    return result


@router.post("/test")
def push_test(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    subs = db.query(models.PushSubscription).filter(
        models.PushSubscription.user_id == current_user.id
    ).all()
    if not subs:
        raise HTTPException(status_code=404, detail="No hay suscripciones registradas para este usuario")

    results = []
    dead = []
    for sub in subs:
        info = {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}
        try:
            n = len(sub.p256dh) % 4
            pad = '' if n == 0 else '=' * (4 - n)
            decoded = base64.urlsafe_b64decode(sub.p256dh + pad)
            p256dh_info = f"{len(decoded)}B:{hex(decoded[0]) if decoded else 'empty'}"
        except Exception:
            p256dh_info = "err"
        result = send_push(info, "DG Solutions", "Notificación de prueba funcionando ✓", "/")
        domain = urlparse(sub.endpoint).netloc
        if result is True:
            results.append({"id": sub.id, "domain": domain, "status": "ok", "p256dh": p256dh_info, "error": None})
        elif result is None:
            results.append({"id": sub.id, "domain": domain, "status": "expired", "p256dh": p256dh_info, "error": None})
            dead.append(sub.id)
        else:
            results.append({"id": sub.id, "domain": domain, "status": "error", "p256dh": p256dh_info, "error": str(result)[:300]})

    if dead:
        db.query(models.PushSubscription).filter(
            models.PushSubscription.id.in_(dead)
        ).delete(synchronize_session=False)
        db.commit()

    ok_count = sum(1 for r in results if r["status"] == "ok")
    return {"sent": ok_count, "total": len(results), "results": results}
