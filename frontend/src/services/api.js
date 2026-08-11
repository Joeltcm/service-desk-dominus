import axios from 'axios'

const api = axios.create({ baseURL: (import.meta.env.BASE_URL || '/') + 'api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const hadToken = !!(localStorage.getItem('token') || sessionStorage.getItem('token'))
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      sessionStorage.removeItem('token')
      sessionStorage.removeItem('user')
      if (hadToken) window.location.href = '/login'
    }
    if (err.response?.status === 402) {
      window.dispatchEvent(new CustomEvent('trial-expired'))
    }
    return Promise.reject(err)
  }
)

// Auth
export const getCaptcha = () => api.get('/auth/captcha')
export const login = (email, password, captchaId, captchaAnswer, rememberMe = false) =>
  api.post('/auth/login', { email, password, captcha_id: captchaId, captcha_answer: captchaAnswer, remember_me: rememberMe })
export const register = (data) => api.post('/auth/register', data)
export const forgotPassword = (email, baseUrl) =>
  api.post('/auth/forgot-password', { email, base_url: baseUrl })
export const resetPassword = (token, newPassword) =>
  api.post('/auth/reset-password', { token, new_password: newPassword })
export const getMe = () => api.get('/auth/me')
export const updateMe = (data) => api.put('/auth/me', data)

// Users
export const getUsers = () => api.get('/users')
export const getAgents = () => api.get('/users/agents')
export const getClients = () => api.get('/users/clients')
export const createUser = (data) => api.post('/users', data)
export const updateUser = (id, data) => api.put(`/users/${id}`, data)
export const deleteUser = (id) => api.delete(`/users/${id}`)
export const uploadMySignature = (signature) => api.post('/users/me/signature', { signature })
export const deleteMySignature = () => api.post('/users/me/signature', { signature: null })
export const uploadMyPhoto = (photo) => api.post('/users/me/photo', { photo })
export const deleteMyPhoto = () => api.post('/users/me/photo', { photo: null })

// Client Categories
export const getClientCategories = () => api.get('/users/client-categories')
export const createClientCategory = (data) => api.post('/users/client-categories', data)
export const updateClientCategory = (id, data) => api.put(`/users/client-categories/${id}`, data)
export const deleteClientCategory = (id) => api.delete(`/users/client-categories/${id}`)

// Categories
export const getCategories = () => api.get('/tickets/categories')

// Statuses
export const getStatuses = () => api.get('/tickets/statuses')
export const createStatus = (data) => api.post('/tickets/statuses', data)
export const updateStatus = (id, data) => api.put(`/tickets/statuses/${id}`, data)
export const deleteStatus = (id) => api.delete(`/tickets/statuses/${id}`)

// Tickets
export const getTickets = (params) => api.get('/tickets', { params })
export const getTicket = (id) => api.get(`/tickets/${id}`)
export const createTicket = (data) => api.post('/tickets', data)
export const updateTicket = (id, data) => api.put(`/tickets/${id}`, data)
export const deleteTicket = (id) => api.delete(`/tickets/${id}`)
export const deleteTickets = (ids) => api.post('/tickets/bulk-delete', { ids })
export const linkTicket = (id, parentId) => api.post(`/tickets/${id}/link`, { parent_id: parentId })
export const unlinkTicket = (id) => api.delete(`/tickets/${id}/link`)

// Timeline
export const getTimeline = (ticketId) => api.get(`/tickets/${ticketId}/timeline`)
export const addTimelineEntry = (ticketId, data) => api.post(`/tickets/${ticketId}/timeline`, data)
export const deleteTimelineEntry = (ticketId, entryId) => api.delete(`/tickets/${ticketId}/timeline/${entryId}`)

