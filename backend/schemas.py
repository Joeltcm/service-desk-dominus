from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional, List
from datetime import datetime, date
from models import UserRole

_Date = date  # alias avoids shadowing by field names in Pydantic v2 model classes


# ── Auth ──────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str
    user: "UserOut"


class TokenData(BaseModel):
    user_id: Optional[int] = None


# ── Client Categories ─────────────────────────────────
class ClientCategoryCreate(BaseModel):
    name: str
    color: str = "#6B7280"
    description: Optional[str] = None
    order: int = 0


class ClientCategoryUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    order: Optional[int] = None
    is_active: Optional[bool] = None


class ClientCategoryOut(BaseModel):
    id: int
    name: str
    color: str
    description: Optional[str] = None
    order: int
    is_active: bool

    class Config:
        from_attributes = True


# ── Users ─────────────────────────────────────────────
class UserCreate(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    password: str
    role: UserRole = UserRole.client
    phone: Optional[str] = None
    company: Optional[str] = None
    address: Optional[str] = None
    client_category_id: Optional[int] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    address: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    old_password: Optional[str] = None
    password: Optional[str] = None
    client_category_id: Optional[int] = None


class UserOut(BaseModel):
    id: int
    name: str
    email: str
    role: UserRole
    phone: Optional[str] = None
    company: Optional[str] = None
    address: Optional[str] = None
    is_active: bool
    client_category_id: Optional[int] = None
    client_category: Optional[ClientCategoryOut] = None
    signature: Optional[str] = None
    profile_photo: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Ticket Categories ─────────────────────────────────
class CategoryOut(BaseModel):
    id: int
    name: str
    order: int
    is_active: bool

    class Config:
        from_attributes = True


class CategoryCreate(BaseModel):
    name: str
    order: int = 0


# ── Ticket Status ──────────────────────────────────────
class StatusCreate(BaseModel):
    name: str
    color: str = "#6B7280"
    icon: str = "circle"
    order: int = 0
    is_closed: bool = False


class StatusOut(BaseModel):
    id: int
    name: str
    color: str
    icon: str
    order: int
    is_active: bool
    is_default: bool
    is_closed: bool = False

    class Config:
        from_attributes = True


# ── Tickets ───────────────────────────────────────────
class TicketCreate(BaseModel):
    title: str = Field(..., max_length=300)
    description: Optional[str] = Field(None, max_length=20_000)
    priority: str = "medium"
    status_id: int
    client_id: int
    assigned_to_id: Optional[int] = None
    category: Optional[str] = None
    location: Optional[str] = None
    subject: Optional[str] = Field(None, max_length=500)
    cc_email: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    tags: Optional[str] = Field(None, max_length=500)
    project_id: Optional[int] = None


class TicketUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=300)
    description: Optional[str] = Field(None, max_length=20_000)
    priority: Optional[str] = None
    status_id: Optional[int] = None
    client_id: Optional[int] = None
    assigned_to_id: Optional[int] = None
    category: Optional[str] = None
    location: Optional[str] = None
    subject: Optional[str] = Field(None, max_length=500)
    cc_email: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    resolution_notes: Optional[str] = Field(None, max_length=20_000)
    tags: Optional[str] = Field(None, max_length=500)
    project_id: Optional[int] = None


class TicketMini(BaseModel):
    id: int
    title: str

    class Config:
        from_attributes = True


class TicketRef(BaseModel):
    id: int
    title: str
    priority: str
    status_rel: StatusOut
    client: UserOut

    class Config:
        from_attributes = True


class TicketVisitOut(BaseModel):
    id: int
    ticket_id: int
    scheduled_at: datetime
    duration_minutes: Optional[int]
    calendar_event_id: Optional[str]
    calendar_event_link: Optional[str]
    notes: Optional[str]
    status: Optional[str] = "scheduled"
    is_remote: bool = False
    costo: Optional[float] = None
    created_at: datetime

    class Config:
        from_attributes = True


class VisitCostoUpdate(BaseModel):
    costo: Optional[float] = None


class CalendarVisitUpdate(BaseModel):
    scheduled_at: datetime
    duration_minutes: int = 60
    location: Optional[str] = None
    notes: Optional[str] = None
    is_remote: Optional[bool] = None


class TicketOut(BaseModel):
    id: int
    title: str
    description: Optional[str]
    priority: str
    status_rel: StatusOut
    client: UserOut
    assigned_agent: Optional[UserOut]
    contact_id: Optional[int] = None
    contact: Optional["ContactOut"] = None
    category: Optional[str]
    location: Optional[str]
    subject: Optional[str]
    scheduled_at: Optional[datetime]
    duration_minutes: Optional[int]
    calendar_event_id: Optional[str]
    calendar_event_link: Optional[str]
    cc_email: Optional[str] = None
    resolution_notes: Optional[str]
    parent_id: Optional[int]
    parent: Optional[TicketRef] = None
    children: List[TicketRef] = []
    sla_deadline: Optional[datetime] = None
    sla_paused_at: Optional[datetime] = None
    sla_elapsed_minutes: Optional[int] = None
    tags: Optional[str] = None
    csat_rating: Optional[int] = None
    csat_comment: Optional[str] = None
    csat_submitted_at: Optional[datetime] = None
    project_id: Optional[int] = None
    project: Optional["ProjectMini"] = None
    created_at: datetime
    updated_at: Optional[datetime]
    closed_at: Optional[datetime]
    visits: List[TicketVisitOut] = []

    class Config:
        from_attributes = True


