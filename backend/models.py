from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, DateTime, Date, Boolean,
    ForeignKey, Enum as SAEnum, Numeric, Float
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum


class UserRole(str, enum.Enum):
    superadmin = "superadmin"
    admin = "admin"
    supervisor = "supervisor"
    agent = "agent"
    ventas = "ventas"
    supplies = "supplies"
    client = "client"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(SAEnum(UserRole), default=UserRole.client, nullable=False)
    is_active = Column(Boolean, default=True)
    phone = Column(String(30), nullable=True)
    company = Column(String(100), nullable=True)
    address = Column(String(500), nullable=True)
    google_token = Column(Text, nullable=True)
    reset_token = Column(String(100), nullable=True, index=True)
    reset_token_expires = Column(DateTime, nullable=True)
    client_category_id = Column(Integer, ForeignKey("client_categories.id"), nullable=True)
    signature = Column(Text, nullable=True)
    profile_photo = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    tickets_created = relationship("Ticket", foreign_keys="Ticket.client_id", back_populates="client")
    tickets_assigned = relationship("Ticket", foreign_keys="Ticket.assigned_to_id", back_populates="assigned_agent")
    comments = relationship("TicketTimeline", back_populates="user")
    client_category = relationship("ClientCategory", back_populates="users", foreign_keys=[client_category_id])


class ClientCategory(Base):
    __tablename__ = "client_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    color = Column(String(7), default="#6B7280")
    description = Column(String(255), nullable=True)
    order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    users = relationship("User", back_populates="client_category")


class TicketCategory(Base):
    __tablename__ = "ticket_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)


class TicketStatus(Base):
    __tablename__ = "ticket_statuses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    color = Column(String(7), default="#6B7280")
    icon = Column(String(50), default="circle")
    order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    is_closed = Column(Boolean, default=False)

    tickets = relationship("Ticket", back_populates="status_rel")


class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(String(20), default="medium")
    status_id = Column(Integer, ForeignKey("ticket_statuses.id"), nullable=False)
    client_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    category = Column(String(100), nullable=True)
    location = Column(String(255), nullable=True)
    charger = Column(String(30), nullable=True)  # 'Con cargador' | 'Con cargador genérico' | 'Sin cargador' (it_support)
    subject = Column(String(255), nullable=True)
    cc_email = Column(String(150), nullable=True)
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    duration_minutes = Column(Integer, nullable=True, default=60)
    calendar_event_id = Column(String(255), nullable=True)
    calendar_event_link = Column(Text, nullable=True)
    resolution_notes = Column(Text, nullable=True)
    parent_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)
    # SLA timer can be paused (e.g. waiting on client) and resumed; sla_elapsed_minutes
    # accumulates time across pause/resume cycles instead of a simple created_at diff.
    sla_deadline = Column(DateTime, nullable=True)
    sla_paused_at = Column(DateTime, nullable=True)
    sla_elapsed_minutes = Column(Integer, default=0)
    sla_last_resume = Column(DateTime, nullable=True)
    tags = Column(String(500), nullable=True)
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=True)
    csat_rating = Column(Integer, nullable=True)
    csat_comment = Column(Text, nullable=True)
    csat_submitted_at = Column(DateTime(timezone=True), nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    project_weight = Column(Float, nullable=True)  # % weight within project (0-100)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)

    status_rel = relationship("TicketStatus", back_populates="tickets")
    client = relationship("User", foreign_keys=[client_id], back_populates="tickets_created")
    assigned_agent = relationship("User", foreign_keys=[assigned_to_id], back_populates="tickets_assigned")
    contact = relationship("Contact", foreign_keys=[contact_id])
    timeline = relationship("TicketTimeline", back_populates="ticket", order_by="TicketTimeline.created_at")
    attachments = relationship("TicketAttachment", back_populates="ticket")
    visits = relationship("TicketVisit", back_populates="ticket", order_by="TicketVisit.created_at", cascade="all, delete-orphan")
    project = relationship("Project", back_populates="tickets", foreign_keys=[project_id])


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="Activo")  # Activo, En pausa, Completado, Cancelado
    client_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    budget = Column(String(50), nullable=True)
    quote_id = Column(Integer, ForeignKey("quotes.id"), nullable=True)
    notes = Column(Text, nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    client = relationship("User", foreign_keys=[client_id])
    quote = relationship("Quote", foreign_keys=[quote_id])
    tickets = relationship("Ticket", back_populates="project", foreign_keys="[Ticket.project_id]")


class TicketTimeline(Base):
    __tablename__ = "ticket_timeline"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    entry_type = Column(String(30), default="comment")  # comment, status_change, assignment, note, system
    is_internal = Column(Boolean, default=False)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="timeline")
    user = relationship("User", back_populates="comments")