// Attachments
export const getAttachments = (ticketId) => api.get(`/tickets/${ticketId}/attachments`)
export const uploadAttachment = (ticketId, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/tickets/${ticketId}/attachments`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const deleteAttachment = (ticketId, attId) => api.delete(`/tickets/${ticketId}/attachments/${attId}`)
export const downloadAttachmentUrl = (ticketId, attId) => `/api/tickets/${ticketId}/attachments/${attId}/download`

// Calendar
export const getCalendarStatus = () => api.get('/calendar/status')
export const getCalendarAuthUrl = () => api.get('/calendar/auth-url')
export const disconnectCalendar = () => api.delete('/calendar/disconnect')
export const createCalendarEvent = (data) => api.post('/calendar/create-event', data)
export const deleteCalendarEvent = (ticketId) => api.delete(`/calendar/event/${ticketId}`)
export const createTicketVisit = (data) => api.post('/calendar/visits', data)
export const deleteTicketVisit = (visitId) => api.delete(`/calendar/visits/${visitId}`)
export const rescheduleTicketVisit = (visitId, data) => api.put(`/calendar/visits/${visitId}`, data)
export const cancelTicketVisit = (visitId) => api.post(`/calendar/visits/${visitId}/cancel`)
export const pushVisitToGoogle = (visitId) => api.post(`/calendar/visits/${visitId}/push-to-google`)
export const updateVisitCosto = (visitId, costo) => api.patch(`/calendar/visits/${visitId}/costo`, { costo })
export const getAgenda = (year, month) => api.get('/calendar/agenda', { params: { year, month } })
export const checkCalendarConflicts = (start, durationMinutes, excludeTicketId) =>
  api.get('/calendar/conflicts', { params: { start, duration_minutes: durationMinutes, exclude_ticket_id: excludeTicketId } })
export const createOrderCalendarEvent = (data) => api.post('/calendar/create-event-order', data)
export const deleteOrderCalendarEvent = (orderId) => api.delete(`/calendar/event-order/${orderId}`)
export const applyOrderInventory = (orderId) => api.post(`/orders/${orderId}/apply-inventory`)
export const createDispatchCalendarEvent = (data) => api.post('/calendar/create-event-dispatch', data)
export const deleteDispatchCalendarEvent = (dispatchId) => api.delete(`/calendar/event-dispatch/${dispatchId}`)
export const syncCalendar = () => api.post('/calendar/sync')

// Push notifications
export const getPushStatus = () => api.get('/push/status')
export const testPushNotification = () => api.post('/push/test')

// Knowledge Base
export const getKBCategories = () => api.get('/kb/categories')
export const createKBCategory = (data) => api.post('/kb/categories', data)
export const updateKBCategory = (id, data) => api.put(`/kb/categories/${id}`, data)
export const deleteKBCategory = (id) => api.delete(`/kb/categories/${id}`)
export const getKBArticles = (params) => api.get('/kb/articles', { params })
export const getKBArticle = (id) => api.get(`/kb/articles/${id}`)
export const createKBArticle = (data) => api.post('/kb/articles', data)
export const updateKBArticle = (id, data) => api.put(`/kb/articles/${id}`, data)
export const deleteKBArticle = (id) => api.delete(`/kb/articles/${id}`)

// Companies
export const getCompanies = (q) => api.get('/companies', { params: q ? { q } : {} })
export const createCompany = (data) => api.post('/companies', data)
export const updateCompany = (id, data) => api.put(`/companies/${id}`, data)
export const deleteCompany = (id) => api.delete(`/companies/${id}`)

// Contacts
export const getContacts = (q) => api.get('/contacts', { params: q ? { q } : {} })
export const createContact = (data) => api.post('/contacts', data)
export const updateContact = (id, data) => api.put(`/contacts/${id}`, data)
export const deleteContact = (id) => api.delete(`/contacts/${id}`)
export const getClientTickets = (userId) => api.get(`/contacts/client/${userId}/tickets`)

// Suppliers
export const getSuppliers = (params) => api.get('/suppliers', { params })
export const createSupplier = (data) => api.post('/suppliers', data)
export const updateSupplier = (id, data) => api.put(`/suppliers/${id}`, data)
export const deleteSupplier = (id) => api.delete(`/suppliers/${id}`)
export const uploadSupplierLogo = (id, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/suppliers/${id}/logo`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
}
export const deleteSupplierLogo = (id) => api.delete(`/suppliers/${id}/logo`)
export const supplierLogoUrl = (id) => `/api/suppliers/${id}/logo`

// Orders
export const getOrders = (params) => api.get('/orders', { params })
export const getNextOrderNumber = () => api.get('/orders/next-number')
export const getOrder = (id) => api.get(`/orders/${id}`)
export const createOrder = (data) => api.post('/orders', data)
export const updateOrder = (id, data) => api.put(`/orders/${id}`, data)
export const deleteOrder = (id) => api.delete(`/orders/${id}`)
export const getOrderAttachments = (orderId) => api.get(`/orders/${orderId}/attachments`)
export const uploadOrderAttachment = (orderId, file, docType) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/orders/${orderId}/attachments?doc_type=${docType}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const deleteOrderAttachment = (orderId, attId) => api.delete(`/orders/${orderId}/attachments/${attId}`)
export const orderAttachmentDownloadUrl = (orderId, attId) => `/api/orders/${orderId}/attachments/${attId}/download`