class TicketListItem(BaseModel):
    id: int
    title: str
    priority: str
    status_rel: StatusOut
    client: UserOut
    assigned_agent: Optional[UserOut]
    contact_id: Optional[int] = None
    contact: Optional["ContactOut"] = None
    category: Optional[str]
    location: Optional[str]
    subject: Optional[str]
    scheduled_at: Optional[datetime]
    sla_deadline: Optional[datetime] = None
    sla_paused_at: Optional[datetime] = None
    sla_elapsed_minutes: Optional[int] = None
    tags: Optional[str] = None
    project_id: Optional[int] = None
    project_weight: Optional[float] = None
    project: Optional["ProjectMini"] = None
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Timeline ──────────────────────────────────────────
class TimelineCreate(BaseModel):
    content: str
    entry_type: str = "comment"
    is_internal: bool = False
    cc_email: Optional[str] = None
    bcc_email: Optional[str] = None
    new_status_id: Optional[int] = None
    attachment_ids: Optional[List[int]] = []
    attach_invoice_pdfs: Optional[bool] = True


class TimelineOut(BaseModel):
    id: int
    ticket_id: int
    user: UserOut
    content: str
    entry_type: str
    is_internal: bool
    created_at: datetime
    metadata_json: Optional[str] = None

    class Config:
        from_attributes = True


# ── Attachments ───────────────────────────────────────
class AttachmentOut(BaseModel):
    id: int
    ticket_id: int
    filename: Optional[str]
    original_name: str
    file_size: Optional[int]
    content_type: Optional[str]
    uploaded_by: UserOut
    fd_conversation_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Knowledge Base ────────────────────────────────────
class KBCategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    icon: str = "book"
    order: int = 0


class KBCategoryOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    icon: str
    order: int
    is_active: bool

    class Config:
        from_attributes = True


class KBArticleCreate(BaseModel):
    title: str = Field(..., max_length=300)
    content: str = Field(..., max_length=100_000)
    category_id: Optional[int] = None
    tags: Optional[str] = Field(None, max_length=500)
    audience: str = 'all'
    is_published: bool = True


class KBArticleUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=300)
    content: Optional[str] = Field(None, max_length=100_000)
    category_id: Optional[int] = None
    tags: Optional[str] = Field(None, max_length=500)
    audience: Optional[str] = None
    is_published: Optional[bool] = None


class KBArticleOut(BaseModel):
    id: int
    title: str
    content: str
    category: Optional[KBCategoryOut]
    created_by: UserOut
    tags: Optional[str]
    audience: str = 'all'
    is_published: bool
    views: int
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Companies ─────────────────────────────────────────
class CompanyCreate(BaseModel):
    name: str
    ruc: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    client_category_id: Optional[int] = None


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    ruc: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    client_category_id: Optional[int] = None


class CompanyOut(BaseModel):
    id: int
    name: str
    ruc: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    client_category_id: Optional[int] = None
    client_category: Optional[ClientCategoryOut] = None

    class Config:
        from_attributes = True


# ── Contacts ──────────────────────────────────────────
class ContactCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    ruc: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    ruc: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class ContactOut(BaseModel):
    id: int
    name: str
    email: Optional[str]
    phone: Optional[str]
    company: Optional[str]
    ruc: Optional[str] = None
    address: Optional[str]
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Calendar ──────────────────────────────────────────
class CalendarEventCreate(BaseModel):
    ticket_id: int
    scheduled_at: datetime
    duration_minutes: int = 60
    location: Optional[str] = None
    subject: Optional[str] = None
    attendee_emails: Optional[List[str]] = []
    notes: Optional[str] = None
    bcc_email: Optional[str] = None


class CalendarOrderEventCreate(BaseModel):
    order_id: int
    scheduled_at: datetime
    duration_minutes: int = 60
    location: Optional[str] = None
    notes: Optional[str] = None


class CalendarDispatchEventCreate(BaseModel):
    dispatch_id: int
    scheduled_at: datetime
    duration_minutes: int = 60
    location: Optional[str] = None
    notes: Optional[str] = None


class CalendarVisitCreate(BaseModel):
    ticket_id: int
    scheduled_at: datetime
    duration_minutes: int = 60
    location: Optional[str] = None
    subject: Optional[str] = None
    notes: Optional[str] = None
    bcc_email: Optional[str] = None
    is_remote: bool = False