class TicketAttachment(Base):
    __tablename__ = "ticket_attachments"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    filename = Column(String(255), nullable=True)  # NULL para adjuntos de Freshdesk (proxy)
    original_name = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=True)
    content_type = Column(String(100), nullable=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    fd_conversation_id = Column(BigInteger, nullable=True)
    fd_attachment_index = Column(Integer, nullable=True)  # posición del adjunto en la conversación
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="attachments")
    uploaded_by = relationship("User")


class TicketVisit(Base):
    __tablename__ = "ticket_visits"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    scheduled_at = Column(DateTime(timezone=True), nullable=False)
    duration_minutes = Column(Integer, nullable=True, default=60)
    calendar_event_id = Column(String(255), nullable=True)
    calendar_event_link = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(20), default="scheduled", nullable=True)  # scheduled | cancelled
    is_remote = Column(Boolean, default=False, nullable=False, server_default="false")
    costo = Column(Numeric(10, 2), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="visits")


class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    name = Column(String(200), nullable=False, unique=True)
    ruc = Column(String(100), nullable=True)
    address = Column(String(500), nullable=True)
    phone = Column(String(50), nullable=True)
    email = Column(String(150), nullable=True)
    notes = Column(Text, nullable=True)
    client_category_id = Column(Integer, ForeignKey("client_categories.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    client_category = relationship("ClientCategory", foreign_keys=[client_category_id])


class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    name = Column(String(200), nullable=False)
    email = Column(String(150), nullable=True)
    phone = Column(String(50), nullable=True)
    company = Column(String(200), nullable=True)
    ruc = Column(String(100), nullable=True)
    address = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class KBCategory(Base):
    __tablename__ = "kb_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String(50), default="book")
    order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    articles = relationship("KBArticle", back_populates="category")


class KBArticle(Base):
    __tablename__ = "kb_articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    category_id = Column(Integer, ForeignKey("kb_categories.id"), nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    tags = Column(String(500), nullable=True)
    audience = Column(String(20), default='all', nullable=False)
    is_published = Column(Boolean, default=True)
    views = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    category = relationship("KBCategory", back_populates="articles")
    created_by = relationship("User")


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    contact_name = Column(String(200), nullable=True)
    phone = Column(String(50), nullable=True)
    email = Column(String(150), nullable=True)
    address = Column(String(500), nullable=True)
    website = Column(String(255), nullable=True)
    category = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    logo_path = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    title = Column(String(300), nullable=False)
    order_number = Column(String(50), nullable=True)
    status = Column(String(50), default="Pendiente", nullable=False)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)
    supplier1_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    supplier2_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    supplier3_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    expected_date = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)
    purchase_items = Column(Text, nullable=True)   # JSON: [{description, qty, unit_price}]
    purchase_total = Column(String(50), nullable=True)
    itbms_enabled = Column(Boolean, default=False)
    shipping_cost = Column(String(50), nullable=True)
    inventory_applied = Column(Boolean, default=False, nullable=False)
    client_invoice_notes = Column(Text, nullable=True)
    payment_terms = Column(String(100), nullable=True)
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    duration_minutes = Column(Integer, default=60, nullable=True)
    calendar_event_id = Column(String(255), nullable=True)
    calendar_event_link = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    quote_id = Column(Integer, ForeignKey("quotes.id"), nullable=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)

    ticket = relationship("Ticket", foreign_keys=[ticket_id])
    quote = relationship("Quote", foreign_keys=[quote_id])
    invoice = relationship("Invoice", foreign_keys=[invoice_id])
    supplier1 = relationship("Supplier", foreign_keys=[supplier1_id])
    supplier2 = relationship("Supplier", foreign_keys=[supplier2_id])
    supplier3 = relationship("Supplier", foreign_keys=[supplier3_id])
    attachments = relationship("OrderAttachment", back_populates="order", cascade="all, delete-orphan")
    dispatches = relationship("Dispatch", back_populates="order")
    expense = relationship("Expense", foreign_keys="[Expense.order_id]", back_populates="order", uselist=False)