// Dispatches
export const getNextDispatchNumber = () => api.get('/despachos/next-number')
export const getDispatches = (params) => api.get('/despachos', { params })
export const createDispatch = (data) => api.post('/despachos', data)
export const updateDispatch = (id, data) => api.put(`/despachos/${id}`, data)
export const deleteDispatch = (id) => api.delete(`/despachos/${id}`)
export const getMyDispatches = () => api.get('/despachos/mis')
export const createClientDispatch = (data) => api.post('/despachos/mis', data)
export const cancelDispatch = (id) => api.post(`/despachos/${id}/cancel`)
export const getDispatchTimeline = (id) => api.get(`/despachos/${id}/timeline`)
export const addDispatchTimeline = (id, data) => api.post(`/despachos/${id}/timeline`, data)
export const updateDispatchTimeline = (id, entryId, content) => api.patch(`/despachos/${id}/timeline/${entryId}`, { content })
export const deleteDispatchTimeline = (id, entryId) => api.delete(`/despachos/${id}/timeline/${entryId}`)
export const getDispatchTaskSuggestions = () => api.get('/despachos/tasks/suggestions')
export const getDispatchTasks = (id) => api.get(`/despachos/${id}/tasks`)
export const addDispatchTask = (id, title) => api.post(`/despachos/${id}/tasks`, { title })
export const updateDispatchTask = (id, taskId, data) => api.patch(`/despachos/${id}/tasks/${taskId}`, data)
export const deleteDispatchTask = (id, taskId) => api.delete(`/despachos/${id}/tasks/${taskId}`)
export const getDispatchParts = (id) => api.get(`/despachos/${id}/parts`)
export const addDispatchPart = (id, item_code, qty) => api.post(`/despachos/${id}/parts`, { item_code, qty })
export const deleteDispatchPart = (id, partId) => api.delete(`/despachos/${id}/parts/${partId}`)
export const uploadDispatchAttachment = (dispatchId, file, docType) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/despachos/${dispatchId}/attachments?doc_type=${docType}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const deleteDispatchAttachment = (dispatchId, attId) => api.delete(`/despachos/${dispatchId}/attachments/${attId}`)
export const dispatchAttachmentDownloadUrl = (dispatchId, attId) => `/api/despachos/${dispatchId}/attachments/${attId}/download`