# ── Dashboard ─────────────────────────────────────────
class DashboardMetrics(BaseModel):
    total_tickets: int
    open_tickets: int
    pending_tickets: int
    resolved_tickets: int
    tickets_by_status: dict
    tickets_by_priority: dict
    tickets_by_agent: List[dict]
    recent_tickets: List[TicketListItem]
    avg_resolution_hours: Optional[float]
    tickets_this_month: int
    tickets_last_month: int
    # SLA
    sla_overdue: int = 0
    sla_at_risk: int = 0
    sla_ok: int = 0
    sla_paused: int = 0
    sla_compliance_rate: Optional[float] = None
    sla_overdue_tickets: List[TicketListItem] = []


# ── Suppliers ─────────────────────────────────────────
class SupplierCreate(BaseModel):
    name: str
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class SupplierOut(BaseModel):
    id: int
    name: str
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    logo_path: Optional[str] = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Orders ────────────────────────────────────────────
class DispatchMini(BaseModel):
    id: int
    title: str
    dispatch_number: Optional[str] = None
    status: str
    date: Optional[_Date] = None

    class Config:
        from_attributes = True


class SupplierMini(BaseModel):
    id: int
    name: str
    logo_path: Optional[str] = None
    category: Optional[str] = None
    class Config:
        from_attributes = True


class QuoteMini(BaseModel):
    id: int
    quote_number: Optional[str] = None
    title: str
    status: str
    client_name: Optional[str] = None
    total: Optional[str] = None
    class Config:
        from_attributes = True


class InvoiceMini(BaseModel):
    id: int
    invoice_number: Optional[str] = None
    status: str
    total: Optional[str] = None
    date: Optional[_Date] = None
    client_name: Optional[str] = None
    class Config:
        from_attributes = True


class OrderAttachmentOut(BaseModel):
    id: int
    order_id: int
    doc_type: str
    original_name: str
    file_size: Optional[int] = None
    content_type: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class OrderCreate(BaseModel):
    title: str
    order_number: Optional[str] = None
    status: str = "Pendiente"
    ticket_id: Optional[int] = None
    quote_id: Optional[int] = None
    invoice_id: Optional[int] = None
    supplier1_id: Optional[int] = None
    supplier2_id: Optional[int] = None
    supplier3_id: Optional[int] = None
    expected_date: Optional[date] = None
    notes: Optional[str] = None
    purchase_items: Optional[str] = None
    purchase_total: Optional[str] = None
    itbms_enabled: bool = False
    shipping_cost: Optional[str] = None
    client_invoice_notes: Optional[str] = None
    payment_terms: Optional[str] = None


class OrderUpdate(BaseModel):
    title: Optional[str] = None
    order_number: Optional[str] = None
    status: Optional[str] = None
    ticket_id: Optional[int] = None
    quote_id: Optional[int] = None
    invoice_id: Optional[int] = None
    supplier1_id: Optional[int] = None
    supplier2_id: Optional[int] = None
    supplier3_id: Optional[int] = None
    expected_date: Optional[date] = None
    notes: Optional[str] = None
    purchase_items: Optional[str] = None
    purchase_total: Optional[str] = None
    itbms_enabled: Optional[bool] = None
    shipping_cost: Optional[str] = None
    client_invoice_notes: Optional[str] = None
    payment_terms: Optional[str] = None


class ExpenseMini(BaseModel):
    id: int
    amount: str = "0.00"
    is_payable: bool = False
    paid_at: Optional[_Date] = None
    due_date: Optional[_Date] = None
    supplier: Optional[str] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True


class OrderOut(BaseModel):
    id: int
    title: str
    order_number: Optional[str] = None
    status: str
    ticket_id: Optional[int] = None
    ticket: Optional[TicketRef] = None
    quote_id: Optional[int] = None
    quote: Optional[QuoteMini] = None
    invoice_id: Optional[int] = None
    invoice: Optional[InvoiceMini] = None
    supplier1_id: Optional[int] = None
    supplier2_id: Optional[int] = None
    supplier3_id: Optional[int] = None
    supplier1: Optional[SupplierMini] = None
    supplier2: Optional[SupplierMini] = None
    supplier3: Optional[SupplierMini] = None
    expected_date: Optional[date] = None
    notes: Optional[str] = None
    purchase_items: Optional[str] = None
    purchase_total: Optional[str] = None
    itbms_enabled: bool = False
    shipping_cost: Optional[str] = None
    inventory_applied: bool = False
    client_invoice_notes: Optional[str] = None
    payment_terms: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    calendar_event_id: Optional[str] = None
    calendar_event_link: Optional[str] = None
    attachments: List[OrderAttachmentOut] = []
    dispatches: List[DispatchMini] = []
    expense: Optional[ExpenseMini] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    @field_validator('dispatches', mode='before')
    @classmethod
    def filter_active_dispatches(cls, v):
        if v is None:
            return []
        return [d for d in v if not getattr(d, 'deleted_at', None)]

    class Config:
        from_attributes = True