class OrderAttachment(Base):
    __tablename__ = "order_attachments"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    doc_type = Column(String(30), nullable=False, default="otro")  # proveedor | cliente | otro
    filename = Column(String(255), nullable=False)
    original_name = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=True)
    content_type = Column(String(100), nullable=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    order = relationship("Order", back_populates="attachments")
    uploaded_by = relationship("User")


class Dispatch(Base):
    __tablename__ = "dispatches"

    id = Column(Integer, primary_key=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    title = Column(String(300), nullable=False)
    dispatch_number = Column(String(50), nullable=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    quote_id = Column(Integer, ForeignKey("quotes.id"), nullable=True)
    client_name = Column(String(200), nullable=True)
    client_ruc = Column(String(100), nullable=True)
    client_address = Column(String(500), nullable=True)
    date = Column(Date, nullable=True)
    delivery_date = Column(Date, nullable=True)
    status = Column(String(50), default="Borrador", nullable=False)
    notes = Column(Text, nullable=True)
    items = Column(Text, nullable=True)  # JSON: [{description, qty, unit_price}]
    itbms_enabled = Column(Boolean, default=False)
    subtotal = Column(String(50), nullable=True)
    itbms_amount = Column(String(50), nullable=True)
    total = Column(String(50), nullable=True)
    inventory_applied = Column(Boolean, default=False, nullable=False)
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    duration_minutes = Column(Integer, default=60, nullable=True)
    calendar_event_id = Column(String(255), nullable=True)
    calendar_event_link = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    order = relationship("Order", foreign_keys=[order_id], back_populates="dispatches")
    quote = relationship("Quote", foreign_keys=[quote_id])
    attachments = relationship("DispatchAttachment", back_populates="dispatch", cascade="all, delete-orphan")
    invoice = relationship("Invoice", foreign_keys="[Invoice.dispatch_id]", back_populates="dispatch", uselist=False)


class DispatchAttachment(Base):
    __tablename__ = "dispatch_attachments"

    id = Column(Integer, primary_key=True, index=True)
    dispatch_id = Column(Integer, ForeignKey("dispatches.id"), nullable=False)
    doc_type = Column(String(30), nullable=False, default="otro")  # cliente | otro
    filename = Column(String(255), nullable=False)
    original_name = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=True)
    content_type = Column(String(100), nullable=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    dispatch = relationship("Dispatch", back_populates="attachments")
    uploaded_by = relationship("User")


class Warranty(Base):
    __tablename__ = "warranties"

    id = Column(Integer, primary_key=True, index=True)
    cert_number = Column(String(50), unique=True, nullable=False, index=True)
    client_name = Column(String(200), nullable=True)
    client_company = Column(String(200), nullable=True)
    issue_date = Column(String(20), nullable=True)
    warranty_period = Column(String(50), nullable=True)
    warranty_end = Column(String(20), nullable=True)
    client_ruc = Column(String(100), nullable=True)
    technician = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)
    invoice_ref = Column(String(100), nullable=True)  # N° de factura como texto libre (factura externa)
    dispatch_id = Column(Integer, ForeignKey("dispatches.id"), nullable=True, index=True)  # pedido origen (it_support)

    created_by = relationship("User", foreign_keys=[created_by_id])
    invoice = relationship("Invoice", foreign_keys=[invoice_id])
    items = relationship(
        "WarrantyItem",
        back_populates="warranty",
        cascade="all, delete-orphan",
        order_by="WarrantyItem.sort_order",
    )


class WarrantyItem(Base):
    __tablename__ = "warranty_items"

    id = Column(Integer, primary_key=True, index=True)
    warranty_id = Column(Integer, ForeignKey("warranties.id"), nullable=False)
    type = Column(String(100), nullable=True)
    description = Column(String(500), nullable=True)
    brand = Column(String(200), nullable=True)
    model = Column(String(200), nullable=True)
    serial = Column(String(200), nullable=True)
    sort_order = Column(Integer, default=0)

    warranty = relationship("Warranty", back_populates="items")


class Quote(Base):
    __tablename__ = "quotes"

    id = Column(Integer, primary_key=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    title = Column(String(300), nullable=False)
    quote_number = Column(String(50), nullable=True)
    status = Column(String(50), default="Borrador", nullable=False)
    client_name = Column(String(200), nullable=True)
    client_ruc = Column(String(100), nullable=True)
    client_address = Column(String(500), nullable=True)
    client_email = Column(String(150), nullable=True)
    client_phone = Column(String(50), nullable=True)
    client_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # cuenta de portal vinculada (puede ser null si el cliente no tiene login)
    date = Column(Date, nullable=True)
    valid_until = Column(Date, nullable=True)
    items = Column(Text, nullable=True)   # JSON [{description, qty, unit_price}]
    itbms_enabled = Column(Boolean, default=False)
    shipping_cost = Column(String(50), nullable=True)
    subtotal = Column(String(50), nullable=True)
    itbms_amount = Column(String(50), nullable=True)
    total = Column(String(50), nullable=True)
    payment_terms = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    order = relationship("Order", foreign_keys=[order_id])
    ticket = relationship("Ticket", foreign_keys=[ticket_id])
    client = relationship("User", foreign_keys=[client_id])
    invoice_links = relationship(
        "InvoiceQuoteLink",
        primaryjoin="Quote.id == foreign(InvoiceQuoteLink.quote_id)",
        lazy="select",
    )

    @property
    def linked_invoices(self):
        seen, result = set(), []
        for lnk in (self.invoice_links or []):
            if lnk.invoice is not None and lnk.invoice_id not in seen:
                seen.add(lnk.invoice_id)
                result.append(lnk.invoice)
        return result


class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=True)


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    concept = Column(String(300), nullable=False)
    amount = Column(String(50), default="0.00")   # stored as formatted string like purchase_total
    category = Column(String(100), nullable=True)
    date = Column(String(10), nullable=True)       # YYYY-MM-DD
    type = Column(String(20), default="manual")    # 'manual' | 'pedido'
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    supplier = Column(String(200), nullable=True)  # proveedor que recibe el pago
    payment_method = Column(String(50), nullable=True)  # Efectivo | Transferencia | Tarjeta de crédito | Yappy
    notes = Column(Text, nullable=True)
    is_payable = Column(Boolean, default=False)
    due_date = Column(Date, nullable=True)
    paid_at = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)

    order   = relationship("Order",   foreign_keys=[order_id], back_populates="expense")
    invoice = relationship("Invoice", foreign_keys=[invoice_id])
    attachments = relationship("ExpenseAttachment", back_populates="expense", cascade="all, delete-orphan")


class ExpenseAttachment(Base):
    __tablename__ = "expense_attachments"

    id = Column(Integer, primary_key=True, index=True)
    expense_id = Column(Integer, ForeignKey("expenses.id"), nullable=False)
    filename = Column(String(255), nullable=False)
    original_name = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=True)
    content_type = Column(String(100), nullable=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    expense = relationship("Expense", back_populates="attachments")
    uploaded_by = relationship("User")


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    invoice_number = Column(String(50), nullable=True)
    status = Column(String(50), default="Borrador", nullable=False)
    dispatch_id = Column(Integer, ForeignKey("dispatches.id"), nullable=True)
    client_name = Column(String(200), nullable=True)
    client_ruc = Column(String(100), nullable=True)
    client_address = Column(String(500), nullable=True)
    client_email = Column(String(150), nullable=True)
    client_phone = Column(String(50), nullable=True)
    client_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # cuenta de portal vinculada (puede ser null si el cliente no tiene login)
    date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    items = Column(Text, nullable=True)   # JSON [{description, qty, unit_price}]
    itbms_enabled = Column(Boolean, default=False)
    shipping_cost = Column(String(50), nullable=True)
    subtotal = Column(String(50), nullable=True)
    itbms_amount = Column(String(50), nullable=True)
    total = Column(String(50), nullable=True)
    payment_terms = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)
    quote_id = Column(Integer, ForeignKey("quotes.id"), nullable=True)
    inventory_applied = Column(Boolean, default=False, nullable=False)
    dgi_filename = Column(String(255), nullable=True)
    dgi_original_name = Column(String(255), nullable=True)

    dispatch = relationship("Dispatch", foreign_keys=[dispatch_id], back_populates="invoice")
    ticket   = relationship("Ticket",   foreign_keys=[ticket_id])
    quote    = relationship("Quote",    foreign_keys=[quote_id])
    client   = relationship("User",     foreign_keys=[client_id])
    payments  = relationship("InvoicePayment", back_populates="invoice", cascade="all, delete-orphan", order_by="InvoicePayment.date")
    quote_links = relationship("InvoiceQuoteLink", foreign_keys="InvoiceQuoteLink.invoice_id", cascade="all, delete-orphan", lazy="select")
    attachments = relationship("InvoiceAttachment", back_populates="invoice", cascade="all, delete-orphan", order_by="InvoiceAttachment.created_at")

    @property
    def linked_quotes(self):
        return [lnk.quote for lnk in (self.quote_links or []) if lnk.quote is not None]