// Invoices
export const getNextInvoiceNumber = () => api.get('/facturas/next-number')
export const getMyInvoices = () => api.get('/facturas/my')
export const getInvoices = (params) => api.get('/facturas', { params })
export const getInvoice = (id) => api.get(`/facturas/${id}`)
export const createInvoice = (data) => api.post('/facturas', data)
export const createInvoiceFromDispatch = (dispatchId) => api.post(`/facturas/from-dispatch/${dispatchId}`)
export const updateInvoice = (id, data) => api.put(`/facturas/${id}`, data)
export const deleteInvoice = (id) => api.delete(`/facturas/${id}`)
export const cloneInvoice = (id) => api.post(`/facturas/${id}/clone`)
export const sendInvoiceEmail = (id, data) => api.post(`/facturas/${id}/send-email`, data)
export const applyInvoiceInventory  = (id) => api.post(`/facturas/${id}/apply-inventory`)
export const checkInvoiceInventory  = (id) => api.get(`/facturas/${id}/check-inventory`)
export const validateInvoiceItems   = (items) => api.post(`/facturas/validate-items`, { items })
export const getInvoiceExpenses     = (id) => api.get(`/facturas/${id}/expenses`)
export const syncInvoiceExpenses    = (id, items) => api.put(`/facturas/${id}/expenses`, items)
export const getInvoiceCogs         = (id) => api.get(`/facturas/${id}/cogs`)
export const uploadDgiAttachment    = (id, file) => { const fd = new FormData(); fd.append('file', file); return api.post(`/facturas/${id}/dgi-attachment`, fd) }
export const downloadDgiAttachment  = (id) => `${api.defaults.baseURL}/facturas/${id}/dgi-attachment`
export const deleteDgiAttachment    = (id) => api.delete(`/facturas/${id}/dgi-attachment`)
export const getMyDgiAttachment     = (id) => api.get(`/facturas/${id}/dgi-attachment/my`, { responseType: 'blob' })
export const getDgiAttachment       = (id) => api.get(`/facturas/${id}/dgi-attachment`, { responseType: 'blob' })
export const uploadInvoiceAttachment   = (id, file) => { const fd = new FormData(); fd.append('file', file); return api.post(`/facturas/${id}/attachments`, fd) }
export const deleteInvoiceAttachment   = (id, attId) => api.delete(`/facturas/${id}/attachments/${attId}`)
export const downloadInvoiceAttachment = (id, attId) => `${api.defaults.baseURL}/facturas/${id}/attachments/${attId}/download`
export const getInvoiceAttachment      = (id, attId) => api.get(`/facturas/${id}/attachments/${attId}/download`, { responseType: 'blob' })
export const getMyInvoiceAttachment    = (id, attId) => api.get(`/facturas/${id}/attachments/${attId}/my`, { responseType: 'blob' })
export const addInvoiceQuoteLink    = (invoiceId, quoteId) => api.post(`/facturas/${invoiceId}/quote-links`, { quote_id: quoteId })
export const removeInvoiceQuoteLink = (invoiceId, quoteId) => api.delete(`/facturas/${invoiceId}/quote-links/${quoteId}`)
export const getAllPayments = (params) => api.get('/facturas/payments/all', { params })
export const getInvoicePayments = (id) => api.get(`/facturas/${id}/payments`)
export const createInvoicePayment = (id, data) => api.post(`/facturas/${id}/payments`, data)
export const updateInvoicePayment = (invoiceId, paymentId, data) => api.put(`/facturas/${invoiceId}/payments/${paymentId}`, data)
export const deleteInvoicePayment = (invoiceId, paymentId) => api.delete(`/facturas/${invoiceId}/payments/${paymentId}`)
export const importPaymentsCSV = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post('/facturas/import-payments-csv', fd)
}

// ── Projects ──────────────────────────────────────────
export const getProjects       = (params) => api.get('/projects', { params })
export const getProject        = (id) => api.get(`/projects/${id}`)
export const createProject     = (data) => api.post('/projects', data)
export const updateProject     = (id, data) => api.put(`/projects/${id}`, data)
export const deleteProject     = (id) => api.delete(`/projects/${id}`)
export const getProjectTickets = (id) => api.get(`/projects/${id}/tickets`)
export const linkTicketToProject     = (projectId, ticketId) => api.post(`/projects/${projectId}/tickets/${ticketId}`)
export const unlinkTicketFromProject = (projectId, ticketId) => api.delete(`/projects/${projectId}/tickets/${ticketId}`)
export const setTicketWeight         = (projectId, ticketId, weight) => api.put(`/projects/${projectId}/tickets/${ticketId}/weight`, { weight })

// Quotes
export const getNextQuoteNumber = () => api.get('/quotes/next-number')
export const getMyQuotes = () => api.get('/quotes/my')
export const getQuotes = (params) => api.get('/quotes', { params })
export const getQuote = (id) => api.get(`/quotes/${id}`)
export const createQuote = (data) => api.post('/quotes', data)
export const updateQuote = (id, data) => api.put(`/quotes/${id}`, data)
export const deleteQuote = (id) => api.delete(`/quotes/${id}`)
export const convertQuoteToOrder = (id) => api.post(`/quotes/${id}/convert-to-order`)
export const convertQuoteToInvoice = (id) => api.post(`/quotes/${id}/convert-to-invoice`)
export const createTicketFromQuote = (id) => api.post(`/quotes/${id}/create-ticket`)
export const cloneQuote = (id) => api.post(`/quotes/${id}/clone`)
export const getQuoteInvoices = (id) => api.get(`/quotes/${id}/invoices`)
export const sendQuoteEmail = (id, data) => api.post(`/quotes/${id}/send-email`, data)
export const getQuoteItemSuggestions = () => api.get('/quotes/item-suggestions')

// Warranties
export const getMyWarranties = () => api.get('/warranties/my')
export const getWarranties = (params) => api.get('/warranties', { params })
export const getNextWarrantyNumber = () => api.get('/warranties/next-number')
export const getWarranty = (id) => api.get(`/warranties/${id}`)
export const createWarranty = (data) => api.post('/warranties', data)
export const updateWarranty = (id, data) => api.put(`/warranties/${id}`, data)
export const deleteWarranty = (id) => api.delete(`/warranties/${id}`)