# ── Dispatches ────────────────────────────────────────
class DispatchAttachmentOut(BaseModel):
    id: int
    dispatch_id: int
    doc_type: str
    original_name: str
    file_size: Optional[int] = None
    content_type: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class OrderMiniRef(BaseModel):
    id: int
    title: str
    purchase_items: Optional[str] = None
    itbms_enabled: bool = False
    ticket: Optional[TicketMini] = None
    class Config:
        from_attributes = True


class DispatchCreate(BaseModel):
    title: str
    dispatch_number: Optional[str] = None
    order_id: Optional[int] = None
    quote_id: Optional[int] = None
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_address: Optional[str] = None
    date: Optional[_Date] = None
    delivery_date: Optional[_Date] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    status: str = "Borrador"
    notes: Optional[str] = None
    items: Optional[str] = None
    itbms_enabled: bool = False
    subtotal: Optional[str] = None
    itbms_amount: Optional[str] = None
    total: Optional[str] = None


class DispatchUpdate(BaseModel):
    title: Optional[str] = None
    dispatch_number: Optional[str] = None
    order_id: Optional[int] = None
    quote_id: Optional[int] = None
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_address: Optional[str] = None
    date: Optional[_Date] = None
    delivery_date: Optional[_Date] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[str] = None
    itbms_enabled: Optional[bool] = None
    subtotal: Optional[str] = None
    itbms_amount: Optional[str] = None
    total: Optional[str] = None


class DispatchOut(BaseModel):
    id: int
    title: str
    dispatch_number: Optional[str] = None
    order_id: Optional[int] = None
    order: Optional[OrderMiniRef] = None
    quote_id: Optional[int] = None
    quote: Optional[QuoteMini] = None
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_address: Optional[str] = None
    date: Optional[_Date] = None
    delivery_date: Optional[_Date] = None
    status: str
    notes: Optional[str] = None
    items: Optional[str] = None
    itbms_enabled: bool = False
    subtotal: Optional[str] = None
    itbms_amount: Optional[str] = None
    total: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    calendar_event_id: Optional[str] = None
    calendar_event_link: Optional[str] = None
    inventory_applied: bool = False
    invoice: Optional[InvoiceMini] = None
    attachments: List[DispatchAttachmentOut] = []
    created_at: datetime
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Warranties ────────────────────────────────────────
class WarrantyItemCreate(BaseModel):
    type: str = ""
    description: str = ""
    brand: str = ""
    model: str = ""
    serial: str = ""
    sort_order: int = 0


class WarrantyItemOut(BaseModel):
    id: int
    type: Optional[str] = None
    description: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    serial: Optional[str] = None
    sort_order: int = 0

    class Config:
        from_attributes = True


class WarrantyCreate(BaseModel):
    cert_number: str
    client_name: str = ""
    client_company: str = ""
    client_ruc: str = ""
    issue_date: str = ""
    warranty_period: str = ""
    warranty_end: str = ""
    technician: str = ""
    notes: str = ""
    invoice_id: Optional[int] = None
    items: List[WarrantyItemCreate] = []


class WarrantyUpdate(WarrantyCreate):
    pass


class InvoiceRef(BaseModel):
    id: int
    invoice_number: Optional[str] = None
    client_name: Optional[str] = None
    total: Optional[str] = None

    class Config:
        from_attributes = True


class WarrantyOut(BaseModel):
    id: int
    cert_number: str
    client_name: Optional[str] = None
    client_company: Optional[str] = None
    client_ruc: Optional[str] = None
    issue_date: Optional[str] = None
    warranty_period: Optional[str] = None
    warranty_end: Optional[str] = None
    technician: Optional[str] = None
    notes: Optional[str] = None
    invoice_id: Optional[int] = None
    invoice: Optional[InvoiceRef] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    items: List[WarrantyItemOut] = []

    class Config:
        from_attributes = True


# ── Quotes ────────────────────────────────────────────
class QuoteCreate(BaseModel):
    title: str
    quote_number: Optional[str] = None
    status: str = "Borrador"
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_address: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_id: Optional[int] = None
    date: Optional[_Date] = None
    valid_until: Optional[_Date] = None
    items: Optional[str] = None
    itbms_enabled: bool = False
    shipping_cost: Optional[str] = None
    subtotal: Optional[str] = None
    itbms_amount: Optional[str] = None
    total: Optional[str] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    ticket_id: Optional[int] = None


