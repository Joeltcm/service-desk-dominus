"""
Import customer payments from Zoho Books CSV export into invoice_payments table.
Usage:
    python import_payments.py <csv_path>
    python import_payments.py  # uses import_pagos.csv in same directory
"""
import sys
import csv
import os
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# ── Database connection ───────────────────────────────────────────────────────
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://soportedesk:SoporteDesk2026!@switchback.proxy.rlwy.net:19470/soportedesk"
)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
Session = sessionmaker(bind=engine)

# ── Method mapping ────────────────────────────────────────────────────────────
METHOD_MAP = {
    "efectivo":              "Efectivo",
    "cash":                  "Efectivo",
    "transferencia bancaria":"Transferencia",
    "remesa bancaria":       "Transferencia",
    "tarjeta de crédito":  "Tarjeta",
    "tarjeta de credito":    "Tarjeta",
    "cheque":                "Cheque",
}


def fix_encoding(s: str) -> str:
    """Fix mojibake: UTF-8 bytes stored/read as Latin-1."""
    if not s:
        return s
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return s


def parse_amount(raw: str) -> str | None:
    raw = raw.strip()
    if not raw:
        return None
    try:
        return str(Decimal(raw))
    except InvalidOperation:
        return None


def parse_date(raw: str) -> date | None:
    raw = raw.strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def map_method(raw: str) -> str:
    key = fix_encoding(raw).strip().lower()
    return METHOD_MAP.get(key, "Efectivo")


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).parent / "import_pagos.csv")
    if not Path(csv_path).exists():
        print(f"ERROR: CSV not found at {csv_path}")
        sys.exit(1)

    # Try UTF-8 first, fall back to Latin-1
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            with open(csv_path, encoding=enc, newline="") as f:
                sample = f.read(1024)
            encoding = enc
            break
        except UnicodeDecodeError:
            continue
    else:
        encoding = "latin-1"

    print(f"Reading CSV with encoding: {encoding}")

    skipped_no_invoice = []
    skipped_duplicate  = []
    inserted           = []
    errors             = []

    with Session() as db:
        with open(csv_path, encoding=encoding, newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                inv_num  = fix_encoding(row.get("Invoice Number", "").strip())
                raw_amt  = row.get("Importe aplicado a la factura de venta", "").strip()
                if not raw_amt:
                    raw_amt = row.get("Amount", "").strip()
                amt      = parse_amount(raw_amt)
                pay_date = parse_date(row.get("Date", "").strip())
                method   = map_method(row.get("Mode", "Efectivo"))
                pay_num  = row.get("Payment Number", "").strip()
                desc     = fix_encoding(row.get("Description", "").strip())
                cust     = fix_encoding(row.get("Customer Name", "").strip())

                if not inv_num or not amt or not pay_date:
                    errors.append(f"  #{pay_num} {cust}: datos incompletos (inv={inv_num} amt={amt} date={pay_date})")
                    continue

                # Find invoice by number
                result = db.execute(
                    text("SELECT id FROM invoices WHERE invoice_number = :n AND deleted_at IS NULL"),
                    {"n": inv_num}
                ).fetchone()

                if not result:
                    skipped_no_invoice.append(f"  #{pay_num} {cust} → {inv_num} (${amt})")
                    continue

                invoice_id = result[0]

                # Duplicate check: same invoice + same amount + same date
                dup = db.execute(
                    text("""
                        SELECT id FROM invoice_payments
                        WHERE invoice_id = :iid
                          AND amount = :amt
                          AND date = :d
                    """),
                    {"iid": invoice_id, "amt": amt, "d": pay_date}
                ).fetchone()

                if dup:
                    skipped_duplicate.append(f"  #{pay_num} {cust} → {inv_num} {pay_date} ${amt}")
                    continue

                notes_parts = [f"Pago #{pay_num}"]
                if desc:
                    notes_parts.append(desc)
                notes = " — ".join(notes_parts)

                db.execute(
                    text("""
                        INSERT INTO invoice_payments (invoice_id, amount, method, date, notes, created_at)
                        VALUES (:iid, :amt, :meth, :d, :notes, NOW())
                    """),
                    {"iid": invoice_id, "amt": amt, "meth": method, "d": pay_date, "notes": notes}
                )
                inserted.append(f"  #{pay_num} {cust} → {inv_num} {pay_date} ${amt} [{method}]")

        db.commit()

    # ── Report ────────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"RESULTADO DE IMPORTACIÓN")
    print(f"{'='*60}")
    print(f"  Insertados:             {len(inserted)}")
    print(f"  Saltados (sin factura): {len(skipped_no_invoice)}")
    print(f"  Saltados (duplicado):   {len(skipped_duplicate)}")
    print(f"  Errores (datos rotos):  {len(errors)}")

    if skipped_no_invoice:
        print(f"\n-- Sin factura en el sistema ({len(skipped_no_invoice)}) --")
        for s in skipped_no_invoice:
            print(s)

    if skipped_duplicate:
        print(f"\n-- Duplicados saltados ({len(skipped_duplicate)}) --")
        for s in skipped_duplicate:
            print(s)

    if errors:
        print(f"\n-- Errores ({len(errors)}) --")
        for s in errors:
            print(s)

    print(f"\nImportacion completa. {len(inserted)} pagos anadidos.")


if __name__ == "__main__":
    main()