// Expenses
export const getExpenses = (params) => api.get('/expenses', { params })
export const getExpense = (id) => api.get(`/expenses/${id}`)
export const createExpense = (data) => api.post('/expenses', data)
export const updateExpense = (id, data) => api.put(`/expenses/${id}`, data)
export const deleteExpense = (id) => api.delete(`/expenses/${id}`)
export const getExpenseSummary = (params) => api.get('/expenses/summary/totals', { params })
export const getExpenseDashboard  = (params) => api.get('/expenses/summary/dashboard', { params })
export const getOrdersDashboard   = (params) => api.get('/stats/orders',   { params })
export const getDespachoDashboard = (params) => api.get('/stats/despacho', { params })
export const getExpenseCategories = () => api.get('/expenses/categories')
export const getExpenseAttachments = (id) => api.get(`/expenses/${id}/attachments`)
export const uploadExpenseAttachment = (id, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/expenses/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
}
export const deleteExpenseAttachment = (id, attId) => api.delete(`/expenses/${id}/attachments/${attId}`)
export const expenseAttachmentDownloadUrl = (id, attId) => `/api/expenses/${id}/attachments/${attId}/download`

// Software Licenses
export const getLicenses = () => api.get('/licenses')
export const getLicense = (id) => api.get(`/licenses/${id}`)
export const createLicense = (data) => api.post('/licenses', data)
export const updateLicense = (id, data) => api.put(`/licenses/${id}`, data)
export const deleteLicense = (id) => api.delete(`/licenses/${id}`)
export const getNextLicenseNumber = () => api.get('/licenses/next-number')
export const sendLicenseEmail = (id, data) => api.post(`/licenses/${id}/send-email`, data)

// Opportunities
export const getOpportunities = (params) => api.get('/oportunidades', { params })
export const getOpportunity = (id) => api.get(`/oportunidades/${id}`)
export const createOpportunity = (data) => api.post('/oportunidades', data)
export const updateOpportunity = (id, data) => api.put(`/oportunidades/${id}`, data)
export const deleteOpportunity = (id) => api.delete(`/oportunidades/${id}`)
export const convertOpportunityToQuote = (id) => api.post(`/oportunidades/${id}/convert-to-quote`)
export const linkQuoteToOpp = (oppId, quoteId) => api.post(`/oportunidades/${oppId}/link-quote`, { quote_id: quoteId })
export const unlinkQuoteFromOpp = (oppId) => api.delete(`/oportunidades/${oppId}/link-quote`)
export const getOpportunityReports = () => api.get('/oportunidades/reports')
export const createOppVisit = (oppId, data) => api.post(`/oportunidades/${oppId}/visits`, data)
export const rescheduleOppVisit = (oppId, visitId, data) => api.put(`/oportunidades/${oppId}/visits/${visitId}`, data)
export const cancelOppVisit = (oppId, visitId) => api.post(`/oportunidades/${oppId}/visits/${visitId}/cancel`)
export const deleteOppVisit = (oppId, visitId) => api.delete(`/oportunidades/${oppId}/visits/${visitId}`)

// Letters
export const getLetters = () => api.get('/letters')
export const getLetter = (id) => api.get(`/letters/${id}`)
export const createLetter = (data) => api.post('/letters', data)
export const updateLetter = (id, data) => api.put(`/letters/${id}`, data)
export const deleteLetter = (id) => api.delete(`/letters/${id}`)
export const getNextLetterNumber = () => api.get('/letters/next-number')
export const sendLetterEmail = (id, data) => api.post(`/letters/${id}/send-email`, data)

// Contracts (MPS)
export const getContracts = (params) => api.get('/contracts', { params })
export const getContract = (id) => api.get(`/contracts/${id}`)
export const createContract = (data) => api.post('/contracts', data)
export const updateContract = (id, data) => api.put(`/contracts/${id}`, data)
export const deleteContract = (id) => api.delete(`/contracts/${id}`)
export const getNextContractNumber = () => api.get('/contracts/next-number')