class QuoteUpdate(BaseModel):
    title: Optional[str] = None
    quote_number: Optional[str] = None
    status: Optional[str] = None
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_address: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_id: Optional[int] = None
    date: Optional[_Date] = None
    valid_until: Optional[_Date] = None
    items: Optional[str] = None
    itbms_enabled: Optional[bool] = None
    shipping_cost: Optional[str] = None
    subtotal: Optional[str] = None
    itbms_amount: Optional[str] = None
    total: Optional[str] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    order_id: Optional[int] = None
    ticket_id: Optional[int] = None


class QuoteOut(BaseModel):
    id: int
    title: str
    quote_number: Optional[str] = None
    status: str
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_address: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_id: Optional[int] = None
    date: Optional[_Date] = None
    valid_until: Optional[_Date] = None
    items: Optional[str] = None
    itbms_enabled: bool = False
    shipping_cost: Optional[str] = None
    subtotal: Optional[str] = None
    itbms_amount: Optional[str] = None
    total: Optional[str] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    order_id: Optional[int] = None
    ticket_id: Optional[int] = None
    ticket: Optional[TicketMini] = None
    linked_invoices: List["InvoiceMini"] = []
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Invoices ──────────────────────────────────────────
class InvoiceCreate(BaseModel):
    invoice_number: Optional[str] = None
    status: str = "Borrador"
    dispatch_id: Optional[int] = None
    ticket_id: Optional[int] = None
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_address: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_id: Optional[int] = None
    date: Optional[_Date] = None
    due_date: Optional[_Date] = None
    items: Optional[str] = None
    itbms_enabled: bool = False
    shipping_cost: Optional[str] = None
    subtotal: Optional[str] = None
    itbms_amount: Optional[str] = None
    total: Optional[str] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None


class InvoiceUpdate(BaseModel):
    invoice_number: Optional[str] = None
    status: Optional[str] = None
    dispatch_id: Optional[int] = None
    ticket_id: Optional[int] = None
    quote_id: Optional[int] = None
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_address: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_id: Optional[int] = None
    date: Optional[_Date] = None
    due_date: Optional[_Date] = None
    items: Optional[str] = None
    itbms_enabled: Optional[bool] = None
    shipping_cost: Optional[str] = None
    subtotal: Optional[str] = None
    itbms_amount: Optional[str] = None
    total: Optional[str] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None


class DispatchRef(BaseModel):
    id: int
    dispatch_number: Optional[str] = None
    title: str

    class Config:
        from_attributes = True


class InvoicePaymentCreate(BaseModel):
    amount: str
    method: str = "Efectivo"
    date: str
    notes: Optional[str] = None


class InvoicePaymentUpdate(BaseModel):
    amount: Optional[str] = None
    method: Optional[str] = None
    date: Optional[str] = None
    notes: Optional[str] = None


class InvoicePaymentOut(BaseModel):
    id: int
    invoice_id: int
    amount: str
    method: str
    date: _Date
    notes: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class InvoicePaymentWithInvoice(InvoicePaymentOut):
    invoice_number: Optional[str] = None
    client_name: Optional[str] = None
    invoice_status: Optional[str] = None


class InvoiceAttachmentOut(BaseModel):
    id: int
    invoice_id: int
    original_name: str
    file_size: Optional[int] = None
    content_type: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class InvoiceOut(BaseModel):
    id: int
    invoice_number: Optional[str] = None
    status: str
    dispatch_id: Optional[int] = None
    dispatch: Optional[DispatchRef] = None
    ticket_id: Optional[int] = None
    ticket: Optional[TicketMini] = None
    quote_id: Optional[int] = None
    quote: Optional[QuoteMini] = None
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_address: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_id: Optional[int] = None
    date: Optional[_Date] = None
    due_date: Optional[_Date] = None
    items: Optional[str] = None
    itbms_enabled: bool = False
    shipping_cost: Optional[str] = None
    subtotal: Optional[str] = None
    itbms_amount: Optional[str] = None
    total: Optional[str] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    inventory_applied: bool = False
    dgi_filename: Optional[str] = None
    dgi_original_name: Optional[str] = None
    payments: List[InvoicePaymentOut] = []
    linked_quotes: List[QuoteMini] = []
    attachments: List[InvoiceAttachmentOut] = []
    created_at: datetime
    updated_at: Optional[datetime] = None
    unlinked_dispatch_warning: bool = False

    class Config:
        from_attributes = True


# ── Expenses ──────────────────────────────────────────
class ExpenseAttachmentOut(BaseModel):
    id: int
    expense_id: int
    original_name: str
    file_size: Optional[int] = None
    content_type: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class OrderExpenseRef(BaseModel):
    id: int
    title: str
    order_number: Optional[str] = None

    class Config:
        from_attributes = True


class ExpenseCreate(BaseModel):
    concept: str
    amount: str = "0.00"
    category: Optional[str] = None
    date: Optional[str] = None
    supplier: Optional[str] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None
    is_payable: bool = False
    due_date: Optional[_Date] = None
    paid_at: Optional[_Date] = None


