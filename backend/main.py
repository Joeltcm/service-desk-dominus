from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import os, logging, json

load_dotenv()

from database import engine, SessionLocal, is_sqlite, get_db as _get_db_main
import models
import storage
from auth import get_password_hash, get_current_user
from routers import auth, users, tickets, attachments, calendar, knowledge_base, dashboard, reports, contacts, suppliers, orders, warranties, despacho, companies, quotes, invoices, ventas, settings, expenses, letters, papelera, audit, inventory, opportunities, licenses, push, canned_responses, projects, contracts, printers, supplies, system, stats

models.Base.metadata.create_all(bind=engine)

# Migración suave: agregar columnas nuevas si no existen (SQLite)
def _migrate():
    from sqlalchemy import text
    with engine.connect() as conn:
        for col, typedef in [("address", "VARCHAR(500)")]:
            try:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        for col, typedef in [("client_ruc", "VARCHAR(100)")]:
            try:
                conn.execute(text(f"ALTER TABLE warranties ADD COLUMN {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        for col, typedef in [
            ("logo_path", "VARCHAR(255)"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE suppliers ADD COLUMN {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        for col, typedef in [
            ("purchase_items",       "TEXT"),
            ("purchase_total",       "VARCHAR(50)"),
            ("itbms_enabled",        "BOOLEAN DEFAULT 0"),
            ("client_invoice_notes", "TEXT"),
            ("order_number",         "VARCHAR(50)"),
            ("quote_id",             "INTEGER REFERENCES quotes(id)"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE orders ADD COLUMN {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        for col, typedef in [("ruc", "VARCHAR(100)")]:
            try:
                conn.execute(text(f"ALTER TABLE contacts ADD COLUMN {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS companies (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(200) NOT NULL UNIQUE,
                    ruc VARCHAR(100),
                    address VARCHAR(500),
                    phone VARCHAR(50),
                    email VARCHAR(150),
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass
        for col, typedef in [
            ("location", "VARCHAR(255)"),
            ("subject", "VARCHAR(255)"),
            ("cc_email", "VARCHAR(150)"),
            ("duration_minutes", "INTEGER DEFAULT 60"),
            ("parent_id", "INTEGER REFERENCES tickets(id)"),
            ("sla_deadline", "DATETIME"),
            ("sla_paused_at", "DATETIME"),
            ("sla_elapsed_minutes", "INTEGER DEFAULT 0"),
            ("sla_last_resume", "DATETIME"),
            ("tags", "VARCHAR(500)"),
            ("csat_rating", "INTEGER"),
            ("csat_comment", "TEXT"),
            ("csat_submitted_at", "DATETIME"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE tickets ADD COLUMN {col} {typedef}"))
                conn.commit()
            except Exception:
                pass  # columna ya existe
        for col, typedef in [
            ("delivery_date", "DATE"),
            ("quote_id", "INTEGER REFERENCES quotes(id)"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE dispatches ADD COLUMN {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        for col, typedef in [("status", "VARCHAR(20) DEFAULT 'scheduled'")]:
            try:
                conn.execute(text(f"ALTER TABLE ticket_visits ADD COLUMN {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        for col, typedef in [
            ("scheduled_at",        "DATETIME"),
            ("duration_minutes",    "INTEGER DEFAULT 60"),
            ("calendar_event_id",   "VARCHAR(255)"),
            ("calendar_event_link", "VARCHAR(500)"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE orders ADD COLUMN {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        for col, typedef in [
            ("scheduled_at",        "DATETIME"),
            ("duration_minutes",    "INTEGER DEFAULT 60"),
            ("calendar_event_id",   "VARCHAR(255)"),
            ("calendar_event_link", "VARCHAR(500)"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE dispatches ADD COLUMN {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        for col, typedef in [
            ("reset_token", "VARCHAR(100)"),
            ("reset_token_expires", "DATETIME"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        for col, typedef in [
            ("service_scope",  "TEXT"),
            ("response_time",  "VARCHAR(50)"),
            ("coverage_hours", "VARCHAR(50)"),
            ("included_hours", "INTEGER DEFAULT 0"),
            ("included_visits","INTEGER DEFAULT 0"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE contracts ADD COLUMN {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS client_categories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(100) NOT NULL UNIQUE,
                    color VARCHAR(7) DEFAULT '#6B7280',
                    description VARCHAR(255),
                    "order" INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN client_category_id INTEGER REFERENCES client_categories(id)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE companies ADD COLUMN client_category_id INTEGER REFERENCES client_categories(id)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS invoices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    invoice_number VARCHAR(50),
                    status VARCHAR(50) NOT NULL DEFAULT 'Borrador',
                    dispatch_id INTEGER REFERENCES dispatches(id),
                    client_name VARCHAR(200),
                    client_ruc VARCHAR(100),
                    client_address VARCHAR(500),
                    client_email VARCHAR(150),
                    client_phone VARCHAR(50),
                    date DATE,
                    due_date DATE,
                    items TEXT,
                    itbms_enabled BOOLEAN DEFAULT 0,
                    subtotal VARCHAR(50),
                    itbms_amount VARCHAR(50),
                    total VARCHAR(50),
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS quotes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title VARCHAR(300) NOT NULL,
                    quote_number VARCHAR(50),
                    status VARCHAR(50) NOT NULL DEFAULT 'Borrador',
                    client_name VARCHAR(200),
                    client_ruc VARCHAR(100),
                    client_address VARCHAR(500),
                    client_email VARCHAR(150),
                    client_phone VARCHAR(50),
                    date DATE,
                    valid_until DATE,
                    items TEXT,
                    itbms_enabled BOOLEAN DEFAULT 0,
                    subtotal VARCHAR(50),
                    itbms_amount VARCHAR(50),
                    total VARCHAR(50),
                    notes TEXT,
                    order_id INTEGER REFERENCES orders(id),
                    ticket_id INTEGER REFERENCES tickets(id),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE warranties ADD COLUMN invoice_id INTEGER REFERENCES invoices(id)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN ticket_id INTEGER REFERENCES tickets(id)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    key VARCHAR(100) PRIMARY KEY,
                    value TEXT
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS expenses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    concept VARCHAR(300) NOT NULL,
                    amount VARCHAR(50) DEFAULT '0.00',
                    category VARCHAR(100),
                    date VARCHAR(10),
                    type VARCHAR(20) DEFAULT 'manual',
                    order_id INTEGER UNIQUE REFERENCES orders(id),
                    supplier VARCHAR(200),
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS expense_attachments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    expense_id INTEGER NOT NULL REFERENCES expenses(id),
                    filename VARCHAR(255) NOT NULL,
                    original_name VARCHAR(255) NOT NULL,
                    file_size INTEGER,
                    content_type VARCHAR(100),
                    uploaded_by_id INTEGER REFERENCES users(id),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass
        # ── Soft-delete columns ───────────────────────────────────────────────
        for tbl in ("tickets", "invoices", "quotes", "expenses", "contacts", "companies", "orders", "dispatches", "kb_articles"):
            try:
                conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN deleted_at DATETIME"))
                conn.commit()
            except Exception:
                pass
        # ── Audit log table ───────────────────────────────────────────────────
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER REFERENCES users(id),
                    user_name VARCHAR(150),
                    action VARCHAR(30) NOT NULL,
                    entity_type VARCHAR(50) NOT NULL,
                    entity_id INTEGER,
                    entity_name VARCHAR(300),
                    details TEXT,
                    ip_address VARCHAR(50),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass
        # ── payment_terms on invoices (older DBs) ─────────────────────────────
        try:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN payment_terms VARCHAR(100)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS letters (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    letter_number VARCHAR(50),
                    letter_type VARCHAR(100),
                    status VARCHAR(50) DEFAULT 'Borrador',
                    recipient_name VARCHAR(200),
                    recipient_company VARCHAR(200),
                    recipient_ruc VARCHAR(100),
                    recipient_address VARCHAR(500),
                    recipient_email VARCHAR(150),
                    date DATE,
                    subject VARCHAR(300),
                    body TEXT,
                    attention_to VARCHAR(200),
                    signer_name VARCHAR(200),
                    signer_title VARCHAR(200),
                    notes TEXT,
                    created_by_id INTEGER REFERENCES users(id),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS inventory_transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    item_code VARCHAR(100) NOT NULL,
                    qty_delta VARCHAR(50) NOT NULL,
                    source_type VARCHAR(30) NOT NULL,
                    source_id INTEGER,
                    notes VARCHAR(300),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ticket_time_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    minutes INTEGER NOT NULL,
                    description VARCHAR(500),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS canned_responses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title VARCHAR(200) NOT NULL,
                    content TEXT NOT NULL,
                    category VARCHAR(100),
                    is_active BOOLEAN DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(300) NOT NULL,
                    description TEXT,
                    status VARCHAR(50) DEFAULT 'Activo',
                    client_id INTEGER REFERENCES users(id),
                    start_date DATE,
                    end_date DATE,
                    budget VARCHAR(50),
                    quote_id INTEGER REFERENCES quotes(id),
                    notes TEXT,
                    deleted_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE tickets ADD COLUMN project_id INTEGER REFERENCES projects(id)"))
            conn.commit()
        except Exception:
            pass
        # ── Partial unique indexes on document numbers (SQLite) ───────────────
        for stmt in [
            "CREATE UNIQUE INDEX IF NOT EXISTS uix_orders_order_number ON orders(order_number) WHERE order_number IS NOT NULL AND deleted_at IS NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS uix_dispatches_dispatch_number ON dispatches(dispatch_number) WHERE dispatch_number IS NOT NULL AND deleted_at IS NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS uix_quotes_quote_number ON quotes(quote_number) WHERE quote_number IS NOT NULL AND deleted_at IS NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS uix_invoices_invoice_number ON invoices(invoice_number) WHERE invoice_number IS NOT NULL AND deleted_at IS NULL",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass
        # ── Vínculo real (FK) entre cotizaciones/facturas y la cuenta de portal del cliente ──
        for tbl in ("quotes", "invoices"):
            try:
                conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN client_id INTEGER REFERENCES users(id)"))
                conn.commit()
            except Exception:
                pass
        # ── Bodegas de inventario (MPS: principal/suministros_mps/partes/impresoras_mps) ──
        try:
            conn.execute(text("ALTER TABLE inventory ADD COLUMN warehouse VARCHAR(30) DEFAULT 'principal'"))
            conn.commit()
        except Exception:
            pass
        # ── Tipo de contrato (MPS | Soporte) ──
        try:
            conn.execute(text("ALTER TABLE contracts ADD COLUMN contract_type VARCHAR(50) DEFAULT 'MPS'"))
            conn.commit()
        except Exception:
            pass

if is_sqlite:
    _migrate()

def _migrate_pg():
    """Add missing columns to existing PostgreSQL tables on Railway."""
    from sqlalchemy import text
    with engine.connect() as conn:
        # ── Rol superadmin ──
        try:
            conn.execute(text("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'superadmin'"))
            conn.commit()
        except Exception:
            pass
        for tbl in ("tickets", "invoices", "quotes", "expenses", "contacts", "companies", "orders", "dispatches", "kb_articles"):
            try:
                conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE"))
                conn.commit()
            except Exception:
                pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS audit_log (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    user_name VARCHAR(150),
                    action VARCHAR(30) NOT NULL,
                    entity_type VARCHAR(50) NOT NULL,
                    entity_id INTEGER,
                    entity_name VARCHAR(300),
                    details TEXT,
                    ip_address VARCHAR(50),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """))
            conn.commit()
        except Exception:
            pass
        for tbl in ("orders", "dispatches"):
            for col, typedef in [
                ("scheduled_at",        "TIMESTAMP WITH TIME ZONE"),
                ("duration_minutes",    "INTEGER DEFAULT 60"),
                ("calendar_event_id",   "VARCHAR(255)"),
                ("calendar_event_link", "VARCHAR(500)"),
            ]:
                try:
                    conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS {col} {typedef}"))
                    conn.commit()
                except Exception:
                    pass
        for col, typedef in [
            ("is_payable", "BOOLEAN DEFAULT FALSE"),
            ("due_date",   "DATE"),
            ("paid_at",    "DATE"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE expenses ADD COLUMN IF NOT EXISTS {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        try:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quote_id INTEGER REFERENCES quotes(id)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS invoice_payments (
                    id SERIAL PRIMARY KEY,
                    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                    amount VARCHAR(50) NOT NULL,
                    method VARCHAR(30) NOT NULL DEFAULT 'Efectivo',
                    date DATE NOT NULL,
                    notes TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS inventory (
                    id SERIAL PRIMARY KEY,
                    code VARCHAR(100) NOT NULL UNIQUE,
                    name VARCHAR(300) NOT NULL,
                    description TEXT,
                    unit VARCHAR(50) DEFAULT 'unidad',
                    unit_price VARCHAR(50) DEFAULT '0.00',
                    quantity VARCHAR(50) DEFAULT '0',
                    category VARCHAR(100),
                    notes TEXT,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS inventory_applied BOOLEAN DEFAULT FALSE"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dgi_filename VARCHAR(255)"))
            conn.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dgi_original_name VARCHAR(255)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS invoice_quote_links (
                    id SERIAL PRIMARY KEY,
                    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                    quote_id   INTEGER NOT NULL REFERENCES quotes(id)   ON DELETE CASCADE,
                    UNIQUE(invoice_id, quote_id)
                )
            """))
            conn.execute(text("""
                INSERT INTO invoice_quote_links (invoice_id, quote_id)
                SELECT id, quote_id FROM invoices
                WHERE quote_id IS NOT NULL AND deleted_at IS NULL
                ON CONFLICT DO NOTHING
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_applied BOOLEAN DEFAULT FALSE"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS inventory_applied BOOLEAN DEFAULT FALSE"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ticket_visits (
                    id SERIAL PRIMARY KEY,
                    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    duration_minutes INTEGER DEFAULT 60,
                    calendar_event_id VARCHAR(255),
                    calendar_event_link TEXT,
                    notes TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """))
            conn.commit()
        except Exception:
            pass

        try:
            conn.execute(text("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE inventory ADD COLUMN IF NOT EXISTS cost_price VARCHAR(50) DEFAULT '0.00'"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS quote_id INTEGER REFERENCES quotes(id)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE ticket_visits ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'scheduled'"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE ticket_visits ADD COLUMN IF NOT EXISTS is_remote BOOLEAN NOT NULL DEFAULT FALSE"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS software_licenses (
                    id SERIAL PRIMARY KEY,
                    license_number VARCHAR(50),
                    software_name VARCHAR(200) NOT NULL,
                    software_version VARCHAR(100),
                    license_type VARCHAR(100),
                    license_key TEXT,
                    seats INTEGER DEFAULT 1,
                    purchase_date DATE,
                    expiry_date DATE,
                    validity_period VARCHAR(100),
                    client_name VARCHAR(200),
                    client_ruc VARCHAR(100),
                    client_email VARCHAR(150),
                    client_phone VARCHAR(50),
                    client_address VARCHAR(500),
                    invoice_ref VARCHAR(100),
                    supplier VARCHAR(200),
                    notes TEXT,
                    status VARCHAR(50) DEFAULT 'Borrador',
                    created_by_id INTEGER REFERENCES users(id),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS client_categories (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL UNIQUE,
                    color VARCHAR(7) DEFAULT '#6B7280',
                    description VARCHAR(255),
                    "order" INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS client_category_id INTEGER REFERENCES client_categories(id)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS client_category_id INTEGER REFERENCES client_categories(id)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS opp_visits (
                    id SERIAL PRIMARY KEY,
                    opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
                    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    duration_minutes INTEGER DEFAULT 60,
                    calendar_event_id VARCHAR(255),
                    calendar_event_link TEXT,
                    notes TEXT,
                    status VARCHAR(20) DEFAULT 'scheduled',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS opportunities (
                    id SERIAL PRIMARY KEY,
                    title VARCHAR(200) NOT NULL,
                    description TEXT,
                    status VARCHAR(50) DEFAULT 'Nueva',
                    priority VARCHAR(20) DEFAULT 'Media',
                    source VARCHAR(50),
                    estimated_value VARCHAR(50),
                    probability INTEGER DEFAULT 50,
                    expected_close_date DATE,
                    client_name VARCHAR(200),
                    client_ruc VARCHAR(100),
                    client_email VARCHAR(150),
                    client_phone VARCHAR(50),
                    client_address VARCHAR(500),
                    category VARCHAR(100),
                    notes TEXT,
                    assigned_to_id INTEGER REFERENCES users(id),
                    created_by_id INTEGER REFERENCES users(id),
                    quote_id INTEGER REFERENCES quotes(id),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE
                )
            """))
            conn.commit()
        except Exception:
            pass

        # ── Inventory transaction log ─────────────────────────────────────────
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS inventory_transactions (
                    id SERIAL PRIMARY KEY,
                    item_code VARCHAR(100) NOT NULL,
                    qty_delta VARCHAR(50) NOT NULL,
                    source_type VARCHAR(30) NOT NULL,
                    source_id INTEGER,
                    notes VARCHAR(300),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """))
            conn.commit()
        except Exception:
            pass
        for col, typedef in [
            ("tags", "VARCHAR(500)"),
            ("csat_rating", "INTEGER"),
            ("csat_comment", "TEXT"),
            ("csat_submitted_at", "TIMESTAMP WITH TIME ZONE"),
            ("charger", "VARCHAR(20)"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE tickets ADD COLUMN IF NOT EXISTS {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS ticket_time_logs (
                    id SERIAL PRIMARY KEY,
                    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    minutes INTEGER NOT NULL,
                    description VARCHAR(500),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS canned_responses (
                    id SERIAL PRIMARY KEY,
                    title VARCHAR(200) NOT NULL,
                    content TEXT NOT NULL,
                    category VARCHAR(100),
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS projects (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(300) NOT NULL,
                    description TEXT,
                    status VARCHAR(50) DEFAULT 'Activo',
                    client_id INTEGER REFERENCES users(id),
                    start_date DATE,
                    end_date DATE,
                    budget VARCHAR(50),
                    quote_id INTEGER REFERENCES quotes(id),
                    notes TEXT,
                    deleted_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS project_weight REAL"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS invoice_attachments (
                    id SERIAL PRIMARY KEY,
                    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                    filename VARCHAR(255) NOT NULL,
                    original_name VARCHAR(500) NOT NULL,
                    file_size INTEGER,
                    content_type VARCHAR(100),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """))
            conn.commit()
        except Exception:
            pass
        # ── Partial unique indexes on document numbers ────────────────────────
        for stmt in [
            "CREATE UNIQUE INDEX IF NOT EXISTS uix_orders_order_number ON orders(order_number) WHERE order_number IS NOT NULL AND deleted_at IS NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS uix_dispatches_dispatch_number ON dispatches(dispatch_number) WHERE dispatch_number IS NOT NULL AND deleted_at IS NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS uix_quotes_quote_number ON quotes(quote_number) WHERE quote_number IS NOT NULL AND deleted_at IS NULL",
            "CREATE UNIQUE INDEX IF NOT EXISTS uix_invoices_invoice_number ON invoices(invoice_number) WHERE invoice_number IS NOT NULL AND deleted_at IS NULL",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass
        # Allow multiple expenses to reference the same order (pedido + bank transaction)
        try:
            conn.execute(text("ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_order_id_key"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'all'"))
            conn.commit()
        except Exception:
            pass
        # ── Vínculo real (FK) entre cotizaciones/facturas y la cuenta de portal del cliente ──
        for tbl in ("quotes", "invoices"):
            try:
                conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES users(id)"))
                conn.commit()
            except Exception:
                pass
        # ── Bodegas de inventario (MPS: principal/suministros_mps/partes/impresoras_mps) ──
        try:
            conn.execute(text("ALTER TABLE inventory ADD COLUMN IF NOT EXISTS warehouse VARCHAR(30) DEFAULT 'principal'"))
            conn.commit()
        except Exception:
            pass
        # ── Tipo de contrato (MPS | Soporte) ──
        try:
            conn.execute(text("ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_type VARCHAR(50) DEFAULT 'MPS'"))
            conn.commit()
        except Exception:
            pass
        # ── Garantía fin + campos dedicados en printers ──
        try:
            conn.execute(text("ALTER TABLE printers ADD COLUMN IF NOT EXISTS warranty_end_date DATE"))
            conn.commit()
        except Exception:
            pass
        # ──
        try:
            conn.execute(text("ALTER TABLE printers ADD COLUMN IF NOT EXISTS asset_id VARCHAR(100)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE printers ADD COLUMN IF NOT EXISTS ip_address VARCHAR(50)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE printers ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE printers ADD COLUMN IF NOT EXISTS equipment_type VARCHAR(30) DEFAULT 'impresora'"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE printers ADD COLUMN IF NOT EXISTS decommissioned_at DATE"))
            conn.execute(text("ALTER TABLE printers ADD COLUMN IF NOT EXISTS decommission_reason VARCHAR(50)"))
            conn.execute(text("ALTER TABLE printers ADD COLUMN IF NOT EXISTS replaced_by_id INTEGER REFERENCES printers(id)"))
            conn.commit()
        except Exception:
            pass
        # ── Suministros: lotes, entregas y líneas de despacho ──
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS supply_lots (
                    id SERIAL PRIMARY KEY,
                    item_code VARCHAR(100) NOT NULL,
                    item_name VARCHAR(255) NOT NULL,
                    supplier_id INTEGER REFERENCES suppliers(id),
                    entry_date DATE NOT NULL,
                    unit_cost VARCHAR(50) DEFAULT '0.00',
                    quantity_received INTEGER NOT NULL DEFAULT 1,
                    notes TEXT,
                    created_at TIMESTAMPTZ DEFAULT now(),
                    updated_at TIMESTAMPTZ
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS supply_deliveries (
                    id SERIAL PRIMARY KEY,
                    delivery_number VARCHAR(50),
                    delivery_date DATE NOT NULL,
                    contract_id INTEGER REFERENCES contracts(id),
                    client_id INTEGER REFERENCES users(id),
                    client_name VARCHAR(255),
                    invoice_id INTEGER REFERENCES invoices(id),
                    notes TEXT,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS supply_dispatches (
                    id SERIAL PRIMARY KEY,
                    delivery_id INTEGER NOT NULL REFERENCES supply_deliveries(id) ON DELETE CASCADE,
                    lot_id INTEGER NOT NULL REFERENCES supply_lots(id),
                    quantity_dispatched INTEGER NOT NULL DEFAULT 1,
                    serial_number VARCHAR(100),
                    exit_price VARCHAR(50) DEFAULT '0.00',
                    printer_id INTEGER REFERENCES printers(id),
                    printer_snapshot TEXT,
                    notes TEXT,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            """))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE supply_deliveries ADD COLUMN IF NOT EXISTS dispatch_condition VARCHAR(50)"))
            conn.execute(text("ALTER TABLE supply_deliveries ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(50)"))
            conn.commit()
        except Exception:
            pass
        # ── Vínculo pedido → factura para rentabilidad ──
        try:
            conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES users(id)"))
            conn.commit()
        except Exception:
            pass
        # ── Enum userrole: agregar 'supplies' si no existe ──
        try:
            exists = conn.execute(text(
                "SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='userrole' AND e.enumlabel='supplies'"
            )).fetchone()
            if not exists:
                conn.execute(text("ALTER TYPE userrole ADD VALUE 'supplies'"))
                conn.commit()
        except Exception:
            pass
        # ── Enum userrole: agregar 'supervisor' si no existe ──
        try:
            exists = conn.execute(text(
                "SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='userrole' AND e.enumlabel='supervisor'"
            )).fetchone()
            if not exists:
                conn.execute(text("ALTER TYPE userrole ADD VALUE 'supervisor'"))
                conn.commit()
        except Exception:
            pass
        # ── ticket_statuses.is_closed ──
        try:
            conn.execute(text("ALTER TABLE ticket_statuses ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT FALSE"))
            conn.execute(text("UPDATE ticket_statuses SET is_closed = TRUE WHERE name IN ('Resuelto', 'Cerrado')"))
            conn.commit()
        except Exception:
            pass
        # ── tickets.connection_type: campo retirado (Tipo de cargador) ──
        try:
            conn.execute(text("ALTER TABLE tickets DROP COLUMN IF EXISTS connection_type"))
            conn.commit()
        except Exception:
            pass
        # ── tickets.contact_id ──
        try:
            conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES contacts(id)"))
            conn.commit()
        except Exception:
            pass
        # ── ticket_attachments: soporte adjuntos Freshdesk vía proxy ──
        try:
            conn.execute(text("ALTER TABLE ticket_attachments ALTER COLUMN filename DROP NOT NULL"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE ticket_attachments ADD COLUMN IF NOT EXISTS fd_conversation_id BIGINT"))
            conn.execute(text("ALTER TABLE ticket_attachments ADD COLUMN IF NOT EXISTS fd_attachment_index INTEGER DEFAULT 0"))
            conn.commit()
        except Exception:
            pass
        # ── Contratos de soporte técnico (reemplaza campos MPS) ──
        for col, typedef in [
            ("service_scope",  "TEXT"),
            ("response_time",  "VARCHAR(50)"),
            ("coverage_hours", "VARCHAR(50)"),
            ("included_hours", "INTEGER DEFAULT 0"),
            ("included_visits","INTEGER DEFAULT 0"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE contracts ADD COLUMN IF NOT EXISTS {col} {typedef}"))
                conn.commit()
            except Exception:
                pass
        # ── Backfill closed_at para tickets resueltos sin fecha de cierre ──
        try:
            conn.execute(text("""
                UPDATE tickets
                SET closed_at = COALESCE(updated_at, created_at, NOW())
                WHERE closed_at IS NULL
                AND status_id IN (
                    SELECT id FROM ticket_statuses
                    WHERE LOWER(name) IN ('resuelto', 'resolved', 'cerrado', 'closed')
                )
            """))
            conn.commit()
        except Exception:
            pass

if not is_sqlite:
    _migrate_pg()

def _patch_categories():
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            conn.execute(text(
                "UPDATE ticket_categories SET name = 'Servicio técnico' WHERE name = 'Servicio técnico PC'"
            ))
            conn.commit()
        except Exception:
            pass

_patch_categories()

def _patch_statuses():
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            exists = conn.execute(text(
                "SELECT 1 FROM ticket_statuses WHERE name = 'Programado'"
            )).fetchone()
            if not exists:
                conn.execute(text(
                    "INSERT INTO ticket_statuses (name, color, icon, \"order\", is_default, is_active) "
                    "VALUES ('Programado', '#F97316', 'calendar-check', 9, 0, 1)"
                ))
                conn.commit()
        except Exception:
            pass

_patch_statuses()

def _patch_status_colors():
    from sqlalchemy import text
    with engine.connect() as conn:
        for name, color in [
            ('Programado',        '#F97316'),
            ('Esperando Detalles', '#EAB308'),
        ]:
            try:
                conn.execute(text(f"UPDATE ticket_statuses SET color = '{color}' WHERE name = '{name}'"))
                conn.commit()
            except Exception:
                pass

_patch_status_colors()


_CATEGORY_COLORS = {
    "Estándar":  "#3B82F6",  # blue
    "Premium":   "#F59E0B",  # amber
    "VIP":       "#8B5CF6",  # purple
    "Básico":    "#6B7280",  # gray
    "Platinum":  "#14B8A6",  # teal
    "Gold":      "#EAB308",  # yellow
}

def _patch_client_categories():
    """Create 'Estándar' category and assign it to all client users without a category."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        # Enforce canonical colors for known categories (fixes duplicates)
        for name, color in _CATEGORY_COLORS.items():
            cat = db.query(models.ClientCategory).filter(models.ClientCategory.name == name).first()
            if cat:
                cat.color = color
        db.commit()
        cat = db.query(models.ClientCategory).filter(models.ClientCategory.name == "Estándar").first()
        if not cat:
            cat = models.ClientCategory(name="Estándar", color=_CATEGORY_COLORS["Estándar"], order=1)
            db.add(cat)
            db.commit()
            db.refresh(cat)
        db.query(models.User).filter(
            models.User.role == models.UserRole.client,
            models.User.client_category_id.is_(None),
        ).update({"client_category_id": cat.id})
        db.commit()
    except Exception as e:
        logging.warning("_patch_client_categories error: %s", e)
    finally:
        db.close()

_patch_client_categories()


def _backfill_cost_price():
    """Populate cost_price on inventory items from orders already received."""
    import json as _json
    from database import SessionLocal
    db = SessionLocal()
    try:
        orders = db.query(models.Order).filter(
            models.Order.status == "Recibido",
            models.Order.inventory_applied == True,
        ).all()
        for order in orders:
            try:
                items = _json.loads(order.purchase_items or "[]")
            except Exception:
                continue
            order_ref = (order.order_number or f"PED-{order.id}").replace(" ", "")
            for idx, it in enumerate(items, start=1):
                code = (it.get("code") or "").strip() or f"{order_ref}-{idx}"
                purchase_price = float(it.get("unit_price") or 0)
                if purchase_price <= 0:
                    continue
                inv_item = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
                if not inv_item:
                    continue
                current_cost = float(inv_item.cost_price or "0") if inv_item.cost_price else 0.0
                if current_cost <= 0:
                    inv_item.cost_price = str(purchase_price)
        db.commit()
    except Exception as e:
        import logging
        logging.warning("_backfill_cost_price error: %s", e)
    finally:
        db.close()

_backfill_cost_price()


def _backfill_order_inventory():
    """Apply inventory for existing orders already marked Recibido before this feature was added."""
    import json as _json
    from database import SessionLocal
    db = SessionLocal()
    try:
        pending = db.query(models.Order).filter(
            models.Order.status == "Recibido",
            models.Order.inventory_applied == False,
        ).all()
        for order in pending:
            try:
                items = _json.loads(order.purchase_items or "[]")
            except Exception:
                continue
            for it in items:
                code = (it.get("code") or "").strip()
                if not code:
                    continue
                qty = float(it.get("qty") or 0)
                if qty <= 0:
                    continue
                inv_item = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
                if not inv_item:
                    continue
                try:
                    current = float(inv_item.quantity or "0")
                except (ValueError, TypeError):
                    current = 0.0
                new_qty = current + qty
                inv_item.quantity = f"{new_qty:.4f}".rstrip('0').rstrip('.') or "0"
            order.inventory_applied = True
        db.commit()
    except Exception as e:
        import logging
        logging.warning("_backfill_order_inventory error: %s", e)
    finally:
        db.close()

_backfill_order_inventory()


def _backfill_client_ids():
    """Link existing quotes/invoices to a portal client account (client_id) by matching
    client_email or client_name, so the client-facing '/my' lists don't depend purely on
    exact free-text matches going forward. Only touches rows that don't have a client_id yet."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        clients = db.query(models.User).filter(models.User.role == models.UserRole.client).all()
        by_email = {c.email.lower(): c for c in clients if c.email}
        by_name = {c.name.lower(): c for c in clients if c.name}
        by_company = {c.company.lower(): c for c in clients if c.company}

        for model in (models.Quote, models.Invoice):
            rows = db.query(model).filter(model.client_id.is_(None)).all()
            for row in rows:
                match = None
                if row.client_email:
                    match = by_email.get(row.client_email.lower())
                if not match and row.client_name:
                    match = by_name.get(row.client_name.lower()) or by_company.get(row.client_name.lower())
                if match:
                    row.client_id = match.id
        db.commit()
    except Exception as e:
        import logging
        logging.warning("_backfill_client_ids error: %s", e)
    finally:
        db.close()

_backfill_client_ids()


def _seed_fleet():
    """Importa la flota inicial (contratos + impresoras) una sola vez.
    Omitido en SQLite (desarrollo local) y cuando ya hay impresoras en la DB.
    Datos específicos de la organización DG: se salta si SEED_ORG_DATA=off
    (instancias de otros clientes arrancan sin la flota de DG)."""
    if os.getenv("SEED_ORG_DATA", "true").strip().lower() not in ("1", "true", "yes"):
        return
    if is_sqlite:
        return
    db = SessionLocal()
    try:
        if db.query(models.Printer).first():
            return  # ya hay impresoras, no re-importar

        # (num, company, ctype, warranty_start, warranty_end)
        CONTRACTS = [
            ("CONT-0001", "AES",             "MPS",     "2025-06-17", "2026-06-17"),
            ("CONT-0002", "Aseo Capital",    "MPS",     "2025-08-04", "2026-08-04"),
            ("CONT-0003", "Do it Center",    "MPS",     "2026-01-15", "2027-01-15"),
            ("CONT-0004", "Cardoze & Lindo", "Soporte", "2025-01-15", "2026-01-15"),
        ]
        from datetime import date as _date
        contract_ids = {}
        warranty_by_contract = {}
        for num, company, ctype, ws, we in CONTRACTS:
            c = db.query(models.Contract).filter(models.Contract.contract_number == num).first()
            if not c:
                c = models.Contract(contract_number=num, client_company=company,
                                    contract_type=ctype, status="Activo",
                                    billing_cycle="Mensual",
                                    rate_bw_page="0.00", rate_color_page="0.00",
                                    included_pages_bw=0, included_pages_color=0)
                db.add(c)
                db.flush()
            else:
                c.contract_type = ctype
                c.client_company = company
            contract_ids[num] = c.id
            warranty_by_contract[num] = (_date.fromisoformat(ws), _date.fromisoformat(we))

        # (contract_num, serial, model, location, ip, asset_id, contacts)
        PRINTERS = [
            ("CONT-0001","7559010002580","CX921de",  "Costa del Este - Torre Bladex - Piso 11 - Comunicación",    "10.249.162.10", "A0084","Gerardo Gonzalez / Fernando Villarreal"),
            ("CONT-0001","75290151497F1","CX625adhe","Costa del Este - Torre Bladex - Piso 11 - Recursos Humanos","10.249.162.13", "A0100","Gerardo Gonzalez / Fernando Villarreal"),
            ("CONT-0001","7529027149L81","CX625adhe","Costa del Este - Torre Bladex - Piso 11 - Finanzas",        "10.249.162.14", "A0087","Gerardo González / Fernando Villarreal"),
            ("CONT-0001","7559010001507","CX921de",  "Bayano - Administracion",                                   "10.249.170.242","",    "Fernando Villarreal"),
            ("CONT-0001","7018922305BTN","MX622adhe","Sala de Ctrl",                                              "10.249.170.244","",    ""),
            ("CONT-0001","7018922305BNL","MX622adhe","Bayano - Taller",                                           "10.249.170.246","",    ""),
            ("CONT-0001","7018922305BM4","MX622adhe","Colón - Central Térmica Costa Norte - PTA",                 "10.249.171.243","",    "Xavier Guevara"),
            ("CONT-0001","7018922305BN9","MX622adhe","Colón - Central Térmica Costa Norte - Almacén",             "10.249.171.244","",    "Xavier Guevara"),
            ("CONT-0001","7559010002581","CX921de",  "Colón - Central Térmica Costa Norte - Administración",      "10.249.171.245","",    "Xavier Guevara"),
            ("CONT-0001","7018914304P06","MX622adhe","Colón - Central Térmica Costa Norte - LOTO",                "10.249.171.249","A0088","Xavier Guevara"),
            ("CONT-0001","7018848003D3V","MX622adhe","Colón - Central Térmica Costa Norte - Sala de Control",     "10.249.171.250","",    "Xavier Guevara"),
            ("CONT-0001","7018917304ZWY","MX622adhe","Chiriquí - Gualaca - Planta Estí",                          "10.249.172.242","",    ""),
            ("CONT-0001","7559010002594","CX921de",  "Gualaca - Planta Estí - Administración",                    "10.249.172.243","",    ""),
            ("CONT-0001","7559010002588","CX921de",  "Penonomé - Eólico",                                         "10.249.173.242","",    ""),
            ("CONT-0001","7018848003DCL","MX622adhe","Almirante - Mini Hidro",                                    "10.249.174.242","",    "Arcadio Ávila"),
            ("CONT-0001","7559010002576","CX921de",  "Almirante - Central Hidroelectrica - Planta",               "10.249.174.243","",    "Arcadio Ávila"),
            ("CONT-0001","752924114RTV2","CX625adhe","Almirante - Operaciones",                                   "10.249.174.244","",    "Arcadio Ávila"),
            ("CONT-0001","7018922305BNC","MX622adhe","Almirante - Contenedores",                                  "10.249.174.246","",    "Arcadio Ávila"),
            ("CONT-0001","7529027149L3X","CX625adhe","Almirante - Central Hidrobiologica",                        "10.249.174.248","A0101","Arcadio Ávila"),
            ("CONT-0001","752923824R74D","CX522ade", "Almirante - Estación Hidrológica",                          "10.249.174.248","A1415","Arcadio Ávila"),
            ("CONT-0001","7559010002602","CX921de",  "Almirante - Central Hidroelectrica - Planta B",             "10.249.174.249","",    "Arcadio Ávila"),
            ("CONT-0001","75313400306RW","CX635adwe","Almirante - Estación Hidrológica - Modulares",              "10.249.174.250","",    "Arcadio Ávila"),
            ("CONT-0001","701810330CLZ9","MX622adhe","Chiriquí - Cedro y Caoba",                                  "10.249.72.210", "A0444","Jose Corella"),
            ("CONT-0001","701811440D1GD","MX622adhe","Azuero - Pesé",                                             "10.250.70.155", "A0436",""),
            ("CONT-0001","701810430CNW5","MX622adhe","Azuero - Mayorca",                                          "10.250.71.196", "A0445",""),
            ("CONT-0001","7018848003DM3","MX622adhe","Chiriqui - Los Valles",                                     "10.251.31.22",  "",    "Jose Corella"),
            ("CONT-0001","7018922305BN5","MX622adhe","Chiriquí - Caldera - Planta La Estrella",                   "10.251.31.6",   "",    "Jose Corella"),
            ("CONT-0001","7559010002603","CX921de",  "Planta La Estrella - Taller",                               "10.251.31.7",   "",    "Jose Corella"),
            ("CONT-0001","7531342030FXV","CX635adwe","Chiriquí - Cedro y Caoba B",                                "10.251.37.178", "",    "Jose Corella"),
            ("CONT-0001","7531342030FXP","CX635adwe","Planta Solar Pesé",                                         "192.168.2.162", "A1414",""),
            ("CONT-0002","701711640RLPX","MX521ade", "Cerro Tigre - Mantenimiento",                               "10.226.215.33", "A0689","Enos Reyes"),
            ("CONT-0002","701711140R56X","MX521ade", "Aseo Capital - Capira",                                     "186.188.161.49","A0868","Enos Reyes"),
            ("CONT-0002","701711140R56L","MX521ade", "Cerro Tigre - Operaciones",                                 "192.168.1.181", "A0687","Enos Reyes"),
            ("CONT-0002","701711140R58T","MX521ade", "Cerro Tigre - Almacén",                                     "192.168.1.253", "A0690","Enos Reyes"),
            ("CONT-0002","7564731010LNX","CX825",    "Cerro Tigre - Administración",                              "192.168.1.254", "A0411","Enos Reyes"),
            ("CONT-0002","701711140R57C","MX521ade", "Vista Alegre - CAU - Caja",                                 "192.168.4.25",  "A0688","Enos Reyes"),
            ("CONT-0003","701711640RKPX","MX521ade", "Dorado - Administración - Compras 2",                       "192.168.17.178","",    "Jose Luis Macías"),
            ("CONT-0003","701711640RLV6","MX521ade", "Dorado - Administración - Compras 1",                       "192.168.17.179","",    "Jose Luis Macías"),
            ("CONT-0003","75315170391BB","CX635adwe","Dorado - Las Terrazas",                                     "192.168.17.247","A2368","Lyanne"),
            ("CONT-0003","7559120002559","CX923de",  "El Dorado - Administración",                                "192.168.17.248","A0727","Cristal Victoria"),
            ("CONT-0003","701711640RLPV","MX521ade", "Dorado - Oficinas - Departamento Legal",                    "192.168.17.249","",    ""),
            ("CONT-0003","701711640RKRC","MX521ade", "Los Pueblos - Servicio Técnico",                            "192.168.172.241","A0588","Lourdes Mojica / Noel Laguna"),
            ("CONT-0003","701711140R561","MX521ade", "David - Sucursal San Mateo",                                "192.168.174.246","A0515","Jorge González / Alexander Pitti"),
            ("CONT-0003","752924214T4LD","CX625adhe","David - Sucursal San Mateo - Gerencia",                     "192.168.174.248","",    "Jorge González / Alexander Pitti"),
            ("CONT-0003","701824340HRYV","MX622adhe","David - Sucursal San Mateo - Recepción",                    "192.168.174.251","",    "Jorge González / Alexander Pitti"),
            ("CONT-0003","75313400306LC","CX635adwe","Sucursal Bugaba - Gerencia",                                "192.168.178.249","",    "Reymond Ríos"),
            ("CONT-0003","701823840H832","MX622adhe","Llano Bonito - Do It Pro",                                  "192.168.181.247","",    ""),
            ("CONT-0003","701711640RLW5","MX521ade", "Llano Bonito - Do It Pro",                                  "192.168.181.248","",    "Carlos Espinosa"),
            ("CONT-0003","7020404204F5Z","MX632adwe","Costa del Este - Town Center - Servicio al Cliente",        "192.168.184.247","A1503","Gabriel Cohen / Maria Flores"),
            ("CONT-0003","753134003070L","CX635adwe","Costa del Este - Town Center - Gerencia",                   "192.168.184.249","A2333","Gabriel Cohen / Maria Flores"),
            ("CONT-0003","701711640RLND","MX521ade", "Sucursal 12 de Octubre - Servicio al Cliente",              "192.169.100.246","A0523","Nekelda Abad / Franklin Aviles"),
            ("CONT-0003","752924114RTH0","CX625adhe","Sucursal 12 de Octubre - Gerencia",                         "192.169.100.248","",    "Nekelda Abad / Franklin Aviles"),
            ("CONT-0003","701831040L2R1","MX622adhe","Sucursal 12 de Octubre - Recepción",                        "192.169.100.251","A1034","Nekelda Abad / Franklin Aviles"),
            ("CONT-0003","701711540RF5R","MX521ade", "David - Sucursal Terronal - Servicio al Cliente",           "192.169.110.245","A0514","Karen Pitty / Erick Sanchez"),
            ("CONT-0003","752924214T4L6","CX625adhe","David - Sucursal Terronal - Gerencia",                      "192.169.110.248","",    "Karen Pitty / Erick Sanchez"),
            ("CONT-0003","701831040L389","MX622adhe","David - Sucursal Terronal - Recepción",                     "192.169.110.251","",    "Karen Pitty / Erick Sanchez"),
            ("CONT-0003","701711140R5C9","MX521ade", "Sucursal Albrook Mall - Servicio al cliente",               "192.169.126.246","A0530","Omaris Angulo / Yariela Peralta"),
            ("CONT-0003","752924214T4KN","CX625adhe","Sucursal Albrook Mall - Gerencia",                          "192.169.126.248","",    "Omaris Angulo / Yariela Peralta"),
            ("CONT-0003","701831240L8TW","MX622adhe","Sucursal Albrook Mall - Recepción",                         "192.169.126.251","",    "Omaris Angulo / Yariela Peralta"),
            ("CONT-0003","701711540RF19","MX521ade", "Sucursal Villa Lucre - Servicio al Cliente",                "192.169.128.246","A0527","Yaneth Ramos / Ashly de Gonzalez"),
            ("CONT-0003","752924014RFZ5","CX625adhe","Sucursal Villa Lucre - Gerencia",                           "192.169.128.248","",    "Yaneth Ramos / Ashly de Gonzalez"),
            ("CONT-0003","701823840H84T","MX622adhe","Sucursal Villa Lucre - Recepcion",                          "192.169.128.251","",    "Yaneth Ramos / Ashly de Gonzalez"),
            ("CONT-0003","701711540RFCR","MX521ade", "Sucursal Transistmica - Servicio al Cliente",               "192.169.132.246","A0532","Jose Luis Rivera / Federico González"),
            ("CONT-0003","752924214T4C9","CX625adhe","Sucursal Transistmica - Gerencia",                          "192.169.132.248","",    "Jose Luis Rivera / Federico González"),
            ("CONT-0003","701831240L8PG","MX622adhe","Sucursal Transistmica - Recepción",                         "192.169.132.251","",    "Jose Luis Rivera / Federico González"),
            ("CONT-0003","7529911142FRR","CX522ade", "Sucursal Los Pueblos - Gerencia - PRESTAMO",                "192.169.134.249","",    "Carlos Bernal / Flor Aguirre"),
            ("CONT-0003","752924214T4BY","CX625adhe","Sucursal Los Pueblos - Gerencia",                           "192.169.134.249","",    "Carlos Bernal / Flor Aguirre"),
            ("CONT-0003","701711540RGFY","MX521ade", "Sucursal Los Pueblos - Servicio al Cliente",                "192.169.134.250","A0525","Carlos Bernal / Flor Aguirre"),
            ("CONT-0003","701824240HNV9","MX622adhe","Sucursal Los Pueblos - Recepción",                          "192.169.134.251","",    "Carlos Bernal / Flor Aguirre"),
            ("CONT-0003","701711140R56R","MX521ade", "Sucursal Westland Mall - Servicio al Cliente",              "192.169.136.246","A0526","Marcos Sánchez / Gabriel González"),
            ("CONT-0003","752924214T4KL","CX625adhe","Sucursal Westland Mall - Gerencia",                         "192.169.136.248","",    "Marcos Sánchez / Gabriel González"),
            ("CONT-0003","701824240HNVB","MX622adhe","Sucursal Westland Mall - Recepción",                        "192.169.136.251","",    "Marcos Sánchez / Gabriel González"),
            ("CONT-0003","701711140R585","MX521ade", "Sucursal Centenial - Servicio al Cliente",                  "192.169.138.246","",    "Gaspar Molinar"),
            ("CONT-0003","752924114RTKH","CX625adhe","Sucursal Centenial - Gerencia",                             "192.169.138.248","A1031","Gaspar Molinar"),
            ("CONT-0003","701831040L3NL","MX622adhe","Sucursal Centenial - Recepcion",                            "192.169.138.251","A1030","Gaspar Molinar"),
            ("CONT-0003","701711640RLPN","MX521ade", "Sucursal Tocumen - Mañanitas - Servicio al Cliente",        "192.169.140.246","A0534","Nelson Sanjur / María González"),
            ("CONT-0003","752924114RTKD","CX625adhe","Sucursal Tocumen - Mañanitas - Gerencia",                   "192.169.140.248","A1023","Nelson Sanjur / María González"),
            ("CONT-0003","701831040L282","MX622adhe","Sucursal Tocumen - Mañanitas - Recepción",                  "192.169.140.251","A1026","Nelson Sanjur / María González"),
            ("CONT-0003","701711640RHRY","MX521ade", "Sucursal Chitré - Servicio al Cliente",                     "192.169.144.246","A0517","Marcos Ruíz / Yarivel Valdes"),
            ("CONT-0003","752924014RFVP","CX625adhe","Sucursal Chitré - Gerencia",                                "192.169.144.248","",    "Marcos Ruíz / Yarivel Valdes"),
            ("CONT-0003","701831040L27Z","MX622adhe","Sucursal Chitré - Recepción",                               "192.169.144.251","",    "Marcos Ruíz / Yarivel Valdes"),
            ("CONT-0003","701711140R5BH","MX521ade", "Colón - Sucursal Puerto Escondido - Servicio al Cliente",   "192.169.146.246","A0513","Yarixza Moreno"),
            ("CONT-0003","752924014RG06","CX625adhe","Colón - Sucursal Puerto Escondido - Gerencia",              "192.169.146.248","",    "Yarixza Moreno"),
            ("CONT-0003","701831040L280","MX622adhe","Colón - Sucursal Puerto Escondido - Recepcion",             "192.169.146.251","",    "Yarixza Moreno"),
            ("CONT-0003","701711640RLMH","MX521ade", "Sucursal La Doña - Servicio al Cliente",                    "192.169.148.246","A0533","Anastasio Herrera / Dayanara Pimental"),
            ("CONT-0003","752924114RTK2","CX625adhe","Sucursal La Doña - Gerencia",                               "192.169.148.248","A1029","Anastasio Herrera / Dayanara Pimental"),
            ("CONT-0003","701831040L3RG","MX622adhe","Sucursal La Doña - Recepción",                              "192.169.148.251","A1028","Anastasio Herrera / Dayanara Pimental"),
            ("CONT-0003","701711140R4RV","MX521ade", "Sucursal Costa Verde - Servicio al Cliente",                "192.169.150.246","A0528","Rosa Arias / Catalina Maiolini"),
            ("CONT-0003","752924014RG02","CX625adhe","Sucursal Costa Verde - Gerencia",                           "192.169.150.248","",    "Rosa Arias / Catalina Maiolini"),
            ("CONT-0003","701831240L8TV","MX622adhe","Sucursal Costa Verde - Recepcion",                          "192.169.150.251","",    "Rosa Arias / Catalina Maiolini"),
            ("CONT-0003","701711140R539","MX521ade", "Sucursal Santiago - Servicio al Cliente",                   "192.169.152.246","A0516","Victor Ducaza / Angel Rivas"),
            ("CONT-0003","752924214T47N","CX625adhe","Sucursal Santiago - Gerencia",                              "192.169.152.248","",    "Victor Ducaza / Angel Rivas"),
            ("CONT-0003","701831040L3NV","MX622adhe","Sucursal Santiago - Recepción",                             "192.169.152.251","",    "Victor Ducaza / Angel Rivas"),
            ("CONT-0003","701711140R57R","MX521ade", "Sucursal Villa Zaita - Servicio al Cliente",                "192.169.154.146","A0548","Erlyn Miranda / Richard Gutiérrez"),
            ("CONT-0003","752924014RG00","CX625adhe","Sucursal Villa Zaita - Gerencia",                           "192.169.154.248","",    "Erlyn Miranda / Richard Gutiérrez"),
            ("CONT-0003","701831140L70L","MX622adhe","Sucursal Villa Zaita - Recepción",                          "192.169.154.251","",    "Erlyn Miranda / Richard Gutiérrez"),
            ("CONT-0003","701711140R4PN","MX521ade", "Sucursal Coronado - Servicio al Cliente",                   "192.169.156.245","A0529","Rafeal Ayala / Marco Carrasco"),
            ("CONT-0003","752924114RTB8","CX625adhe","Sucursal Coronado - Gerencia",                              "192.169.156.248","",    "Rafeal Ayala / Marco Carrasco"),
            ("CONT-0003","701831240L8G1","MX622adhe","Sucursal Coronado - Recepción",                             "192.169.156.251","",    "Rafeal Ayala / Marco Carrasco"),
            ("CONT-0003","701711640RLV4","MX521ade", "Sucursal Aguadulce - Servicio al Cliente",                  "192.169.158.245","A0519","Yeisy Caseres / Liz Muñoz"),
            ("CONT-0003","752924214T3ZZ","CX625adhe","Sucursal Aguadulce - Gerencia",                             "192.169.158.248","",    "Yeisy Caseres / Liz Muñoz"),
            ("CONT-0003","701824240HNTK","MX622adhe","Sucursal Aguadulce - Recepcion",                            "192.169.158.251","",    "Yeisy Caseres / Liz Muñoz"),
            ("CONT-0003","701711140R580","MX521ade", "Sucursal Brisas del Golf - Servicio al Cliente",            "192.169.160.246","A0522","Yaneth Ramos / Kevin Navarro"),
            ("CONT-0003","752924214T49X","CX625adhe","Sucursal Brisas del Golf - Gerencia",                       "192.169.160.248","",    "Juan Carlos Sanchez / Kevin Navarro"),
            ("CONT-0003","701831140L72R","MX622adhe","Sucursal Brisas del Golf - Recepción",                      "192.169.160.251","",    "Juan Carlos Sanchez / Kevin Navarro"),
            ("CONT-0003","7531342030FVW","CX635adwe","Sucursal Burunga - Gerencia",                               "192.169.162.193","",    "Manuel Intriago"),
            ("CONT-0003","701711540RGRX","MX521ade", "Sucursal Penonomé - Servicio al Cliente",                   "192.169.164.245","A0518","Claritza Gonzalez / Génesis Acuña"),
            ("CONT-0003","752924214T4KK","CX625adhe","Sucursal Penonomé - Gerencia",                              "192.169.164.248","",    "Claritza Gonzalez / Génesis Acuña"),
            ("CONT-0003","701831040L24B","MX622adhe","Sucursal Penonomé - Recepcion",                             "192.169.164.251","",    "Claritza Gonzalez / Génesis Acuña"),
            ("CONT-0003","701711640RLP0","MX521ade", "Colón - Sucursal Sabanitas - Servicio al Cliente",          "192.169.166.246","A0512","Yolidia Segura / Kevin Small"),
            ("CONT-0003","752924014RG01","CX625adhe","Colón - Sucursal Sabanitas - Gerencia",                     "192.169.166.248","",    "Yolidia Segura / Kevin Small"),
            ("CONT-0003","701831040L272","MX622adhe","Colón - Sucursal Sabanitas - Recepción",                    "192.169.166.251","",    "Yolidia Segura / Kevin Small"),
            ("CONT-0003","701711640RLPH","MX521ade", "Sucursal Dorado - Atención al Cliente",                     "192.169.20.246", "A0538","Benjamin Justavino / Oscar Mathews"),
            ("CONT-0003","752924114RTCC","CX625adhe","Sucursal Dorado - Gerencia",                                "192.169.20.248", "",    "Benjamin Justavino / Oscar Mathews"),
            ("CONT-0003","701823340GV1C","MX622adhe","Sucursal Dorado - Recepcion",                               "192.169.20.251", "",    "Benjamin Justavino / Oscar Mathews"),
            ("CONT-0003","701711140R4PP","MX521ade", "Sucursal Rio Abajo - Atención al Cliente",                  "192.169.30.246", "A0524","Eleisa Igleisa / Patricia Chávez"),
            ("CONT-0003","752924114RTKG","CX625adhe","Sucursal Río Abajo - Gerencia",                             "192.169.30.248", "A1022","Eleisa Igleisa / Patricia Chávez"),
            ("CONT-0003","701831040L3RC","MX622adhe","Sucursal Río Abajo - Recepción",                            "192.169.30.251", "A1021","Eleisa Igleisa / Patricia Chávez"),
            ("CONT-0003","701822640GBCT","MX622adhe","Prestamo - Sucursal Los Andes - Servicio al Cliente",       "192.169.70.246", "",    "Adelaida Paz / Erick Rouse"),
            ("CONT-0003","701711640RLPL","MX521ade", "Sucursal Los Andes - Servicio al Cliente",                  "192.169.70.246", "A0531","Adelaida Paz / Erick Rouse"),
            ("CONT-0003","752924214T4KW","CX625adhe","Sucursal Los Andes - Gerencia",                             "192.169.70.248", "",    "Adelaida Paz / Erick Rouse"),
            ("CONT-0003","701831140L6ZH","MX622adhe","Sucursal Los Andes - Recepción",                            "192.169.70.251", "",    "Adelaida Paz / Erick Rouse"),
            ("CONT-0003","701711640RLMG","MX521ade", "Sucursal Multiplaza - Servicio al Cliente",                 "192.169.80.246", "A0520","Karl Montoya / Richard Gutiérrez"),
            ("CONT-0003","752924114RTKX","CX625adhe","Sucursal Multiplaza - Gerencia",                            "192.169.80.248", "A1024","Karl Montoya / Richard Gutiérrez"),
            ("CONT-0003","701831040L3NM","MX622adhe","Sucursal Multiplaza - Recepción",                           "192.169.80.251", "A1020","Karl Montoya / Richard Gutiérrez"),
            ("CONT-0004","7020404204D8L","MX632adwe","Plantas Eléctricas",  "192.168.10.42",  "A2343","Eduardo Carrasquilla / Vladimir Batista"),
            ("CONT-0004","7530409512GVT","CX735adse","Mercadeo",            "192.168.10.214", "",    "Eduardo Carrasquilla / Vladimir Batista"),
            ("CONT-0004","7530337311RM5","CX735adse","Gerencia",            "192.168.10.216", "A2339","Eduardo Carrasquilla / Vladimir Batista"),
            ("CONT-0004","753020311018N","CX735adse","Mostrador",           "192.168.10.218", "A2338","Eduardo Carrasquilla / Vladimir Batista"),
            ("CONT-0004","75313410309V4","CX635adwe","Oficina Ana Raquel",  "192.168.10.221", "",    "Eduardo Carrasquilla / Vladimir Batista"),
            ("CONT-0004","7530405512DR7","CX735adse","Creditos y Cobros",   "192.168.10.222", "A2340","Eduardo Carrasquilla / Vladimir Batista"),
        ]

        MPS_CONTRACTS = {"CONT-0001", "CONT-0002", "CONT-0003"}
        created = 0
        from routers.inventory import _log_inventory_txn

        for cnum, serial, model, location, ip, asset_id, contacts in PRINTERS:
            existing = db.query(models.Printer).filter(models.Printer.serial_number == serial).first()
            if existing:
                continue
            ownership = "alquiler" if cnum in MPS_CONTRACTS else "cliente"
            w_start, w_end = warranty_by_contract.get(cnum, (None, None))
            p = models.Printer(
                brand="Lexmark", model=model, serial_number=serial,
                ownership_type=ownership, contract_id=contract_ids[cnum],
                asset_id=asset_id or None,
                ip_address=ip or None,
                contact_name=contacts or None,
                warranty_start_date=w_start,
                warranty_end_date=w_end,
                location=location, status="Activa",
            )
            db.add(p)
            db.flush()
            if ownership == "alquiler":
                code = f"PRN-{serial}"
                item = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
                if not item:
                    item = models.InventoryItem(
                        code=code, name=f"Lexmark {model}",
                        quantity="1", warehouse="impresoras_mps",
                        category="Impresora MPS", is_active=True,
                    )
                    db.add(item)
                    db.flush()
                    _log_inventory_txn(db, code, 1, source_type="printer_alquiler",
                                       source_id=p.id, notes="Importación masiva flota")
                p.inventory_item_id = item.id
            created += 1

        db.commit()
        logging.info("_seed_fleet: %d impresoras importadas", created)
    except Exception as e:
        db.rollback()
        logging.warning("_seed_fleet error: %s", e)
    finally:
        db.close()

if not is_sqlite:
    _seed_fleet()

def _patch_fleet_brand():
    """Corrige marca Kyocera → Lexmark en printers e inventory."""
    if is_sqlite:
        return
    db = SessionLocal()
    try:
        from sqlalchemy import text as _t
        db.execute(_t("UPDATE printers SET brand = 'Lexmark' WHERE brand = 'Kyocera'"))
        db.execute(_t("UPDATE inventory SET name = REPLACE(name, 'Kyocera ', 'Lexmark ') WHERE name LIKE 'Kyocera %'"))
        db.commit()
    except Exception as e:
        db.rollback()
        logging.warning("_patch_fleet_brand error: %s", e)
    finally:
        db.close()

if not is_sqlite:
    _patch_fleet_brand()

def _patch_printer_ip():
    """Extrae 'IP: x.x.x.x' de notes → ip_address y limpia notes."""
    if is_sqlite:
        return
    import re
    db = SessionLocal()
    try:
        printers = db.query(models.Printer).filter(
            models.Printer.ip_address.is_(None),
            models.Printer.notes.isnot(None),
        ).all()
        updated = 0
        for p in printers:
            m = re.search(r'IP:\s*([\d.]+)', p.notes or '')
            if m:
                p.ip_address = m.group(1)
                p.notes = re.sub(r'\s*\|\s*IP:\s*[\d.]+|IP:\s*[\d.]+\s*\|\s*', '', p.notes).strip(' |')
                if not p.notes:
                    p.notes = None
                updated += 1
        db.commit()
        logging.info("_patch_printer_ip: %d registros actualizados", updated)
    except Exception as e:
        db.rollback()
        logging.warning("_patch_printer_ip error: %s", e)
    finally:
        db.close()

if not is_sqlite:
    _patch_printer_ip()

def _patch_printer_contact():
    """Extrae 'Contacto: ...' de notes → contact_name y limpia notes."""
    if is_sqlite:
        return
    import re
    db = SessionLocal()
    try:
        printers = db.query(models.Printer).filter(
            models.Printer.contact_name.is_(None),
            models.Printer.notes.isnot(None),
        ).all()
        updated = 0
        for p in printers:
            m = re.search(r'Contacto:\s*([^|]+)', p.notes or '')
            if m:
                p.contact_name = m.group(1).strip()
                p.notes = re.sub(r'\s*\|\s*Contacto:\s*[^|]+|Contacto:\s*[^|]+\s*\|\s*', '', p.notes).strip(' |')
                if not p.notes:
                    p.notes = None
                updated += 1
        db.commit()
        logging.info("_patch_printer_contact: %d registros actualizados", updated)
    except Exception as e:
        db.rollback()
        logging.warning("_patch_printer_contact error: %s", e)
    finally:
        db.close()

if not is_sqlite:
    _patch_printer_contact()

def _patch_printer_asset():
    """Extrae 'Activo: ...' de notes → asset_id y limpia notes."""
    if is_sqlite:
        return
    import re
    db = SessionLocal()
    try:
        printers = db.query(models.Printer).filter(
            models.Printer.asset_id.is_(None),
            models.Printer.notes.isnot(None),
        ).all()
        updated = 0
        for p in printers:
            m = re.search(r'Activo:\s*([^|]+)', p.notes or '')
            if m:
                p.asset_id = m.group(1).strip()
                p.notes = re.sub(r'\s*\|\s*Activo:\s*[^|]+|Activo:\s*[^|]+\s*\|\s*', '', p.notes).strip(' |')
                if not p.notes:
                    p.notes = None
                updated += 1
        db.commit()
        logging.info("_patch_printer_asset: %d registros actualizados", updated)
    except Exception as e:
        db.rollback()
        logging.warning("_patch_printer_asset error: %s", e)
    finally:
        db.close()

if not is_sqlite:
    _patch_printer_asset()

def _patch_cardoze_contracts():
    """Consolida CONT-0005..0009 (duplicados de Cardoze) en CONT-0004 y los elimina."""
    if is_sqlite:
        return
    db = SessionLocal()
    try:
        main_contract = db.query(models.Contract).filter(
            models.Contract.contract_number == "CONT-0004"
        ).first()
        if not main_contract:
            return
        duplicates = db.query(models.Contract).filter(
            models.Contract.contract_number.in_(
                ["CONT-0005", "CONT-0006", "CONT-0007", "CONT-0008", "CONT-0009"]
            )
        ).all()
        if not duplicates:
            return
        dup_ids = [c.id for c in duplicates]
        db.query(models.Printer).filter(
            models.Printer.contract_id.in_(dup_ids)
        ).update({"contract_id": main_contract.id}, synchronize_session=False)
        for c in duplicates:
            db.delete(c)
        db.commit()
        logging.info("_patch_cardoze_contracts: %d contratos duplicados eliminados", len(duplicates))
    except Exception as e:
        db.rollback()
        logging.warning("_patch_cardoze_contracts error: %s", e)
    finally:
        db.close()

if not is_sqlite:
    _patch_cardoze_contracts()

def _patch_clear_legacy_notes():
    """Elimina residuos IP/Activo/Contacto de notes que ya tienen campo dedicado."""
    if is_sqlite:
        return
    import re
    db = SessionLocal()
    try:
        printers = db.query(models.Printer).filter(models.Printer.notes.isnot(None)).all()
        updated = 0
        for p in printers:
            n = p.notes or ''
            n = re.sub(r'IP:\s*[\d.]+', '', n)
            n = re.sub(r'Activo:\s*\S+', '', n)
            n = re.sub(r'Contacto:\s*[^|]+', '', n)
            n = re.sub(r'(\s*\|\s*)+', '|', n).strip(' |').strip()
            final = n or None
            if final != p.notes:
                p.notes = final
                updated += 1
        db.commit()
        logging.info("_patch_clear_legacy_notes: %d registros actualizados", updated)
    except Exception as e:
        db.rollback()
        logging.warning("_patch_clear_legacy_notes error: %s", e)
    finally:
        db.close()

if not is_sqlite:
    _patch_clear_legacy_notes()

def _patch_warranty_dates():
    """Asigna warranty_start_date y warranty_end_date según el CSV de flota."""
    if is_sqlite:
        return
    from datetime import date as _d
    CONTRACT_DATES = {
        "CONT-0001": (_d(2025, 6, 17), _d(2026, 6, 17)),
        "CONT-0002": (_d(2025, 8, 4),  _d(2026, 8, 4)),
        "CONT-0003": (_d(2026, 1, 15), _d(2027, 1, 15)),
        "CONT-0004": (_d(2025, 1, 15), _d(2026, 1, 15)),
    }
    # Equipos con fechas distintas a las del contrato (excepción por serial)
    SERIAL_OVERRIDE = {
        "701711640RLPX": (_d(2026, 8, 4), _d(2027, 8, 4)),
    }
    db = SessionLocal()
    try:
        updated = 0
        for cnum, (ws, we) in CONTRACT_DATES.items():
            contract = db.query(models.Contract).filter(
                models.Contract.contract_number == cnum
            ).first()
            if not contract:
                continue
            rows = db.query(models.Printer).filter(
                models.Printer.contract_id == contract.id
            ).update({"warranty_start_date": ws, "warranty_end_date": we},
                     synchronize_session=False)
            updated += rows
        for serial, (ws, we) in SERIAL_OVERRIDE.items():
            p = db.query(models.Printer).filter(
                models.Printer.serial_number == serial
            ).first()
            if p:
                p.warranty_start_date = ws
                p.warranty_end_date = we
                updated += 1
        db.commit()
        logging.info("_patch_warranty_dates: %d impresoras actualizadas", updated)
    except Exception as e:
        db.rollback()
        logging.warning("_patch_warranty_dates error: %s", e)
    finally:
        db.close()

if not is_sqlite:
    _patch_warranty_dates()


def _seed_supply_lots():
    """Carga inicial del inventario de suministros desde CSV 2026-06-17. Idempotente.
    Datos específicos de DG: se salta si SEED_ORG_DATA=off."""
    if os.getenv("SEED_ORG_DATA", "true").strip().lower() not in ("1", "true", "yes"):
        return
    from datetime import date as _d
    db = SessionLocal()
    try:
        if db.query(models.SupplyLot).count() > 0:
            return
        ENTRY_DATE = _d(2026, 6, 17)
        LOTS = [
            ('201382', 'Clover - Genérico - Tóner Negro - MX711', '92.00', 1),
            ('40X7540', 'Kit de Mantenimiento 160K - C950 / X950', '207.50', 4),
            ('40X7582', 'Transfer Roller - MS811 / MX711', '21.10', 3),
            ('40X7593', 'Pickup Roller Assembly - MS811 / MX711', '4.75', 8),
            ('40X7706', 'Roller Kit - MS811 / MX711', '100.00', 2),
            ('40X7713', 'Separation Roller Assembly - MS811 / MX711', '9.43', 15),
            ('40X8080', 'Laser Scanning Unit - MX511', '98.84', 1),
            ('40X8083', 'Cartridge Gearbox - MX511', '33.75', 1),
            ('40X8420', 'Kit de Mantenimiento Fusor - MX711 / MS811', '264.97', 1),
            ('40X8819', 'MFP Fuser Deflector Flag - CX522 / CX625', '2.17', 7),
            ('40X9046', 'Fusor - MX910', '1057.49', 1),
            ('40X9055', 'Flatbed Scanner, Legal - MX511', '383.00', 1),
            ('40X9093', 'ADF - MX511 / MX611', '473.96', 1),
            ('40X9672', 'Kit de Mantenimiento ADF - MX910', '81.71', 5),
            ('40X9673', 'Kit de Mantenimiento de Alimentador Multipropósito - MX910', '143.67', 7),
            ('40X9704', 'Kit de Mantenimiento de Unidad de Imagen - MX910', '290.50', 6),
            ('40X9929', 'Banda de Transferencia - CS725 / CX725', '318.55', 1),
            ('40X9936', 'Kit de Mantenimiento 3 - Unidad Reveladora - MX910 / MX912', '307.00', 1),
            ('41X0207', 'Control Panel Button Kit 7" - CX625 / CX725 / MX622 / MX722', '23.98', 1),
            ('41X0237', 'Controller Card - CX825', '1506.50', 1),
            ('41X0396', 'Paper Feeder - CS725 / CX725 / CX735', '71.00', 1),
            ('41X0425', 'Low Voltage Power Supply (LVPS) - CS725 / CX725', '179.88', 2),
            ('41X0554', 'Kit de Mantenimiento Fusor - CS725 / CX725', '290.93', 1),
            ('41X0756', 'Operator Panel - MX611', '217.00', 1),
            ('41X0917', 'ADF Separator Roll - MX511 / MX611 / CX522 / CX725', '11.19', 9),
            ('41X0928', 'Kit de Mantenimiento Fusor & Banda de Transferencia 300K - CX825', '919.61', 2),
            ('41X0931', 'Kit de Mantenimiento ADF - CX825', '63.00', 1),
            ('41X0956', 'Pick Roller - CX725 / CX735', '28.95', 15),
            ('41X1039', 'Banda de Transferencia - CX522 / CX625 / CX635', '288.94', 1),
            ('41X1039', 'Banda de Transferencia - CX522 / CX625 / CX635', '304.75', 1),
            ('41X1108', 'Pickup Roller Assembly - MX722 / MS826', '8.45', 3),
            ('41X1147', 'Controller Board - MX722', '806.36', 1),
            ('41X1150', 'Control Panel 7" Board - CX625 / CX725 / MX622 / MX722', '241.28', 2),
            ('41X1197', 'MPF Pick Roller & Separator Pad - MS622 / MS632 / MX521 / MX622 / MX632', '0.00', 1),
            ('41X1198', 'Pick Tire Roller - MS622 / MS632 / MX622 / MX632', '8.63', 4),
            ('41X1212', 'Separator Roller - MS622 / MS632 / MX521 / MX622 / MX632', '28.36', 2),
            ('41X1212', 'Separator Roller - MS622 / MS632 / MX521 / MX622 / MX632', '28.70', 5),
            ('41X1212', 'Separator Roller - MS622 / MS632 / MX521 / MX622 / MX632', '30.65', 5),
            ('41X1214', 'Reverse Solenoid - MS622 / MS632 / MX521 / MX622 / MX632', '16.79', 9),
            ('41X1223', 'Pick Roller Assembly - MX521', '29.56', 5),
            ('41X1224', 'Main Drive Gearbox - MS622 / MS632 / MX521 / MX622 / MX632', '165.09', 1),
            ('41X1225', 'Kit de Mantenimiento Fusor - MS622 / MS632 / MX521 / MX622 / MX632', '234.60', 6),
            ('41X1322', 'ADF Restraint Pad - CX625 / MX622', '1.00', 1),
            ('41X1325', 'ADF Separator Roll - CX625 / MX622', '11.09', 2),
            ('41X1326', 'ADF Pick Roll - CX625 / MX622', '26.57', 6),
            ('41X1359', '4.3" Control Panel Assembly - CX522 / MX521', '197.11', 1),
            ('41X1505', 'Fusor - CX923', '662.71', 1),
            ('41X1594', 'Unidad Reveladora Color - CX921 / CX923', '2802.99', 1),
            ('41X1598', 'Unidad Reveladora Negro - CX921 / CX923', '202.68', 1),
            ('41X1628', 'Control Panel Display Assembly - MS622', '29.73', 1),
            ('41X1860', 'Fusor - CX921', '536.00', 1),
            ('41X2090', 'Kit de Mantenimiento Transfer Belt 300K - CX923', '374.15', 1),
            ('41X2096', 'Kit de Mantenimiento Fusor - CX522 / CX532 / CX625', '178.25', 1),
            ('41X2224', 'ADF Separator Roller - MX521', '12.65', 4),
            ('41X2250', 'Kit de Mantenimiento Fusor - MX722 / MS826', '378.94', 3),
            ('41X2276', 'Operator Panel Card 10" - CX825 / CX921 / CX923', '409.76', 3),
            ('41X2307', 'Sensor Flag - CX522 / CX625', '3.20', 7),
            ('41X2315', 'Control Panel Cable - MX722', '16.08', 1),
            ('41X2514', 'Controller Board - MX521', '323.13', 1),
            ('41X2689', 'Banda de Transferencia - CX735', '286.80', 1),
            ('41X2848', 'Kit de Mantenimiento ADF - CX532 / CX635 / CX735 / MX632', '33.35', 1),
            ('41X2855', 'ADF Separator Roller - CX625 / MX622', '14.00', 4),
            ('41X2855', 'ADF Separator Roller - CX625 / MX622', '14.54', 1),
            ('41X2855', 'ADF Separator Roller - CX625 / MX622', '15.53', 2),
            ('41X2881', 'Control Panel Display 10" - CX735 / CX942 / CX944', '256.45', 1),
            ('41X3322', 'Unidad Reveladora - CX942 / CX944', '419.75', 1),
            ('41X3336', 'Banda de Transferencia - CX942 / CX944', '865.25', 1),
            ('41X3345', 'Fusor - CX942 / CX944', '591.84', 1),
            ('41X3882', 'Kit de Mantenimiento Fusor - CX735', '431.08', 1),
            ('41X4214', 'Duplex Gear Kit - MS622 / MX321 / MX521 / MX622 / MX632', '8.83', 11),
            ('41X4369', 'ADF - CX635 / MX632', '431.25', 1),
            ('41X4453', 'Kit de Sensor Flag - MS622 / MX511 / MX611 / MX622 / MX632', '34.21', 1),
            ('41X5000', 'Kit de Mantenimiento Fusor - CX635', '216.20', 1),
            ('50F0Z00', 'Unidad de Imagen - MS415 / MX511 / MX611', '50.52', 3),
            ('50F4H00', 'Tóner Negro High - MS310 / MX310 / MS415', '94.86', 1),
            ('50F4X00', 'Tóner Negro Extra High - MX310 / MS415 / MX511 / MX611', '108.59', 9),
            ('52D0Z00', 'Unidad de Imagen - MS810 / MS811 / MX711', '54.03', 2),
            ('52D4H00', 'Tóner Negro High - MS810 / MS811 / MX711', '127.31', 1),
            ('54G0P00', 'Fotoconductor - MX910', '60.05', 1),
            ('55B0ZA0', 'Unidad de Imagen - MX331', '62.42', 2),
            ('55B0ZA0', 'Unidad de Imagen - MX331', '73.76', 2),
            ('55B4H00', 'Tóner Negro High - MX331', '152.00', 4),
            ('56F0Z00', 'Unidad de Imagen - MX521 / MS622 / MX622', '73.76', 29),
            ('56F4U00', 'Tóner Negro Ultra High - MS622 / MX521 / MX622', '112.25', 75),
            ('58D0Z00', 'Unidad de Imagen - MX722 / MS826', '74.00', 2),
            ('58D4U00', 'Tóner Negro Ultra High - MX722 / MS826', '236.90', 19),
            ('63D0Z00', 'Fotoconductor - MX931', '128.60', 3),
            ('66S0Z00', 'Unidad de Imagen - MS632 / MX632', '46.44', 3),
            ('66S4X00', 'Tóner Negro Extra High - MS632 / MX632', '144.35', 29),
            ('71C0W00', 'Waste Toner - CX735', '30.30', 5),
            ('71C0Z10', 'Unidad de Imagen Negro - CX735', '74.64', 5),
            ('71C0Z50', 'Kit de Imagen Color - CX735', '225.86', 2),
            ('71C0Z50', 'Kit de Imagen Color - CX735', '248.45', 1),
            ('72K0DC0', 'Revelador Cyan - CX825', '80.00', 1),
            ('72K0DM0', 'Revelador Magenta - CX825', '80.00', 2),
            ('72K0DV0', 'Developer Color Kit Unit (3) - CX825', '198.77', 6),
            ('72K0DY0', 'Revelador Amarillo - CX825', '80.00', 5),
            ('72K0P00', 'Fotoconductor - CX825', '81.42', 7),
            ('72K0W00', 'Waste Toner - CX825', '33.14', 10),
            ('72K4XC0', 'Tóner Cyan Extra High - CX825', '231.94', 1),
            ('72K4XM0', 'Tóner Magenta Extra High - CX825', '231.94', 2),
            ('72K4XY0', 'Tóner Amarillo Extra High - CX825', '231.94', 6),
            ('73D0P00', 'Fotoconductor Black / Color - CX942 / CX944', '153.66', 2),
            ('73D0Q00', 'Fotoconductor Black / Color (3) - CX942', '460.99', 4),
            ('73D0W00', 'Waste Toner - CX942 / CX944', '14.11', 10),
            ('74C0W00', 'Waste Toner - CX725 / CS725', '29.26', 3),
            ('74C0ZK0', 'Fotoconductor Negro - CS725 / CX725', '83.29', 1),
            ('74C0ZV0', 'Kit de Imagen Negro / Color - CS725 / CX725', '277.24', 2),
            ('74C4HC0', 'Tóner Cyan High - CS725', '140.32', 2),
            ('74C4HK0', 'Tóner Negro High - CS725', '106.09', 7),
            ('74C4HM0', 'Tóner Magenta High - CS725', '145.00', 4),
            ('74C4HM0', 'Tóner Magenta High - CS725', '184.07', 2),
            ('75M0W00', 'Botella de Desecho - CX532 / CX635', '20.09', 11),
            ('75M0ZV0', 'Kit de Imagen Color - CX532 / CX635', '206.03', 1),
            ('75M4HC0', 'Tóner Cyan High - CX532', '177.67', 2),
            ('75M4HK0', 'Tóner Negro High - CX532', '165.82', 1),
            ('75M4HM0', 'Tóner Magenta High - CX532', '177.67', 2),
            ('75M4HY0', 'Tóner Amarillo High - CX532', '177.67', 2),
            ('75M4XC0', 'Tóner Cyan Extra High - CX635', '47.40', 2),
            ('75M4XC0', 'Tóner Cyan Extra High - CX635', '110.81', 9),
            ('75M4XC0', 'Tóner Cyan Extra High - CX635', '115.84', 2),
            ('75M4XK0', 'Tóner Negro Extra High - CX635', '97.86', 8),
            ('75M4XM0', 'Tóner Magenta Extra High - CX635', '47.40', 2),
            ('75M4XM0', 'Tóner Magenta Extra High - CX635', '110.81', 7),
            ('75M4XY0', 'Tóner Amarillo Extra High - CX635', '47.40', 1),
            ('75M4XY0', 'Tóner Amarillo Extra High - CX635', '110.81', 6),
            ('76C0HC0', 'Tóner Cyan High - CX921 / CX923', '281.50', 1),
            ('76C0HM0', 'Tóner Magenta High - CX921 / CX923', '282.50', 3),
            ('76C0HY0', 'Tóner Amarillo High - CX921 / CX923', '281.50', 3),
            ('76C0HY0', 'Tóner Amarillo High - CX921 / CX923', '282.50', 1),
            ('78C0W00', 'Botella de Desecho - CX522 / CX625', '35.40', 1),
            ('78C4UC0', 'Tóner Cyan Ultra High - CX625', '131.00', 2),
            ('78C4UK0', 'Tóner Negro Ultra High - CX625', '81.13', 3),
            ('78C4UM0', 'Tóner Magenta Ultra High - CX625', '131.00', 2),
            ('78C4XC0', 'Tóner Cyan Extra High - CX522 / CX625', '127.62', 3),
            ('78C4XM0', 'Tóner Magenta Extra High - CX522 / CX625', '127.62', 2),
            ('78C4XY0', 'Tóner Amarillo Extra High - CX522 / CX625', '127.62', 1),
            ('81C8XC0', 'Tóner Cyan Extra High - CX735', '225.57', 3),
            ('81C8XK0', 'Tóner Negro Extra High - CX735', '177.67', 5),
            ('81C8XM0', 'Tóner Magenta Extra High - CX735', '225.57', 8),
            ('81C8XY0', 'Tóner Amarillo Extra High - CX735', '225.57', 6),
            ('83D0HK0', 'Tóner Negro High - CX942 / CX944', '210.86', 7),
            ('83D0HM0', 'Tóner Magenta High - CX942 / CX944', '231.94', 7),
            ('83D0HY0', 'Tóner Amarillo High - CX942 / CX944', '231.94', 5),
            ('84C4HC0', 'Tóner Cyan High - CX725', '150.22', 2),
            ('84C4HK0', 'Tóner Negro High - CX725', '113.59', 3),
            ('84C4HM0', 'Tóner Magenta High - CX725', '150.22', 6),
            ('84C4HY0', 'Tóner Amarillo High - CX725', '150.22', 4),
            ('BRD03709R06', 'MainBoard New PCB4layer+FW for PRT620/626 T13', '0.01', 10),
            ('C12C937181', 'EPSON AM-C4000-5000-6000 Maint Box', '42.00', 1),
            ('C12C937201', 'EPSON WF-AM C400 / C550 Maintenance Box', '45.00', 1),
            ('C12C938211', 'EPSON Mantenimiento KIT - WF - C5810-90', '20.00', 1),
            ('PRK6287-6', 'N6 SP40Plus Black Ribbon 10MC', '13.23', 290),
            ('SP-78413280', 'Print Head 24 with Edge Sensor', '0.10', 2),
            ('SP-78413314R01', 'FRONT BED 1 SP40PLUS', '0.10', 1),
            ('SP-78413340R04', 'Mylar Assy', '0.10', 2),
            ('SP-78413489R01', 'Ribbon Cable SP40Plus Spare', '0.10', 3),
            ('SP-BRD00785R00', 'PWA 2SENP40P SP40PLUS', '0.01', 15),
            ('SP-BRD02190R01', 'Universal Power Supply for SP40 Plus', '0.10', 2),
            ('SP-HEADCABLER00', 'Head Cable Spare SP40Plus', '0.10', 3),
            ('SP-KITSPRINGR04', 'KIT SPRING SP40PLUS', '0.10', 1),
            ('SP-RIBBONDRIR07', 'Kit Ribbon Drive Spare SP40Plus', '0.10', 2),
            ('SP-SUB00283R03', 'FIBER SUPPORT+HOOK Bracket SP40PLUS', '0.10', 3),
            ('T08D120', 'Tinta Negra Alto Rendimiento - AM-C4000', '145.00', 1),
            ('T08D220', 'Tinta Cyan Alto Rendimiento - AM-C4000', '152.00', 1),
            ('T08D320', 'Tinta Magenta Alto Rendimiento - AM-C4000', '152.00', 1),
            ('T08D420', 'Tinta Amarilla Alto Rendimiento - AM-C4000', '152.00', 1),
            ('T08M100', 'WorkForce WF-AM C550 Black', '111.00', 1),
        ]
        for code, name, cost, qty in LOTS:
            db.add(models.SupplyLot(
                item_code=code,
                item_name=name,
                unit_cost=cost,
                quantity_received=qty,
                entry_date=ENTRY_DATE,
            ))
        db.commit()
        logging.info("_seed_supply_lots: %d lotes insertados", len(LOTS))
    except Exception as e:
        db.rollback()
        logging.warning("_seed_supply_lots error: %s", e)
    finally:
        db.close()

if not is_sqlite:
    _seed_supply_lots()


def _start_imap_poller():
    import threading, time

    def _loop():
        time.sleep(30)  # wait for app to finish starting
        while True:
            try:
                from routers.settings import poll_imap_replies, _imap_cfg
                from database import SessionLocal
                db = SessionLocal()
                cfg = _imap_cfg(db)
                db.close()
                interval = int((cfg or {}).get("poll_interval", 120)) if cfg else 120
                if cfg and cfg.get("enabled"):
                    poll_imap_replies()
            except Exception as exc:
                interval = 120
                logging.warning("IMAP poller error: %s", exc)
            time.sleep(interval)

    t = threading.Thread(target=_loop, daemon=True)
    t.start()


_start_imap_poller()

app = FastAPI(title="Service Desk", version="1.0.0")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    safe_errors = json.loads(json.dumps(exc.errors(), default=lambda o: o.decode("utf-8", "replace") if isinstance(o, bytes) else str(o)))
    logging.error("Validation error on %s %s: %s", request.method, request.url.path, safe_errors)
    return JSONResponse(status_code=422, content={"detail": safe_errors})


_railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN")
_allowed_origins = (
    [f"https://{_railway_domain}", "http://localhost:5173", "http://localhost:3000"]
    if _railway_domain
    else ["http://localhost:5173", "http://localhost:3000"]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
)

upload_dir = os.getenv("UPLOAD_DIR", "uploads")
os.makedirs(upload_dir, exist_ok=True)

from routers.system import require_module

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(attachments.router)
app.include_router(push.router)
app.include_router(canned_responses.router)
app.include_router(settings.router)
app.include_router(papelera.router)
app.include_router(audit.router)
app.include_router(system.router)

app.include_router(tickets.router,       dependencies=[Depends(require_module("tickets"))])
app.include_router(calendar.router,      dependencies=[Depends(require_module("agenda"))])
app.include_router(projects.router,      dependencies=[Depends(require_module("proyectos"))])
app.include_router(dashboard.router,     dependencies=[Depends(require_module("dashboard_servicios"))])
app.include_router(reports.router,       dependencies=[Depends(require_module("reportes"))])
app.include_router(knowledge_base.router,dependencies=[Depends(require_module("knowledge_base"))])
app.include_router(contacts.router,      dependencies=[Depends(require_module("contactos"))])
app.include_router(companies.router,     dependencies=[Depends(require_module("contactos"))])
app.include_router(opportunities.router, dependencies=[Depends(require_module("oportunidades"))])
app.include_router(quotes.router,        dependencies=[Depends(require_module("cotizaciones"))])
app.include_router(orders.router,        dependencies=[Depends(require_module("pedidos"))])
app.include_router(invoices.router,      dependencies=[Depends(require_module("facturas"))])
app.include_router(ventas.router,        dependencies=[Depends(require_module("dashboard_ventas"))])
app.include_router(expenses.router,      dependencies=[Depends(require_module("gastos"))])
app.include_router(despacho.router,      dependencies=[Depends(require_module("pedidos"))])
app.include_router(inventory.router,     dependencies=[Depends(require_module("inventario"))])
app.include_router(suppliers.router,     dependencies=[Depends(require_module("proveedores"))])
app.include_router(warranties.router,    dependencies=[Depends(require_module("garantias"))])
app.include_router(licenses.router,      dependencies=[Depends(require_module("licencias"))])
app.include_router(contracts.router,     dependencies=[Depends(require_module("contratos"))])
app.include_router(printers.router,      dependencies=[Depends(require_module("impresoras"))])
app.include_router(supplies.router,      dependencies=[Depends(require_module("suministros"))])
app.include_router(letters.router,       dependencies=[Depends(require_module("cartas"))])
app.include_router(stats.router)


def _seed_superadmin():
    """Create or update the superadmin account from SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD env vars."""
    email = os.getenv("SUPERADMIN_EMAIL")
    password = os.getenv("SUPERADMIN_PASSWORD")
    if not email or not password:
        return
    from auth import get_password_hash
    db = SessionLocal()
    try:
        existing = db.query(models.User).filter(models.User.email == email).first()
        if existing:
            if existing.role != models.UserRole.superadmin:
                existing.role = models.UserRole.superadmin
                existing.password_hash = get_password_hash(password)
                db.commit()
                logging.info("_seed_superadmin: rol actualizado para %s", email)
        else:
            sa = models.User(
                name="System Admin",
                email=email,
                password_hash=get_password_hash(password),
                role=models.UserRole.superadmin,
                is_active=True,
            )
            db.add(sa)
            db.commit()
            logging.info("_seed_superadmin: cuenta creada para %s", email)
    except Exception as e:
        db.rollback()
        logging.warning("_seed_superadmin error: %s", e)
    finally:
        db.close()


def _seed_system_modules():
    """Ensure the system_modules key exists in app_settings."""
    from routers.system import seed_default_modules
    db = SessionLocal()
    try:
        seed_default_modules(db)
    except Exception as e:
        logging.warning("_seed_system_modules error: %s", e)
    finally:
        db.close()


def seed_database():
    db = SessionLocal()
    try:
        # Categorías: siempre verificar y crear si no existen
        if not db.query(models.TicketCategory).first():
            for i, name in enumerate([
                "Servicio técnico", "Redes", "Impresión",
                "Sistemas", "Videovigilancia", "Compra de mercancía", "Entrega",
            ], start=1):
                db.add(models.TicketCategory(name=name, order=i))
            db.commit()
            print("✓ Categorías de ticket creadas")

        # Admin inicial — en su propia transacción para que exista SIEMPRE,
        # aunque falle cualquier otro seed. Credenciales por variable de entorno.
        if not db.query(models.User).first():
            admin = models.User(
                name="Administrador",
                email=os.getenv("INITIAL_ADMIN_EMAIL", "admin@sistema.com"),
                password_hash=get_password_hash(os.getenv("INITIAL_ADMIN_PASSWORD", "changeme")),
                role=models.UserRole.admin,
            )
            db.add(admin)
            db.commit()
            print("✓ Admin inicial creado")

        # Estados de ticket (estructural)
        if not db.query(models.TicketStatus).first():
            for st in [
                models.TicketStatus(name="Abierto",             color="#3B82F6", icon="circle",         order=1, is_default=True),
                models.TicketStatus(name="Pendiente",           color="#F59E0B", icon="clock",          order=2),
                models.TicketStatus(name="Por Cotizar",         color="#8B5CF6", icon="tag",            order=3),
                models.TicketStatus(name="Esperando Parte",     color="#EF4444", icon="package",        order=4),
                models.TicketStatus(name="Esperando Detalles",  color="#EAB308", icon="help-circle",    order=5),
                models.TicketStatus(name="En Progreso",         color="#06B6D4", icon="activity",       order=6),
                models.TicketStatus(name="Resuelto",            color="#10B981", icon="check-circle",   order=7),
                models.TicketStatus(name="Por Coordinar",       color="#0EA5E9", icon="calendar-clock", order=8),
                models.TicketStatus(name="Programado",          color="#F97316", icon="calendar-check", order=9),
            ]:
                db.add(st)
            db.commit()

        # Categorías de base de conocimientos (estructural)
        if not db.query(models.KBCategory).first():
            for cat in [
                models.KBCategory(name="Guías de Usuario",       icon="book-open",   order=1),
                models.KBCategory(name="Solución de Problemas",  icon="tool",        order=2),
                models.KBCategory(name="Preguntas Frecuentes",   icon="help-circle", order=3),
            ]:
                db.add(cat)
            db.commit()
        print("✓ Base de datos inicializada")
    except Exception as e:
        db.rollback()
        print(f"Error inicializando BD: {e}")
    finally:
        db.close()


seed_database()
_seed_superadmin()
_seed_system_modules()

def _migrate_despacho_to_pedidos():
    from routers.system import migrate_despacho_to_pedidos
    db = SessionLocal()
    try:
        migrate_despacho_to_pedidos(db)
    except Exception as e:
        logging.warning("_migrate_despacho_to_pedidos error: %s", e)
    finally:
        db.close()

_migrate_despacho_to_pedidos()


from fastapi.responses import FileResponse
import re as _re

# Public endpoint for email-embedded upload images (UUID filenames = capability URLs).
_SAFE_FNAME = _re.compile(r'^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+$')

@app.get("/u/{ticket_id}/{filename}")
def serve_upload(
    ticket_id: int,
    filename: str,
    db=Depends(_get_db_main),
    current_user: models.User = Depends(get_current_user),
):
    if not _SAFE_FNAME.match(filename):
        raise HTTPException(status_code=404)
    ticket = db.query(models.Ticket).filter(
        models.Ticket.id == ticket_id,
        models.Ticket.deleted_at.is_(None),
    ).first()
    if not ticket:
        raise HTTPException(status_code=404)
    if current_user.role == models.UserRole.client and ticket.client_id != current_user.id:
        raise HTTPException(status_code=403)
    _key = f"{ticket_id}/{filename}"
    if not storage.file_exists(_key):
        raise HTTPException(status_code=404)
    import mimetypes
    from fastapi.responses import Response as _Resp
    return _Resp(content=storage.read_file(_key),
                 media_type=mimetypes.guess_type(filename)[0] or "application/octet-stream")


_FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.isdir(_FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(_FRONTEND_DIST, "assets")), name="assets")

    def _dist_file(name: str):
        p = os.path.join(_FRONTEND_DIST, name)
        return FileResponse(p) if os.path.isfile(p) else JSONResponse(status_code=404, content={})

    @app.get("/logo.png")
    def serve_logo():
        import base64
        from fastapi.responses import Response as FResponse
        db = SessionLocal()
        try:
            row = db.query(models.AppSetting).filter(models.AppSetting.key == "company_logo_b64").first()
            if row and row.value:
                return FResponse(content=base64.b64decode(row.value), media_type="image/png")
        except Exception:
            pass
        finally:
            db.close()
        return _dist_file("default-logo.png")

    @app.get("/favicon.png")
    def serve_favicon(): return _dist_file("default-icon.png")

    @app.get("/default-icon.png")
    def serve_default_icon(): return _dist_file("default-icon.png")

    @app.get("/sw.js")
    def serve_sw(): return _dist_file("sw.js")

    @app.get("/push-handlers.js")
    def serve_push_handlers(): return _dist_file("push-handlers.js")

    @app.get("/registerSW.js")
    def serve_register_sw(): return _dist_file("registerSW.js")

    @app.get("/manifest.webmanifest")
    def serve_manifest(): return _dist_file("manifest.webmanifest")

    @app.get("/manifest.json")
    def serve_manifest_json():
        from fastapi.responses import Response as FResponse
        db = SessionLocal()
        try:
            def _s(key, default=""):
                row = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
                return (row.value if row and row.value else None) or default
            name      = _s("company_app_name") or _s("company_name", "Service Desk")
            sidebar   = _s("company_sidebar_color", "#1a3353")
            manifest  = {
                "name": name, "short_name": name,
                "description": "Plataforma de Gestión Empresarial",
                "start_url": "/", "scope": "/", "display": "standalone",
                "orientation": "portrait-primary",
                "background_color": "#0f172a", "theme_color": sidebar, "lang": "es",
                "icons": [
                    {"src": "/logo.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                    {"src": "/logo.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                    {"src": "/logo.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
                ],
            }
            return FResponse(content=json.dumps(manifest), media_type="application/json")
        except Exception:
            return _dist_file("manifest.json")
        finally:
            db.close()

    import glob as _glob
    for _wb in _glob.glob(os.path.join(_FRONTEND_DIST, "workbox-*.js")):
        _wb_name = os.path.basename(_wb)
        def _make_wb_route(name=_wb_name):
            @app.get(f"/{name}")
            def serve_workbox_file(): return _dist_file(name)
        _make_wb_route()

    def _serve_index_with_branding():
        """Sirve index.html inyectando el branding configurado (título, apple-web-app-title,
        theme-color). Así el título correcto aparece desde el primer render — sin login y
        sin parpadeo — y siempre refleja lo que se establezca en Configuración."""
        from fastapi.responses import HTMLResponse
        import html as _htmllib
        _path = os.path.join(_FRONTEND_DIST, "index.html")
        try:
            with open(_path, encoding="utf-8") as _f:
                _html = _f.read()
        except Exception:
            return FileResponse(_path)
        db = SessionLocal()
        try:
            def _s(key, default=""):
                row = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
                return (row.value if row and row.value else None) or default
            name  = _s("company_app_name") or _s("company_name", "Service Desk")
            theme = _s("company_sidebar_color", "#0c1428")
        except Exception:
            name, theme = "Service Desk", "#0c1428"
        finally:
            db.close()
        safe_name  = _htmllib.escape(name, quote=True)
        safe_theme = _htmllib.escape(theme, quote=True)
        _html = _re.sub(r"<title>.*?</title>", lambda m: f"<title>{safe_name}</title>", _html, count=1, flags=_re.S)
        _html = _re.sub(r'<meta name="apple-mobile-web-app-title" content="[^"]*"',
                        lambda m: f'<meta name="apple-mobile-web-app-title" content="{safe_name}"', _html, count=1)
        _html = _re.sub(r'<meta name="theme-color" content="[^"]*"',
                        lambda m: f'<meta name="theme-color" content="{safe_theme}"', _html, count=1)
        return HTMLResponse(content=_html)

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        return _serve_index_with_branding()
else:
    @app.get("/")
    def root():
        return {"message": "Service Desk API", "docs": "/docs"}
