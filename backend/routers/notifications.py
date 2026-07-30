from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from auth import get_current_user
import models

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _ser(n: models.Notification) -> dict:
    return {
        "id": n.id,
        "title": n.title,
        "body": n.body,
        "url": n.url,
        "kind": n.kind,
        "read": n.read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("")
def list_notifications(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rows = (
        db.query(models.Notification)
        .filter(models.Notification.user_id == current_user.id)
        .order_by(models.Notification.read.asc(), models.Notification.created_at.desc())
        .limit(30)
        .all()
    )
    unread = (
        db.query(func.count(models.Notification.id))
        .filter(models.Notification.user_id == current_user.id, models.Notification.read == False)
        .scalar()
    ) or 0
    return {"unread": unread, "items": [_ser(n) for n in rows]}


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    n = (
        db.query(func.count(models.Notification.id))
        .filter(models.Notification.user_id == current_user.id, models.Notification.read == False)
        .scalar()
    ) or 0
    return {"unread": n}


@router.post("/{notif_id}/read")
def mark_read(
    notif_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    n = db.query(models.Notification).filter(
        models.Notification.id == notif_id,
        models.Notification.user_id == current_user.id,
    ).first()
    if n and not n.read:
        n.read = True
        db.commit()
    return {"ok": True}


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    db.query(models.Notification).filter(
        models.Notification.user_id == current_user.id,
        models.Notification.read == False,
    ).update({"read": True}, synchronize_session=False)
    db.commit()
    return {"ok": True}