// Printers (MPS)
export const getPrinters = (params) => api.get('/printers', { params })
export const getPrinter = (id) => api.get(`/printers/${id}`)
export const createPrinter = (data) => api.post('/printers', data)
export const updatePrinter = (id, data) => api.put(`/printers/${id}`, data)
export const decommissionPrinter = (id, data) => api.post(`/printers/${id}/decommission`, data)
export const deletePrinter = (id) => api.delete(`/printers/${id}`)
export const importPrinters = (file, dryRun = true) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/printers/import?dry_run=${dryRun}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const getMeterReadings = (printerId) => api.get(`/printers/${printerId}/meter-readings`)
export const createMeterReading = (printerId, data) => api.post(`/printers/${printerId}/meter-readings`, data)

// Supplies
export const getSupplyLots = (params) => api.get('/supplies/lots', { params })
export const getSupplyLot = (id) => api.get(`/supplies/lots/${id}`)
export const createSupplyLot = (data) => api.post('/supplies/lots', data)
export const updateSupplyLot = (id, data) => api.put(`/supplies/lots/${id}`, data)
export const deleteSupplyLot = (id) => api.delete(`/supplies/lots/${id}`)
export const getSupplyDeliveries = (params) => api.get('/supplies/deliveries', { params })
export const getSupplyDelivery = (id) => api.get(`/supplies/deliveries/${id}`)
export const createSupplyDelivery = (data) => api.post('/supplies/deliveries', data)
export const updateSupplyDelivery = (id, data) => api.put(`/supplies/deliveries/${id}`, data)
export const deleteSupplyDelivery = (id) => api.delete(`/supplies/deliveries/${id}`)
export const getSupplyItems = () => api.get('/supplies/items')
export const getSupplyStats = (params) => api.get('/supplies/stats', { params })

// Inventory
export const getInventory = (params) => api.get('/inventory', { params })
export const searchInventory = (q) => api.get('/inventory/search', { params: { q } })
export const getInventoryItem = (id) => api.get(`/inventory/${id}`)
export const createInventoryItem = (data) => api.post('/inventory', data)
export const updateInventoryItem = (id, data) => api.put(`/inventory/${id}`, data)
export const deleteInventoryItem = (id, justification) => api.delete(`/inventory/${id}`, { data: { justification } })
export const getInventoryTransactions = (id, limit = 50) => api.get(`/inventory/${id}/transactions`, { params: { limit } })
export const withdrawInventoryItem = (id, data) => api.post(`/inventory/${id}/withdraw`, data)
export const receiveInventoryItem = (id, data) => api.post(`/inventory/${id}/receive`, data)
export const adjustInventoryItem = (id, data) => api.post(`/inventory/${id}/adjust`, data)
export const updateInventoryPending = (id, data) => api.patch(`/inventory/${id}/pending`, data)
export const getAllInventoryTransactions = (params) => api.get('/inventory/transactions/all', { params })
export const getInventoryReportPdf = (params) => api.get('/inventory/reports/movements/pdf', { params, responseType: 'blob' })
export const importInventoryCSV = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/inventory/import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
}

// Solicitudes de partes (desde tickets) + aprobación
export const getPartRequests = (params) => api.get('/part-requests', { params })
export const createPartRequest = (data) => api.post('/part-requests', data)
export const approvePartRequest = (id, data = {}) => api.post(`/part-requests/${id}/approve`, data)
export const rejectPartRequest = (id, data = {}) => api.post(`/part-requests/${id}/reject`, data)
export const cancelPartRequest = (id) => api.post(`/part-requests/${id}/cancel`)
export const returnPartRequest = (id, data = {}) => api.post(`/part-requests/${id}/return`, data)
export const getPartRequestsPending = () => api.get('/part-requests/pending-count')

// Notificaciones (para todos los usuarios)
export const getNotifications = () => api.get('/notifications')
export const getNotificationsUnread = () => api.get('/notifications/unread-count')
export const markNotificationRead = (id) => api.post(`/notifications/${id}/read`)
export const markAllNotificationsRead = () => api.post('/notifications/read-all')

// Time Tracking
export const getTimeLogs = (ticketId) => api.get(`/tickets/${ticketId}/time-logs`)
export const addTimeLog = (ticketId, data) => api.post(`/tickets/${ticketId}/time-logs`, data)
export const deleteTimeLog = (ticketId, logId) => api.delete(`/tickets/${ticketId}/time-logs/${logId}`)
export const submitCsat = (ticketId, data) => api.post(`/tickets/${ticketId}/csat`, data)

