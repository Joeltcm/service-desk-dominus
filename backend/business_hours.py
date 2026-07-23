from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo('America/Panama')  # UTC-5, sin DST
UTC = ZoneInfo('UTC')
WORK_START = 8   # 8:00 AM
WORK_END   = 17  # 5:00 PM
WORK_DAYS  = {0, 1, 2, 3, 4}  # Lun-Vie

SLA_MINUTES = {
    'critical': 240,   # 4 horas hábiles
    'high':     540,   # 1 día hábil (9h)
    'medium':   1620,  # 3 días hábiles
    'low':      2700,  # 5 días hábiles (1 semana)
}

PAUSE_STATUSES = frozenset({'Programado', 'Esperando Detalles', 'Resuelto'})


def _local(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(TZ)


def _snap_to_business(cur: datetime) -> datetime:
    """Avanza cur al próximo momento hábil (en hora local)."""
    # Saltar fines de semana
    while cur.weekday() not in WORK_DAYS:
        cur = (cur + timedelta(days=1)).replace(
            hour=WORK_START, minute=0, second=0, microsecond=0)
    # Antes del horario laboral → inicio del día
    if cur.hour < WORK_START:
        cur = cur.replace(hour=WORK_START, minute=0, second=0, microsecond=0)
    # Después del horario laboral → inicio del siguiente día hábil
    elif cur.hour >= WORK_END:
        cur = (cur + timedelta(days=1)).replace(
            hour=WORK_START, minute=0, second=0, microsecond=0)
        return _snap_to_business(cur)
    return cur


def add_business_minutes(start: datetime, minutes: int) -> datetime:
    """Devuelve datetime UTC naive que es `minutes` minutos hábiles después de start."""
    cur = _local(start)
    remaining = minutes
    while remaining > 0:
        cur = _snap_to_business(cur)
        eod = cur.replace(hour=WORK_END, minute=0, second=0, microsecond=0)
        avail = int((eod - cur).total_seconds() // 60)
        if remaining <= avail:
            cur += timedelta(minutes=remaining)
            remaining = 0
        else:
            remaining -= avail
            cur = (cur + timedelta(days=1)).replace(
                hour=WORK_START, minute=0, second=0, microsecond=0)
    return cur.astimezone(UTC).replace(tzinfo=None)


def elapsed_business_minutes(start: datetime, end: datetime) -> int:
    """Cuenta minutos hábiles entre dos datetimes UTC naive."""
    if end <= start:
        return 0
    cur = _local(start)
    end_l = _local(end)
    total = 0
    while cur < end_l:
        cur = _snap_to_business(cur)
        if cur >= end_l:
            break
        eod = cur.replace(hour=WORK_END, minute=0, second=0, microsecond=0)
        seg_end = min(end_l, eod)
        total += int((seg_end - cur).total_seconds() // 60)
        if seg_end == eod:
            cur = (cur + timedelta(days=1)).replace(
                hour=WORK_START, minute=0, second=0, microsecond=0)
        else:
            cur = seg_end
    return total