class InvoiceAttachment(Base):
    __tablename__ = "invoice_attachments"

    id         = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    filename   = Column(String(255), nullable=False)       # UUID stored on disk
    original_name = Column(String(500), nullable=False)
    file_size  = Column(Integer, nullable=True)
    content_type = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    invoice = relationship("Invoice", back_populates="attachments")


class InvoiceQuoteLink(Base):
    __tablename__ = "invoice_quote_links"

    id         = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    quote_id   = Column(Integer, ForeignKey("quotes.id"),   nullable=False)

    invoice = relationship("Invoice", foreign_keys=[invoice_id])
    quote   = relationship("Quote",   foreign_keys=[quote_id])


class InvoicePayment(Base):
    __tablename__ = "invoice_payments"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    amount = Column(String(50), nullable=False)
    method = Column(String(30), nullable=False, default="Efectivo")  # Efectivo | Tarjeta | Transferencia | Cheque | Yappy
    date = Column(Date, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    invoice = relationship("Invoice", back_populates="payments")


class InventoryItem(Base):
    __tablename__ = "inventory"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(100), unique=True, nullable=False, index=True)
    name = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    unit = Column(String(50), nullable=True, default="unidad")
    unit_price = Column(String(50), nullable=True, default="0.00")  # precio de venta
    cost_price = Column(String(50), nullable=True, default="0.00")  # último precio de compra
    quantity = Column(String(50), nullable=True, default="0")
    category = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    warehouse = Column(String(30), nullable=False, default="principal")  # principal | suministros_mps | partes | impresoras_mps
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    condition = Column(String(20), nullable=True, default="nuevo")       # nuevo | funcional | dañado | incompleto
    item_status = Column(String(20), nullable=True, default="ingresado")  # ingresado | revisado | por_devolver
    location = Column(String(150), nullable=True)                         # ubicación física dentro de la bodega
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    supplier = relationship("Supplier")