class ExpenseUpdate(BaseModel):
    concept: Optional[str] = None
    amount: Optional[str] = None
    category: Optional[str] = None
    date: Optional[str] = None
    supplier: Optional[str] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None
    is_payable: Optional[bool] = None
    due_date: Optional[_Date] = None
    paid_at: Optional[_Date] = None
    order_id: Optional[int] = None


class InvoiceExpenseItem(BaseModel):
    id: Optional[int] = None          # None = crear, int = actualizar
    concept: str
    amount: str = "0.00"
    supplier: Optional[str] = None
    is_payable: bool = False
    due_date: Optional[_Date] = None
    paid_at: Optional[_Date] = None


class ExpenseOut(BaseModel):
    id: int
    concept: str
    amount: str
    category: Optional[str] = None
    date: Optional[str] = None
    type: str
    order_id: Optional[int] = None
    invoice_id: Optional[int] = None
    order: Optional[OrderExpenseRef] = None
    supplier: Optional[str] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None
    is_payable: bool = False
    due_date: Optional[_Date] = None
    paid_at: Optional[_Date] = None
    attachments: List[ExpenseAttachmentOut] = []
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Letters ───────────────────────────────────────────
class LetterCreate(BaseModel):
    letter_number: Optional[str] = None
    letter_type: Optional[str] = None
    status: str = "Borrador"
    recipient_name: Optional[str] = None
    recipient_company: Optional[str] = None
    recipient_ruc: Optional[str] = None
    recipient_address: Optional[str] = None
    recipient_email: Optional[str] = None
    date: Optional[str] = None
    subject: Optional[str] = Field(None, max_length=500)
    body: Optional[str] = Field(None, max_length=50_000)
    attention_to: Optional[str] = None
    signer_name: Optional[str] = None
    signer_title: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=5_000)


class LetterOut(BaseModel):
    id: int
    letter_number: Optional[str] = None
    letter_type: Optional[str] = None
    status: str
    recipient_name: Optional[str] = None
    recipient_company: Optional[str] = None
    recipient_ruc: Optional[str] = None
    recipient_address: Optional[str] = None
    recipient_email: Optional[str] = None
    date: Optional[_Date] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    attention_to: Optional[str] = None
    signer_name: Optional[str] = None
    signer_title: Optional[str] = None
    notes: Optional[str] = None
    created_by_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Inventory ─────────────────────────────────────────
