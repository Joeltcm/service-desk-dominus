import os, json, logging, time
from pywebpush import webpush, WebPushException

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY  = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_EMAIL       = os.getenv("VAPID_EMAIL", "mailto:admin@dgsolutionspa.com")


def _fix_key(key: str) -> str:
    """Normalize VAPID private key.
    Accepts raw base64url (32-byte EC scalar) or PEM with literal \\n from env.
    Raw base64url is returned as-is: py_vapid handles it natively via from_string().
    PEM strings have literal \\n replaced with real newlines.
    """
    key = key.strip()
    if key.startswith('-----'):
        return key.replace('\\n', '\n')
    # Raw base64url — return as-is, py_vapid from_string() handles 32-byte scalars
    return key


def send_push(subscription_info: dict, title: str, body: str, url: str = "/") -> bool:
    """
    Send a single Web Push notification.
    Returns True on success, None if subscription expired (should be deleted), False on other error.
    """
    import traceback as _tb
    try:
        import base64 as _b64
        p256dh = subscription_info.get("keys", {}).get("p256dh", "")
        n = len(p256dh) % 4
        pad = '' if n == 0 else '=' * (4 - n)
        try:
            p256dh_bytes = _b64.urlsafe_b64decode(p256dh + pad)
            logging.error("PUSH_DIAG p256dh_chars=%d decoded_bytes=%d first_byte=%s",
                          len(p256dh), len(p256dh_bytes), hex(p256dh_bytes[0]) if p256dh_bytes else 'empty')
            # Apple Web Push sends DER SubjectPublicKeyInfo (91 bytes, 0x30) instead of
            # the raw 65-byte uncompressed EC point (0x04) that pywebpush expects.
            if len(p256dh_bytes) != 65:
                try:
                    from cryptography.hazmat.primitives.serialization import (
                        load_der_public_key, Encoding, PublicFormat,
                    )
                    from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePublicKey
                    pub_key = load_der_public_key(p256dh_bytes)
                    if isinstance(pub_key, EllipticCurvePublicKey):
                        raw_point = pub_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
                        new_p256dh = _b64.urlsafe_b64encode(raw_point).rstrip(b'=').decode()
                        subscription_info = {
                            **subscription_info,
                            "keys": {**subscription_info.get("keys", {}), "p256dh": new_p256dh},
                        }
                        logging.info("PUSH_DIAG: Converted %dB DER p256dh to raw EC point (%d chars)",
                                     len(p256dh_bytes), len(new_p256dh))
                except Exception as conv_e:
                    logging.error("PUSH_DIAG: Could not convert p256dh (%dB): %s", len(p256dh_bytes), conv_e)
        except Exception as de:
            logging.error("PUSH_DIAG p256dh decode error: %s raw=%r", de, p256dh[:20])

        key = _fix_key(VAPID_PRIVATE_KEY)
        if not key:
            logging.error("Push: VAPID_PRIVATE_KEY empty")
            return "VAPID_PRIVATE_KEY not set"
        # Pre-flight: verify py_vapid can load the key before calling webpush
        try:
            from py_vapid import Vapid01
            _vd = Vapid01.from_pem(key.encode('utf8')) if key.startswith('-----') else Vapid01.from_string(key)
            logging.info("PUSH_DIAG VAPID key loaded OK via %s", "from_pem" if key.startswith('-----') else "from_string")
        except Exception as _vk_err:
            msg = f"VAPID key load failed: {type(_vk_err).__name__}: {_vk_err}"
            logging.error("PUSH_DIAG %s", msg)
            return msg
        webpush(
            subscription_info=subscription_info,
            data=json.dumps({"title": title, "body": body, "url": url}),
            vapid_private_key=key,
            vapid_claims={
                "sub": VAPID_EMAIL,
                "exp": int(time.time()) + 86400,
            },
            ttl=86400,
            content_encoding="aes128gcm",
        )
        return True
    except WebPushException as e:
        resp = e.response
        status = resp.status_code if resp else None
        if status in (404, 410):
            return None  # subscription expired — caller should delete
        body_text = ""
        try:
            body_text = resp.text[:300] if resp else ""
        except Exception:
            pass
        logging.error("Push WebPushException status=%s body=%s err=%s", status, body_text, e)
        return False
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        logging.error("Push unexpected error %s\n%s", msg, _tb.format_exc())
        return msg  # return error string so callers can surface it


def notify_agents(db, title: str, body: str, url: str = "/", exclude_user_id: int = None):
    """Send push to all active agent/admin subscriptions."""
    if not _fix_key(VAPID_PRIVATE_KEY):
        return
    from models import PushSubscription, User, UserRole
    subs = (
        db.query(PushSubscription)
        .join(User, User.id == PushSubscription.user_id)
        .filter(
            User.role.in_([UserRole.agent, UserRole.admin]),
            User.is_active == True,
        )
        .all()
    )
    dead = []
    for sub in subs:
        if exclude_user_id and sub.user_id == exclude_user_id:
            continue
        info = {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}
        result = send_push(info, title, body, url)
        if result is None:
            dead.append(sub.id)
    if dead:
        from models import PushSubscription as PS
        db.query(PS).filter(PS.id.in_(dead)).delete(synchronize_session=False)
        db.commit()


def notify_user(db, user_id: int, title: str, body: str, url: str = "/"):
    """Send push to all subscriptions for a specific user."""
    if not _fix_key(VAPID_PRIVATE_KEY):
        return
    from models import PushSubscription
    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    dead = []
    for sub in subs:
        info = {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}
        result = send_push(info, title, body, url)
        if result is None:
            dead.append(sub.id)
    if dead:
        from models import PushSubscription as PS
        db.query(PS).filter(PS.id.in_(dead)).delete(synchronize_session=False)
        db.commit()