class TicketTimeLog(Base):
    __tablename__ = "ticket_time_logs"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    minutes = Column(Integer, nullable=False)
    description = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket")
    user = relationship("User")


class InventoryTransaction(Base):
    __tablename__ = "inventory_transactions"

    id = Column(Integer, primary_key=True, index=True)
    item_code = Column(String(100), nullable=False, index=True)
    qty_delta = Column(String(50), nullable=False)  # negative = deduction, positive = addition
    source_type = Column(String(30), nullable=False, index=True)  # dispatch, invoice, order, manual
    source_id = Column(Integer, nullable=True, index=True)
    notes = Column(String(300), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PartRequest(Base):
    __tablename__ = "part_requests"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False, index=True)
    item_code = Column(String(100), nullable=False)
    item_name = Column(String(300), nullable=True)
    quantity = Column(String(50), nullable=False, default="1")
    status = Column(String(20), nullable=False, default="pendiente")  # pendiente | aprobado | rechazado
    notes = Column(Text, nullable=True)             # nota del solicitante
    decision_notes = Column(Text, nullable=True)    # nota del aprobador
    requested_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    decided_at = Column(DateTime(timezone=True), nullable=True)

    ticket = relationship("Ticket")
    requested_by = relationship("User", foreign_keys=[requested_by_id])
    approved_by = relationship("User", foreign_keys=[approved_by_id])


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    body = Column(String(500), nullable=True)
    url = Column(String(300), nullable=True)
    kind = Column(String(40), nullable=True)   # part_request | part_decision | ...
    read = Column(Boolean, default=False, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CannedResponse(Base):
    __tablename__ = "canned_responses"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    category = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_name = Column(String(150), nullable=True)
    action = Column(String(30), nullable=False)       # create, update, delete, restore, login
    entity_type = Column(String(50), nullable=False)  # ticket, factura, cotizacion, gasto, contacto, empresa, pedido
    entity_id = Column(Integer, nullable=True)
    entity_name = Column(String(300), nullable=True)
    details = Column(Text, nullable=True)             # JSON extra info
    ip_address = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])