class InventoryItemCreate(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    unit: Optional[str] = "unidad"
    unit_price: Optional[str] = "0.00"
    cost_price: Optional[str] = "0.00"
    quantity: Optional[str] = "0"
    category: Optional[str] = None
    notes: Optional[str] = None
    warehouse: Optional[str] = "principal"


class InventoryItemUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    unit_price: Optional[str] = None
    cost_price: Optional[str] = None
    quantity: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    warehouse: Optional[str] = None


class InventoryItemOut(BaseModel):
    id: int
    code: str
    name: str
    description: Optional[str] = None
    unit: Optional[str] = None
    unit_price: Optional[str] = None
    cost_price: Optional[str] = None
    quantity: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool
    warehouse: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class InventoryTransactionOut(BaseModel):
    id: int
    item_code: str
    qty_delta: str
    source_type: str
    source_id: Optional[int] = None
    notes: Optional[str] = None
    created_at: datetime
    item_name: Optional[str] = None
    source_label: Optional[str] = None
    client_name: Optional[str] = None
    client_company: Optional[str] = None
    ticket_id: Optional[int] = None

    class Config:
        from_attributes = True


# ── Canned Responses ──────────────────────────────────
class CannedResponseCreate(BaseModel):
    title: str
    content: str
    category: Optional[str] = None

class CannedResponseUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    is_active: Optional[bool] = None

class CannedResponseOut(BaseModel):
    id: int
    title: str
    content: str
    category: Optional[str] = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Time Tracking ─────────────────────────────────────
class TimeLogCreate(BaseModel):
    minutes: int
    description: Optional[str] = None

class TimeLogOut(BaseModel):
    id: int
    ticket_id: int
    user: UserOut
    minutes: int
    description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Software Licenses ─────────────────────────────────
class SoftwareLicenseCreate(BaseModel):
    license_number: Optional[str] = None
    software_name: str
    software_version: Optional[str] = None
    license_type: Optional[str] = None
    license_key: Optional[str] = None
    seats: int = 1
    purchase_date: Optional[_Date] = None
    expiry_date: Optional[_Date] = None
    validity_period: Optional[str] = None
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_address: Optional[str] = None
    invoice_ref: Optional[str] = None
    supplier: Optional[str] = None
    notes: Optional[str] = None
    status: str = "Borrador"


class SoftwareLicenseUpdate(SoftwareLicenseCreate):
    software_name: Optional[str] = None
    seats: Optional[int] = None
    status: Optional[str] = None


class SoftwareLicenseOut(BaseModel):
    id: int
    license_number: Optional[str] = None
    software_name: str
    software_version: Optional[str] = None
    license_type: Optional[str] = None
    license_key: Optional[str] = None
    seats: int = 1
    purchase_date: Optional[_Date] = None
    expiry_date: Optional[_Date] = None
    validity_period: Optional[str] = None
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_address: Optional[str] = None
    invoice_ref: Optional[str] = None
    supplier: Optional[str] = None
    notes: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: Optional[datetime] = None
    class Config:
        from_attributes = True


# ── Opportunities ─────────────────────────────────────
class UserMiniOut(BaseModel):
    id: int
    name: str
    email: str
    class Config:
        from_attributes = True


class OppQuoteMini(BaseModel):
    id: int
    quote_number: Optional[str] = None
    status: str
    total: Optional[str] = None
    class Config:
        from_attributes = True


class OppVisitOut(BaseModel):
    id: int
    opportunity_id: int
    scheduled_at: datetime
    duration_minutes: Optional[int]
    calendar_event_id: Optional[str] = None
    calendar_event_link: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = "scheduled"
    created_at: datetime
    class Config:
        from_attributes = True


class OppVisitCreate(BaseModel):
    opportunity_id: int
    scheduled_at: datetime
    duration_minutes: int = 60
    notes: Optional[str] = None
    location: Optional[str] = None


class OppVisitUpdate(BaseModel):
    scheduled_at: datetime
    duration_minutes: int = 60
    notes: Optional[str] = None


class OpportunityCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "Nueva"
    priority: str = "Media"
    source: Optional[str] = None
    estimated_value: Optional[str] = None
    probability: int = 50
    expected_close_date: Optional[_Date] = None
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_address: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    assigned_to_id: Optional[int] = None


class OpportunityUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    source: Optional[str] = None
    estimated_value: Optional[str] = None
    probability: Optional[int] = None
    expected_close_date: Optional[_Date] = None
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_address: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    assigned_to_id: Optional[int] = None
    quote_id: Optional[int] = None


class OpportunityOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    status: str
    priority: str
    source: Optional[str] = None
    estimated_value: Optional[str] = None
    probability: int
    expected_close_date: Optional[_Date] = None
    client_name: Optional[str] = None
    client_ruc: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_address: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    assigned_to_id: Optional[int] = None
    created_by_id: Optional[int] = None
    quote_id: Optional[int] = None
    assignee: Optional[UserMiniOut] = None
    quote: Optional[OppQuoteMini] = None
    visits: List[OppVisitOut] = []
    created_at: datetime
    updated_at: Optional[datetime] = None
    class Config:
        from_attributes = True


# ── Projects ──────────────────────────────────────────
class ProjectMini(BaseModel):
    id: int
    name: str
    status: str
    class Config:
        from_attributes = True

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    status: str = "Activo"
    client_id: Optional[int] = None
    start_date: Optional[_Date] = None
    end_date: Optional[_Date] = None
    budget: Optional[str] = None
    quote_id: Optional[int] = None
    notes: Optional[str] = None

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    client_id: Optional[int] = None
    start_date: Optional[_Date] = None
    end_date: Optional[_Date] = None
    budget: Optional[str] = None
    quote_id: Optional[int] = None
    notes: Optional[str] = None

class ProjectOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    status: str
    client_id: Optional[int] = None
    client: Optional[UserOut] = None
    start_date: Optional[_Date] = None
    end_date: Optional[_Date] = None
    budget: Optional[str] = None
    quote_id: Optional[int] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    # computed stats (injected by endpoint)
    total_tickets: int = 0
    resolved_tickets: int = 0
    progress: int = 0
    class Config:
        from_attributes = True


# ── MPS: Contratos, Impresoras, Lecturas de contador ──
class MeterReadingCreate(BaseModel):
    reading_date: _Date
    bw_count: int = 0
    color_count: int = 0
    notes: Optional[str] = None


class MeterReadingOut(BaseModel):
    id: int
    printer_id: int
    reading_date: _Date
    bw_count: int
    color_count: int
    notes: Optional[str] = None
    created_by_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PrinterCreate(BaseModel):
    equipment_type: Optional[str] = "impresora"
    brand: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    ownership_type: str = "cliente"
    contract_id: Optional[int] = None
    warranty_start_date: Optional[_Date] = None
    warranty_end_date: Optional[_Date] = None
    asset_id: Optional[str] = None
    ip_address: Optional[str] = None
    contact_name: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = "Activa"


class PrinterUpdate(PrinterCreate):
    ownership_type: Optional[str] = None
    status: Optional[str] = None


class PrinterOut(BaseModel):
    id: int
    equipment_type: Optional[str] = "impresora"
    brand: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    ownership_type: str
    contract_id: Optional[int] = None
    inventory_item_id: Optional[int] = None
    warranty_start_date: Optional[_Date] = None
    warranty_end_date: Optional[_Date] = None
    asset_id: Optional[str] = None
    ip_address: Optional[str] = None
    contact_name: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    meter_readings: List[MeterReadingOut] = []

    class Config:
        from_attributes = True


class ContractCreate(BaseModel):
    contract_number: Optional[str] = None
    client_name: Optional[str] = None
    client_company: Optional[str] = None
    client_ruc: Optional[str] = None
    client_id: Optional[int] = None
    status: str = "Activo"
    contract_type: Optional[str] = "Soporte Mensual"
    start_date: Optional[_Date] = None
    end_date: Optional[_Date] = None
    billing_cycle: Optional[str] = "Mensual"
    monthly_base_fee: Optional[str] = None
    service_scope: Optional[str] = None
    response_time: Optional[str] = None
    coverage_hours: Optional[str] = None
    included_hours: int = 0
    included_visits: int = 0
    notes: Optional[str] = None


class ContractUpdate(ContractCreate):
    status: Optional[str] = None


class ContractOut(BaseModel):
    id: int
    contract_number: Optional[str] = None
    client_name: Optional[str] = None
    client_company: Optional[str] = None
    client_ruc: Optional[str] = None
    client_id: Optional[int] = None
    status: str
    contract_type: Optional[str] = "Soporte Mensual"
    start_date: Optional[_Date] = None
    end_date: Optional[_Date] = None
    billing_cycle: Optional[str] = None
    monthly_base_fee: Optional[str] = None
    service_scope: Optional[str] = None
    response_time: Optional[str] = None
    coverage_hours: Optional[str] = None
    included_hours: int = 0
    included_visits: int = 0
    notes: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Supply Lots ───────────────────────────────────────
class SupplyLotCreate(BaseModel):
    item_code: str
    item_name: str
    supplier_id: Optional[int] = None
    entry_date: _Date
    unit_cost: Optional[str] = "0.00"
    quantity_received: int = 1
    notes: Optional[str] = None


class SupplyLotUpdate(BaseModel):
    item_code: Optional[str] = None
    item_name: Optional[str] = None
    supplier_id: Optional[int] = None
    entry_date: Optional[_Date] = None
    unit_cost: Optional[str] = None
    quantity_received: Optional[int] = None
    notes: Optional[str] = None


class SupplyLotOut(BaseModel):
    id: int
    item_code: str
    item_name: str
    supplier_id: Optional[int] = None
    entry_date: _Date
    unit_cost: Optional[str] = None
    quantity_received: int
    notes: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    dispatched_qty: int = 0
    available: int = 0

    class Config:
        from_attributes = True


# ── Supply Deliveries ────────────────────────────────
class SupplyDispatchLineIn(BaseModel):
    item_code: str                          # el sistema asigna lote(s) por FIFO
    quantity_dispatched: int = 1
    serial_number: Optional[str] = None    # serie del suministro (cartucho, etc.)
    exit_price: Optional[str] = "0.00"
    printer_id: Optional[int] = None
    notes: Optional[str] = None


class SupplyDispatchLineOut(BaseModel):
    id: int
    lot_id: int
    item_code: str = ""
    item_name: str = ""
    quantity_dispatched: int
    serial_number: Optional[str] = None
    exit_price: Optional[str] = None
    unit_cost: Optional[str] = None
    printer_id: Optional[int] = None
    printer_snapshot: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class SupplyDeliveryCreate(BaseModel):
    delivery_date: _Date
    contract_id: Optional[int] = None
    client_id: Optional[int] = None
    client_name: Optional[str] = None
    dispatch_condition: Optional[str] = None
    delivery_method: Optional[str] = None
    notes: Optional[str] = None
    lines: List[SupplyDispatchLineIn]


class SupplyDispatchLineUpdate(BaseModel):
    id: int
    serial_number: Optional[str] = None
    exit_price: Optional[str] = None
    printer_id: Optional[int] = None
    notes: Optional[str] = None


class SupplyDeliveryUpdate(BaseModel):
    delivery_date: Optional[_Date] = None
    notes: Optional[str] = None
    client_name: Optional[str] = None
    dispatch_condition: Optional[str] = None
    delivery_method: Optional[str] = None
    lines: Optional[List[SupplyDispatchLineUpdate]] = None
    add_lines: Optional[List[SupplyDispatchLineIn]] = None


class SupplyDeliveryOut(BaseModel):
    id: int
    delivery_number: Optional[str] = None
    delivery_date: _Date
    contract_id: Optional[int] = None
    contract_number: Optional[str] = None
    contract_client: Optional[str] = None
    client_id: Optional[int] = None
    client_name: Optional[str] = None
    invoice_id: Optional[int] = None
    invoice_number: Optional[str] = None
    dispatch_condition: Optional[str] = None
    delivery_method: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    lines: List[SupplyDispatchLineOut] = []

    class Config:
        from_attributes = True


Token.model_rebuild()
TicketOut.model_rebuild()
TicketListItem.model_rebuild()