// Canned Responses
export const getCannedResponses = (params) => api.get('/canned-responses', { params })
export const createCannedResponse = (data) => api.post('/canned-responses', data)
export const updateCannedResponse = (id, data) => api.put(`/canned-responses/${id}`, data)
export const deleteCannedResponse = (id) => api.delete(`/canned-responses/${id}`)

// Settings
export const getCompanySettings = () => api.get('/settings/company')
export const saveCompanySettings = (data) => api.put('/settings/company', data)
export const getPublicCompanyInfo = () => api.get('/settings/public-info')
export const uploadCompanyLogo = (blob) => api.post('/settings/logo', blob, { headers: { 'Content-Type': blob.type || 'image/png' } })
export const deleteCompanyLogo = () => api.delete('/settings/logo')
export const companyLogoUrl = () => '/api/settings/logo'
export const uploadFavicon  = (blob) => api.post('/settings/favicon',  blob, { headers: { 'Content-Type': blob.type || 'image/png' } })
export const deleteFavicon  = () => api.delete('/settings/favicon')
export const faviconUrl     = () => '/api/settings/favicon'
export const uploadPwaIcon  = (blob) => api.post('/settings/pwa-icon', blob, { headers: { 'Content-Type': blob.type || 'image/png' } })
export const deletePwaIcon  = () => api.delete('/settings/pwa-icon')
export const pwaIconUrl     = () => '/api/settings/pwa-icon'
export const getSlaSettings = () => api.get('/settings/sla')
export const saveSlaSettings = (data) => api.put('/settings/sla', data)
export const getFormatSettings = () => api.get('/settings/format')
export const saveFormatSettings = (data) => api.put('/settings/format', data)
export const getSmtpSettings = () => api.get('/settings/smtp')
export const saveSmtpSettings = (data) => api.put('/settings/smtp', data)
export const testSmtpSettings = (data) => api.post('/settings/smtp/test', data)
export const getImapSettings = () => api.get('/settings/imap')
export const saveImapSettings = (data) => api.put('/settings/imap', data)
export const pollImap = () => api.post('/settings/imap/poll')
export const getRoleFeatures = () => api.get('/settings/role-features')
export const saveRoleFeatures = (data) => api.put('/settings/role-features', data)

// Dashboard
export const getDashboard = () => api.get('/dashboard')

// Ventas Dashboard
export const getVentasDashboard = () => api.get('/ventas/dashboard')

// Reports
export const getReportTickets = (params) => api.get('/reports/tickets', { params })
export const getReportSummary = (params) => api.get('/reports/summary', { params })
export const getReportAgents  = (params) => api.get('/reports/agents',  { params })
const _apiBase = () => (import.meta.env.BASE_URL || '/') + 'api'

export const downloadReportCSV = (params) => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token')
  const query = new URLSearchParams({ ...params, format: 'csv' }).toString()
  return fetch(`${_apiBase()}/reports/tickets?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}
export const downloadReportExcel = (params) => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token')
  const query = new URLSearchParams({ ...params, format: 'excel' }).toString()
  return fetch(`${_apiBase()}/reports/tickets?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Papelera (Recycle Bin)
export const getPapelera = () => api.get('/papelera')
export const restoreItem = (entityType, id) => api.post(`/papelera/${entityType}/${id}/restore`)
export const permanentDelete = (entityType, id) => api.delete(`/papelera/${entityType}/${id}`)

// Audit Log
export const getAuditLog = (params) => api.get('/audit', { params })

// Límite de usuarios (staff)
export const getMaxUsers = () => api.get('/system/max-users')
export const setMaxUsers = (max_users) => api.put('/system/max-users', { max_users })

// Authenticated file download (avoids 401 on direct <a href> links)
export async function downloadWithAuth(relUrl, filename) {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token')
  const base  = import.meta.env.BASE_URL || '/'
  const url   = relUrl.startsWith('http') ? relUrl : base.replace(/\/$/, '') + relUrl
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('Error al descargar archivo')
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename || 'archivo'
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── System (superadmin) ───────────────────────────────────────────────────
export const getSystemModules    = ()     => api.get('/system/modules')
export const updateSystemModules = (data) => api.put('/system/modules', data)
export const getTrialStatus      = ()     => api.get('/system/trial/status')
export const getTrialConfig      = ()     => api.get('/system/trial')
export const updateTrial         = (data) => api.put('/system/trial', data)

export default api