class Letter(Base):
    __tablename__ = "letters"

    id = Column(Integer, primary_key=True, index=True)
    letter_number = Column(String(50), nullable=True)
    letter_type = Column(String(100), nullable=True)
    status = Column(String(50), default="Borrador")
    recipient_name = Column(String(200), nullable=True)
    recipient_company = Column(String(200), nullable=True)
    recipient_ruc = Column(String(100), nullable=True)
    recipient_address = Column(String(500), nullable=True)
    recipient_email = Column(String(150), nullable=True)
    date = Column(Date, nullable=True)
    subject = Column(String(300), nullable=True)
    body = Column(Text, nullable=True)
    attention_to = Column(String(200), nullable=True)
    signer_name = Column(String(200), nullable=True)
    signer_title = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    created_by = relationship("User", foreign_keys=[created_by_id])


class SoftwareLicense(Base):
    __tablename__ = "software_licenses"

    id = Column(Integer, primary_key=True, index=True)
    license_number = Column(String(50), nullable=True)
    software_name = Column(String(200), nullable=False)
    software_version = Column(String(100), nullable=True)
    license_type = Column(String(100), nullable=True)  # Perpetua, Suscripción anual, etc.
    license_key = Column(Text, nullable=True)
    seats = Column(Integer, default=1)
    purchase_date = Column(Date, nullable=True)
    expiry_date = Column(Date, nullable=True)
    validity_period = Column(String(100), nullable=True)
    client_name = Column(String(200), nullable=True)
    client_ruc = Column(String(100), nullable=True)
    client_email = Column(String(150), nullable=True)
    client_phone = Column(String(50), nullable=True)
    client_address = Column(String(500), nullable=True)
    invoice_ref = Column(String(100), nullable=True)
    supplier = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(50), default="Borrador")
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    created_by = relationship("User", foreign_keys=[created_by_id])


class Opportunity(Base):
    __tablename__ = "opportunities"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="Nueva")
    priority = Column(String(20), default="Media")
    source = Column(String(50), nullable=True)
    estimated_value = Column(String(50), nullable=True)
    probability = Column(Integer, default=50)
    expected_close_date = Column(Date, nullable=True)
    client_name = Column(String(200), nullable=True)
    client_ruc = Column(String(100), nullable=True)
    client_email = Column(String(150), nullable=True)
    client_phone = Column(String(50), nullable=True)
    client_address = Column(String(500), nullable=True)
    category = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    quote_id = Column(Integer, ForeignKey("quotes.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    assignee = relationship("User", foreign_keys=[assigned_to_id])
    creator = relationship("User", foreign_keys=[created_by_id])
    quote = relationship("Quote", foreign_keys=[quote_id])
    visits = relationship("OppVisit", back_populates="opportunity", cascade="all, delete-orphan", order_by="OppVisit.scheduled_at")


class OppVisit(Base):
    __tablename__ = "opp_visits"

    id = Column(Integer, primary_key=True, index=True)
    opportunity_id = Column(Integer, ForeignKey("opportunities.id"), nullable=False)
    scheduled_at = Column(DateTime(timezone=True), nullable=False)
    duration_minutes = Column(Integer, nullable=True, default=60)
    calendar_event_id = Column(String(255), nullable=True)
    calendar_event_link = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(20), default="scheduled")  # scheduled | cancelled
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    opportunity = relationship("Opportunity", back_populates="visits")


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    endpoint   = Column(Text, nullable=False, unique=True)
    p256dh     = Column(Text, nullable=False)
    auth       = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")


class Contract(Base):
    __tablename__ = "contracts"

    id = Column(Integer, primary_key=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    contract_number = Column(String(50), unique=True, index=True, nullable=True)
    client_name = Column(String(200), nullable=True)
    client_company = Column(String(200), nullable=True)
    client_ruc = Column(String(100), nullable=True)
    client_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String(50), default="Activo")          # Activo, Suspendido, Cancelado, Vencido
    contract_type = Column(String(50), default="Soporte Mensual")  # Soporte Mensual | Soporte por Horas | Mantenimiento Preventivo | Proyecto
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    billing_cycle = Column(String(30), default="Mensual")   # Mensual | Trimestral | Anual | Único
    monthly_base_fee = Column(String(50), nullable=True)    # cuota recurrente o monto del proyecto
    service_scope = Column(Text, nullable=True)             # alcance del servicio
    response_time = Column(String(50), nullable=True)       # SLA tiempo de respuesta
    coverage_hours = Column(String(50), nullable=True)      # horario de cobertura
    included_hours = Column(Integer, default=0)             # horas de soporte incluidas por período
    included_visits = Column(Integer, default=0)            # visitas presenciales incluidas por período
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    client = relationship("User", foreign_keys=[client_id])
    printers = relationship("Printer", back_populates="contract")


class Printer(Base):
    __tablename__ = "printers"

    id = Column(Integer, primary_key=True, index=True)
    equipment_type = Column(String(30), default="impresora")  # impresora | pc | portatil | red | servidor | otro
    brand = Column(String(100), nullable=True)
    model = Column(String(100), nullable=True)
    serial_number = Column(String(100), unique=True, index=True, nullable=True)
    ownership_type = Column(String(20), default="cliente")  # alquiler | cliente
    contract_id = Column(Integer, ForeignKey("contracts.id"), nullable=True)
    inventory_item_id = Column(Integer, ForeignKey("inventory.id"), nullable=True)  # solo si ownership_type == alquiler
    warranty_start_date = Column(Date, nullable=True)
    warranty_end_date = Column(Date, nullable=True)
    asset_id = Column(String(100), nullable=True)
    ip_address = Column(String(50), nullable=True)
    contact_name = Column(String(255), nullable=True)
    location = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(30), default="Activa")  # Activa, En reparacion, Baja
    # Baja del equipo (daño, reemplazo, robo, obsolescencia, fin de contrato…)
    decommissioned_at = Column(Date, nullable=True)
    decommission_reason = Column(String(50), nullable=True)
    replaced_by_id = Column(Integer, ForeignKey("printers.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    contract = relationship("Contract", back_populates="printers")
    replaced_by = relationship("Printer", remote_side=[id], foreign_keys=[replaced_by_id])
    inventory_item = relationship("InventoryItem")
    meter_readings = relationship(
        "MeterReading",
        back_populates="printer",
        cascade="all, delete-orphan",
        order_by="MeterReading.reading_date",
    )


class MeterReading(Base):
    __tablename__ = "meter_readings"

    id = Column(Integer, primary_key=True, index=True)
    printer_id = Column(Integer, ForeignKey("printers.id"), nullable=False)
    reading_date = Column(Date, nullable=False)
    bw_count = Column(Integer, default=0)
    color_count = Column(Integer, default=0)
    notes = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    printer = relationship("Printer", back_populates="meter_readings")
    created_by = relationship("User", foreign_keys=[created_by_id])


class SupplyLot(Base):
    """Lote de entrada de suministros (compra/ingreso al stock)."""
    __tablename__ = "supply_lots"

    id = Column(Integer, primary_key=True, index=True)
    item_code = Column(String(100), nullable=False, index=True)
    item_name = Column(String(255), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    entry_date = Column(Date, nullable=False)
    unit_cost = Column(String(50), default="0.00")
    quantity_received = Column(Integer, nullable=False, default=1)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    supplier = relationship("Supplier", foreign_keys=[supplier_id])
    dispatch_lines = relationship("SupplyDispatch", back_populates="lot")


class SupplyDelivery(Base):
    """Cabecera de una entrega de suministros (MPS o venta directa)."""
    __tablename__ = "supply_deliveries"

    id = Column(Integer, primary_key=True, index=True)
    delivery_number = Column(String(50), nullable=True, index=True)
    delivery_date = Column(Date, nullable=False)
    # MPS: vinculado a contrato. Venta directa: vinculado a cliente.
    contract_id = Column(Integer, ForeignKey("contracts.id"), nullable=True)
    client_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    client_name = Column(String(255), nullable=True)   # texto libre si no está en el sistema
    # Factura auto-creada solo para ventas directas
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)
    dispatch_condition = Column(String(50), nullable=True)  # Pro-Activo, Incidente, Solicitud, Ventas
    delivery_method = Column(String(50), nullable=True)     # Mensajería Interna, Mensajería Externa
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    contract = relationship("Contract", foreign_keys=[contract_id])
    client = relationship("User", foreign_keys=[client_id])
    invoice = relationship("Invoice", foreign_keys=[invoice_id])
    lines = relationship("SupplyDispatch", back_populates="delivery", cascade="all, delete-orphan")


class SupplyDispatch(Base):
    """Línea de despacho dentro de una entrega de suministros."""
    __tablename__ = "supply_dispatches"

    id = Column(Integer, primary_key=True, index=True)
    delivery_id = Column(Integer, ForeignKey("supply_deliveries.id"), nullable=False)
    lot_id = Column(Integer, ForeignKey("supply_lots.id"), nullable=False)
    quantity_dispatched = Column(Integer, nullable=False, default=1)
    serial_number = Column(String(100), nullable=True)
    exit_price = Column(String(50), default="0.00")
    # Impresora destino (FK para referencia + snapshot JSON para trazabilidad histórica)
    printer_id = Column(Integer, ForeignKey("printers.id"), nullable=True)
    printer_snapshot = Column(Text, nullable=True)  # JSON: {brand,model,serial_number,location,contact_name,ip_address,asset_id}
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    delivery = relationship("SupplyDelivery", back_populates="lines")
    lot = relationship("SupplyLot", back_populates="dispatch_lines")
    printer = relationship("Printer", foreign_keys=[printer_id])
