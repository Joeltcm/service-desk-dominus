# Registro de cambios para portar a service-desk original

Este archivo documenta cada cambio hecho en **service-desk-empresas** que
probablemente haya que replicar en el proyecto **service-desk** original.

Los dos repos ya divergieron, así que un `git cherry-pick` no aplica limpio.
Por eso cada entrada describe **qué**, **qué archivos** y la **lógica**, suficiente
para replicar el cambio a mano en service-desk.

Formato de cada entrada:
- **Fecha · Título**
- **Tipo:** feat / fix / ui / chore
- **Archivos:** rutas tocadas
- **Qué hace / lógica:** resumen para replicar
- **Portado a service-desk:** ⬜ pendiente / ✅ hecho (fecha)

---

### 2026-08-20 17:22 UTC-5 · Papelera unificada: ahora incluye Pedidos (Despacho)
- **Tipo:** feat
- **Archivos:** `backend/routers/papelera.py` (nueva entidad `despacho` → `models.Dispatch`; restore re-sincroniza inventario y limpia `deleted_by`; `_purge_despacho_dependents` borra timeline/tasks/parts/attachments + movimientos), `frontend/src/pages/Papelera.jsx` (labels/colores para `despacho` y `contrato`)
- **Qué hace / lógica:** La Papelera unificada ya existía (ticket, factura, cotización, gasto, contacto, empresa, contrato, y "pedido"=`Order`), pero **NO incluía `Dispatch`** — que es lo que en este proyecto son los "Pedidos" (`/pedidos`, Despacho.jsx). Por eso los pedidos eliminados no aparecían en ninguna papelera. Se agregó `despacho`: aparece en la lista (con Nº PED-xxxx), **Restaurar** re-descuenta el stock si el estado lo aplica (`_sync_dispatch_inventory`) y limpia `deleted_by`, **Eliminar permanente** purga dependientes (timeline/tareas/partes/adjuntos + movimientos de inventario). Verificado con test (emitir→descuenta, eliminar→repone+papelera, restaurar→re-descuenta, purgar→limpia) y en prod (6 pedidos viejos listados en la papelera).
- **Nota:** hay una coincidencia de etiqueta: `pedido`(Order) y `despacho`(Dispatch) ambos se muestran "Pedido"; en Dominus el Order no se usa, así que solo aparece el grupo de Despacho.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-20 16:57 UTC-5 · Trazabilidad de borrado de pedidos y órdenes de recibo
- **Tipo:** feat (auditoría)
- **Archivos:** `backend/models.py` (`Dispatch.deleted_by_id/deleted_by_name`, `InventoryReceipt.deleted_by_id/deleted_by_name`), `backend/main.py` (`_migrate_pg`: ALTER add columns en dispatches e inventory_receipts), `backend/routers/despacho.py` (`delete_dispatch` y `cancel_dispatch` capturan `current_user`, setean `deleted_by` y llaman `log_action`), `backend/routers/inventory.py` (`delete_receipt` idem)
- **Qué hace / lógica:** Antes, eliminar un pedido NO dejaba rastro: `delete_dispatch` descartaba el usuario (`_=Depends`) y no llamaba `log_action`, y no había `deleted_by`. Por eso un borrado no aparecía en Auditoría ni se sabía quién. Ahora: al eliminar un **pedido** se guarda `deleted_by_id/name` y se registra `log_action(delete, 'pedido', ...)`; cancelar registra `log_action(update, 'pedido', 'Cancelado · ...')`; eliminar una **orden de recibo** guarda `deleted_by` y registra `log_action(delete, 'orden_recibo', ...)`. Verificado con test (SQLite).
- **Nota de datos (solo Dominus):** se limpió el pedido de prueba id=7 (PED-0001 "Pedido de prueba", DG Solutions) y TODO lo que generó: su timeline, el movimiento de inventario (HP-PRO-G4 −1), el artículo phantom HP-PRO-G4 auto-creado por venta sin stock, y 3 notificaciones. El pedido "Andres" (id=6) se dejó eliminado (no restaurado, por indicación del usuario).
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-20 15:14 UTC-5 · UI: botón Ayuda ya no se solapa con botones de encabezado
- **Tipo:** ui (fix layout, desktop + móvil/PWA)
- **Archivos:** `frontend/src/components/Layout.jsx` (pastilla Ayuda `hidden md:flex` — se oculta en móvil; nuevo botón Ayuda en el top bar móvil junto a la campana), + padding derecho `md:pr-14 lg:pr-28` en encabezados/paneles que quedaban bajo la pastilla: `Despacho, Tickets, Projects, Agenda, Suppliers, Licencias, Contratos, Impresoras, SystemConfig, MisPedidos, Suministros, Pagos, CuentasPorCobrar, CuentasPorPagar, Reports, Dashboard, VentasDashboard, PedidosDashboard, GastosDashboard` (headers full-width) y en el **panel de detalle** de las páginas maestro-detalle `Quotes, Facturas, Contacts, Orders, Gastos, Oportunidades`.
- **Qué hace / lógica:** La Ayuda es `fixed top-3 right-3` y tapaba el botón derecho del encabezado (p.ej. "Nuevo" de Pedidos) y, en móvil, el avatar del top bar.
  - **Móvil (<md):** se oculta la pastilla flotante y se agrega un ícono de Ayuda dentro del top bar (no se solapa con nada).
  - **Escritorio (md+):** se reserva el ancho de la pastilla con `md:pr-14 lg:pr-28` solo en el encabezado (full-width) o en el panel de detalle (maestro-detalle, donde la pastilla cae sobre el panel derecho, no sobre la columna de lista). En páginas maestro-detalle NO se toca el header de la columna izquierda (no choca).
  - Warranties usa contenido centrado (`max-w-4xl mx-auto`) → no colisiona en lg; se dejó igual.
  - **Corrección 2026-08-20 17:40:** en Tickets el padding se había puesto en el header de la vista **cliente** (hero "Hola 👋", L244); el header **staff** real es otro (`p-4 sm:p-6` → `flex justify-between mb-4 sm:mb-6`, L377) donde están *Escanear/Nuevo Ticket*. Se le agregó `md:pr-14 lg:pr-28` ahí (ambos headers quedan correctos según rol).
  - **Corrección 2026-08-20 17:52:** faltaba `KnowledgeBase.jsx` (header "Base de Conocimientos" + *Nuevo Artículo*, L349) → agregado.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-20 14:38 UTC-5 · Pedidos: venta sin stock (stock negativo, auto-crear, alerta y trazabilidad)
- **Tipo:** feat (backend + ui)
- **Archivos:** `backend/routers/despacho.py` (`_apply_inventory_from_dispatch` reescrito: permite negativo + auto-crea artículo no catalogado con `_next_backorder_code` SP-000x + cliente en la nota; endpoint `POST /stock-check`), `backend/routers/inventory.py` (endpoint `GET /oversold`), `frontend/src/services/api.js` (`dispatchStockCheck`, `getOversoldReport`), `frontend/src/pages/Despacho.jsx` (guardia `runWithStockGuard` + diálogo de confirmación en `handleStatusChange` y `handleSave`), `frontend/src/pages/Inventario.jsx` (resalta negativos en rojo, banner "N con existencia negativa", modal reporte "Vendidos sin stock")
- **Qué hace / lógica:**
  1. **Vender sin stock → negativo:** al procesar un pedido (estado ≠ Borrador/Cancelado) el descuento YA NO topa en 0; el inventario queda negativo (backorder visible, resaltado en rojo).
  2. **No catalogado:** si el artículo no está en inventario, se **crea** (con su código, o `SP-000x` temporal + `needs_code=True` si no trae código) en existencia negativa. Las líneas de servicio sin código ni descripción se ignoran.
  3. **Alerta al procesar:** `POST /despachos/stock-check` devuelve los faltantes; el front muestra diálogo "Procesando venta sin stock" con el detalle y pide **confirmar** (permite continuar como backorder). Solo se dispara en la primera transición a un estado que descuenta.
  4. **Trazabilidad:** cada movimiento `dispatch` guarda "Pedido X · Cliente" en la nota; `GET /inventory/oversold` lista los artículos negativos con sus ventas (pedido, cliente, cantidad, fecha), mostrado en el modal y en los movimientos del artículo.
  - Verificado con test (SQLite): A(2)→vende 5 = −3; código nuevo → creado −2; sin código → SP-0001 −2, needs_code. Endpoints live en prod, sin colisión con /{id}.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-19 12:40 UTC-5 · PWA: asignación inline también en la tarjeta móvil de Tickets
- **Tipo:** ui (móvil/PWA)
- **Archivos:** `frontend/src/pages/Tickets.jsx` (tarjeta móvil `md:hidden`)
- **Qué hace / lógica:** La asignación inline se había agregado solo a la vista de tabla (desktop). En Tickets, la vista móvil usa tarjetas (`md:hidden`), que no tenían el control. Se agregó el mismo `<select>` de agente en la tarjeta (con `UserCheck`, `fontSize:16` anti-zoom iOS, `stopPropagation` para no abrir el detalle). Pedidos (Despacho) ya mostraba la columna de técnico en su tabla también en móvil (no oculta en <sm), así que su desplegable ya operaba en el PWA. Los chips "Mis asignados" y los badges del menú ya eran visibles en móvil (mismo sidebar/flex-wrap).
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-19 12:16 UTC-5 · Asignación inline en tabla (tickets/pedidos) + badges de carga por técnico
- **Tipo:** feat (backend + ui)
- **Archivos:** `backend/routers/tickets.py` (endpoint `GET /assigned-counts` {mine,all} de tickets abiertos; **desasignar** con assigned_to_id=null vía `model_fields_set` pese a exclude_none), `backend/routers/despacho.py` (endpoint `GET /assigned-counts` {mine,all} de pedidos activos = no Entregado/Cancelado), `frontend/src/services/api.js` (`getTicketAssignedCounts`, `getDispatchAssignedCounts`), `frontend/src/pages/Tickets.jsx` (select inline en columna AGENTE + filtro chip "Mis asignados"), `frontend/src/pages/Despacho.jsx` (select inline en columna técnico con `handleAssignInline` + filtro "Mis asignados"), `frontend/src/components/Layout.jsx` (badges de menú Tickets y Pedidos)
- **Qué hace / lógica:**
  - **Asignar desde la tabla:** en la vista de tabla de Tickets y Pedidos, la celda de agente/técnico es un `<select>` que asigna/reasigna sin abrir el detalle (optimista en la fila). Gate: `canWrite('tickets')` / `canWrite('pedidos')` (admin/supervisor/agente). Los endpoints `/assigned-counts` van declarados ANTES de `/{id}` para no chocar (422).
  - **Cuántos tengo asignados:** badge en el menú lateral junto a "Tickets" y "Pedidos". **Agente** ve los suyos asignados y activos; **admin/supervisor** ven el total global (abiertos/activos). Refresco cada 5 min. Además, filtro rápido "Mis asignados" en ambas tablas.
  - **Nota:** el badge de Tickets antes usaba getDashboard (total-resueltos); ahora usa `assigned-counts` (all=abiertos). Verificado con test (SQLite) y en prod (tickets {mine,all}, despachos {mine,all}, sin colisión con /{id}).
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-19 11:32 UTC-5 · Tickets: auto-asignación al responder/resolver + "Levantado por" (creador)
- **Tipo:** feat (backend + ui)
- **Archivos:** `backend/routers/tickets.py` (helpers `_is_resolved_status`, `_maybe_autoassign`; wiring en `add_timeline_entry` y `update_ticket`; `create_ticket` setea `created_by_id`), `backend/models.py` (`Ticket.created_by_id` + relación `created_by`), `backend/main.py` (`_migrate_pg`: ALTER tickets add created_by_id + **backfill** desde la entrada 'Ticket creado' de la línea de tiempo), `backend/schemas.py` (`TicketOut.created_by`), `frontend/src/pages/TicketDetail.jsx` ("Levantado por")
- **Qué hace / lógica:**
  - **Auto-asignación:** cuando un usuario **staff** (rol ≠ client) publica una **respuesta pública** o **resuelve** (estado → Resuelto/Cerrado), si el ticket está **sin asignar** se le asigna automáticamente, dejando traza `entry_type='assignment'` ("Ticket autoasignado a X al responder/resolver"). **No reasigna** si ya tiene agente (no roba). Ignora notas internas y comentarios de clientes. Cubre las 2 rutas: `add_timeline_entry` (comentario y/o cambio de estado) y `update_ticket` (cambio de estado a resuelto).
  - **Creador (Levantado por):** nueva columna `created_by_id` (nullable). En `create_ticket` = usuario actual. `TicketOut.created_by` (UserOut). En el detalle se muestra **"Levantado por: nombre"** solo para staff viendo, y solo si el creador es staff (si lo creó el cliente = solicitante, se omite por redundante). Backfill idempotente de tickets existentes desde la línea de tiempo (los 20 del listado quedaron poblados).
  - Verificado con test funcional (SQLite): 7/7 casos (responder auto-asigna, no roba, ignora nota interna/cliente, resolver por ambas rutas, created_by en create).
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-19 00:45 UTC-5 · Ayuda (KB) de las nuevas funciones de inventario
- **Tipo:** contenido (Base de Conocimientos, NO código)
- **Dónde:** creados en la BD de producción de Dominus vía `POST /api/kb/articles` (JWT admin firmado); la KB es contenido de BD, no requiere deploy. Audiencia `agents` (staff, no clientes), `category_id=null`, publicados.
- **Artículos:** id=23 "📦 Órdenes de recibo: ingresar mercancía al inventario" (crear/borrador, artículo sin código S/C, recibir con firma, estado de revisión, editar orden Recibida con re-firma + ajuste de stock, PDF/correo multi-destinatario); id=24 "↩️ Devoluciones a proveedor" (crear con motivo + técnico revisor, nota PDF al proveedor, registro DEV-000x, editar con ajuste por delta, PDF/correo).
- **Para replicar en service-desk:** recrear los mismos 2 artículos (mismo texto) en su KB cuando esas funciones existan allí. El markdown de la KB soporta `##`, listas, negritas, `código`, citas y enlaces (no tablas).
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-19 00:32 UTC-5 · UI/PWA: barra de pestañas de Inventario desplazable
- **Tipo:** ui (fix móvil)
- **Archivos:** `frontend/src/pages/Inventario.jsx` (contenedor de tabs)
- **Qué hace / lógica:** Con 5 pestañas (Artículos/Movimientos/Reportes/Órdenes de recibo/Devoluciones) la barra excedía el ancho del viewport y **empujaba toda la página** a scroll horizontal en el PWA (todo se veía corrido). Se agregó `overflow-x-auto` + scrollbar oculto (`[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`), cada tab `shrink-0 whitespace-nowrap`, padding responsivo `px-3 sm:px-4`, y "Órdenes de recibo" se muestra como "Órdenes" en móvil. Ahora la barra hace scroll interno y la página ya no se desplaza horizontalmente.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-19 00:20 UTC-5 · UI: botón Editar en órdenes Recibidas + botón "Órdenes de recibo" en PWA
- **Tipo:** ui (seguimiento del feature de edición)
- **Archivos:** `frontend/src/components/ReceiptOrdersPanel.jsx` (botón **Editar** en el detalle de órdenes Recibida, junto a Devolver/PDF/correo), `frontend/src/components/ReceiptOrders.jsx` (`openExisting(id, openInEdit)` entra directo en `fullEdit` si la orden es Recibida), `frontend/src/pages/Inventario.jsx` (`openReceiptEditor(id, edit)` propaga `edit`; el botón de toolbar "Órdenes de recibo" ahora muestra **etiqueta siempre** —antes solo-icono en móvil— con badge de pendientes)
- **Qué hace / lógica:** Faltaba el acceso a editar una orden ya Recibida desde el panel (solo estaba dentro del modal en modo revisión). Ahora el detalle de una Recibida tiene botón **Editar** (azul) que abre el editor directamente en modo edición con re-firma. Además, el botón "Órdenes de recibo" del encabezado de Inventario colapsaba a un ícono verde ambiguo en el PWA; ahora muestra su texto y el contador de pendientes.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-19 00:03 UTC-5 · Edición de órdenes de recibo (re-firma) y devoluciones (ajuste por delta)
- **Tipo:** feat (backend + ui)
- **Archivos:** `backend/models.py` (`InventoryReceipt.last_edited_by_name` + `last_edited_at`), `backend/main.py` (`_migrate_pg`: ALTER inventory_receipts last_edited_by_name/last_edited_at), `backend/schemas.py` (`ReceiptUpdate.delivery_signature`; `ReceiptOut.last_edited_by_name/at`; nuevo `ReturnUpdate`; `ReturnOut.reviewed_by_id`), `backend/routers/inventory.py` (`update_receipt` reescrito; helpers `_to_f`, `_create_sin_codigo_item`, `_receipt_edit_apply_delta`, `_return_edit_apply_delta`; nuevo endpoint `PUT /returns/{id}` `update_return`; PDF recibo muestra "Editada por…"), `frontend/src/components/ReceiptOrders.jsx` (modo `fullEdit` con re-firma), `frontend/src/components/SupplierReturnForm.jsx` (modo edición vía `returnDoc`), `frontend/src/components/SupplierReturnsPanel.jsx` (botón Editar), `frontend/src/services/api.js` (`updateReturn`)
- **Qué hace / lógica:**
  - **Órdenes de recibo:** ahora se pueden editar aunque estén **Recibida** (antes solo Borrador). En el editor, una orden recibida muestra botón **Editar orden** → desbloquea cantidades/artículos/proveedor y **exige volver a firmar** (`delivery_signature` obligatorio en `update_receipt` cuando `status=='Recibida'`). El stock se ajusta por la **diferencia** por artículo (`_receipt_edit_apply_delta`), con movimiento trazado `source_type='ajuste_recepcion'`; en aumentos re-promedia el costo. Se registra `last_edited_by_name`/`last_edited_at` (visible en el PDF). Borradores: sin cambios (firman al finalizar).
  - **Devoluciones:** nuevo `PUT /returns/{id}`. `SupplierReturnForm` en modo edición (precarga equipos/motivos/técnico/notas). Ajusta stock por **delta** (`_return_edit_apply_delta`, `source_type='ajuste_devolucion'`): si sube la cantidad devuelta descuenta más, si baja reingresa. Sin firma (solo recibos). Re-marca 'revisado' en la orden origen.
  - Verificado con test funcional (SQLite): recibo +3→13, −6→7, firma obligatoria; devolución −3→4, edición 3→1 reingresa→6.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-18 23:58 UTC-5 · Correo editable + multi-destinatario (recibos y devoluciones)
- **Tipo:** feat (ui + backend)
- **Archivos:** `frontend/src/components/EmailSendDialog.jsx` (nuevo, modal reutilizable), `frontend/src/components/ReceiptOrders.jsx` (modal), `frontend/src/components/ReceiptOrdersPanel.jsx` (panel recibo+devolución), `frontend/src/components/SupplierReturnsPanel.jsx` (tab devoluciones), `backend/routers/inventory.py` (`_split_recipients` + ambos `send-email` usan `cc`; `import re`)
- **Qué hace / lógica:** Al enviar por correo una **orden de recibo** o una **devolución**, se abre un modal (`EmailSendDialog`) prellenado con el correo del proveedor (registrado en el portal) en un campo editable; se pueden **agregar varios correos separados por comas**. Reemplaza los `window.prompt` anteriores en las 3 superficies. Backend: `_split_recipients(raw)` divide por `,`/`;` → el primero va como `to` y el resto como `cc` (soportado tanto por Brevo API como por SMTP vía `_send_with_logo(..., cc=...)`). Validación de formato de correo en el frontend. Sin cambios de modelo/migración.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-18 23:40 UTC-5 · Nota de devolución: técnico revisor + texto de pie
- **Tipo:** feat + copy
- **Archivos:** `backend/models.py` (`SupplierReturn.reviewed_by_id` FK users + `reviewed_by_name`), `backend/main.py` (`_migrate_pg`: `ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS reviewed_by_id INTEGER REFERENCES users(id)` + `reviewed_by_name VARCHAR(200)`), `backend/schemas.py` (`ReturnCreate.reviewed_by_id/reviewed_by_name`, `ReturnOut.reviewed_by_name`), `backend/routers/inventory.py` (`create_return` valida `reviewed_by_id` obligatorio + resuelve usuario y guarda nombre; `_build_return_html` muestra "Revisado por: <b>…</b>" y **nuevo texto de pie**), `frontend/src/components/SupplierReturnForm.jsx` (selector obligatorio "Técnico que revisó los equipos" poblado con `getAgents()`), `frontend/src/components/SupplierReturnsPanel.jsx` (muestra "Revisado por" en vista previa)
- **Qué hace / lógica:** La nota de devolución (dirigida al proveedor) ahora exige elegir al **técnico que revisó** los equipos (lista de agentes/supervisores/admins activos, `/users/agents`). Backend rechaza (400) si falta `reviewed_by_id` o el usuario no existe; guarda `reviewed_by_name` snapshot. El PDF muestra "Revisado por: Nombre" junto a la fecha. Texto de pie reemplazado por: *"La presente nota formaliza la devolución al proveedor de los equipos detallados, por las causales indicadas tras su revisión técnica. Se solicita su reposición o la emisión de la nota de crédito correspondiente. Agradecemos gestionar el retiro de la mercancía y confirmar su recepción."* (antes: "Documento de devolución de mercancía al proveedor. Los equipos listados fueron retirados del inventario…").
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-18 23:17 UTC-5 · Registro de Devoluciones (tab maestro-detalle)
- **Tipo:** feat (ui)
- **Archivos:** `frontend/src/components/SupplierReturnsPanel.jsx` (nuevo), `frontend/src/pages/Inventario.jsx` (import, estado `returnsTick`, tab "Devoluciones" en la barra de tabs junto a "Órdenes de recibo", render `{tab==='devoluciones' && <SupplierReturnsPanel refreshTick={returnsTick}/>}`, `onChanged` de ReceiptOrdersPanel ahora también hace `setReturnsTick(t=>t+1)`, import `Undo2`), `backend/schemas.py` (`ReturnListItem` con `receipt_id`, `receipt_number`, `supplier_name`, `created_by_name`), `backend/routers/inventory.py` (`list_returns` popula `receipt_number`/`supplier_name`)
- **Qué hace / lógica:** Nuevo tab "Devoluciones" al lado de "Órdenes de recibo". Maestro-detalle: lista izquierda con todas las devoluciones (secuencial DEV-000x, badge de la orden de recibo vinculada REC-xxxx, proveedor, nº equipos, fecha) vía `GET /api/inventory/returns` (ReturnListItem); panel derecho con vista previa del detalle vía `getReturn(id)` (ReturnOut: proveedor+email, fecha/registró, notas, tabla equipo/motivo/cant/costo/subtotal + total). Botones **imprimir PDF** (`getReturnPdf`) y **enviar por correo** (`sendReturnEmail`, prompt autocompletado con email del proveedor). Auto-selecciona la primera. Se refresca cuando se crea una devolución desde el tab de órdenes (returnsTick). Sin cambios de modelo/migración (endpoints y tablas ya existían de la feature de devoluciones).
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-17 · Freshdesk #1 — Vista de tarjetas en lista de tickets (toggle)
- **Tipo:** ui (feature de familiaridad Freshdesk)
- **Archivos:** `frontend/src/pages/Tickets.jsx`
- **Qué hace / lógica:** Toggle "Tarjeta / Tabla" en el header de Tickets (solo desktop; móvil siempre fue tarjeta). Estado `viewMode` ('card' por defecto) persistido en `localStorage['ticketsViewMode']`. En desktop, `viewMode==='card'` renderiza una lista de tarjetas full-width estilo Freshdesk (izquierda: StatusBadge + categoría + asunto + `#id` + solicitante·empresa·"Creado hace X" [relTime con `formatDistanceToNow`+`toUTC`+locale es] + cita + tags; derecha: PriorityBadge + agente + SlaBadge). `viewMode==='table'` mantiene la tabla existente sin cambios. Imports agregados: `formatDistanceToNow` (date-fns), `toUTC` (utils/fmt), `LayoutGrid`/`Table` (lucide). Sin cambios de backend.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-17 · Consentimiento de Términos/Datos al crear cuenta
- **Tipo:** feat
- **Archivos:** `backend/models.py` (User: `terms_accepted_at`, `terms_version`), `backend/main.py` (columnas en **`_migrate_pg()`** para Postgres con `ADD COLUMN IF NOT EXISTS`; y en `_migrate()` para SQLite dev), `backend/routers/auth.py` (`RegisterRequest.accept_terms`, `TERMS_VERSION`, validación + guardado), `frontend/src/pages/Login.jsx`
- **Qué hace / lógica:** En el registro público (rol client) se agrega checkbox obligatorio "Acepto Términos de Uso y Tratamiento de Datos" + modal con el texto (Ley 81 de 2019, texto usa `brandName`). Backend rechaza si `accept_terms` es false y guarda `terms_accepted_at=now()` + `terms_version` (constante server `TERMS_VERSION`). Columna vía auto-migración idempotente.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-17 · Bloqueo de edición de tickets para clientes
- **Tipo:** fix (seguridad)
- **Archivos:** `backend/routers/tickets.py` (`update_ticket`)
- **Qué hace / lógica:** Un usuario `client` ya no puede editar ningún campo del ticket vía API (antes solo se le quitaba `client_id`; podía setear estado/técnico/notas). Ahora `update_ticket` lanza 403 para rol client. Los clientes solo aportan info por comentarios (endpoint timeline, sin cambios).
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-17 · Panel de Roles no muestra usuarios inactivos
- **Tipo:** fix
- **Archivos:** `frontend/src/pages/Settings.jsx` (`RoleAssignPanel.fetchUsers`)
- **Qué hace / lógica:** El filtro del panel de roles excluía solo `client`/`superadmin`; ahora también `!u.is_active`, para que usuarios dados de baja (soft-delete) desaparezcan del listado y del contador. `list_users` (backend) NO se tocó (la página de Usuarios sí necesita ver inactivos).
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-17 · Fechas por defecto en zona local (no UTC)
- **Tipo:** fix
- **Archivos:** `frontend/src/utils/fmt.js` (`todayLocal()`, `monthsAgoLocal()`), `pages/Despacho.jsx`, `pages/Warranties.jsx`, `pages/Licencias.jsx`, `pages/Contratos.jsx`, `pages/Reports.jsx`
- **Qué hace / lógica:** `new Date().toISOString().slice(0,10)` devolvía "mañana" tras las 19:00 en Panamá (UTC-5). Se reemplazó por `todayLocal()` = `formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')` en los defaults de fecha (pedidos, garantías, licencias, contratos y rango de reportes). Los usos con `fromZonedTime(...)` ya eran correctos.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-17 · Inventario de Pedidos: revert por libro de transacciones
- **Tipo:** fix (correctitud de inventario)
- **Archivos:** `backend/routers/despacho.py` (`_revert_inventory_from_dispatch`, nuevo `_dispatch_applied_net`)
- **Qué hace / lógica:** El revert reponía las cantidades de los items ACTUALES (descuadre al editar un pedido ya emitido) y devolvía la cantidad completa aunque el descuento se hubiera recortado a 0 (stock fantasma). Ahora `_dispatch_applied_net` suma las transacciones `dispatch`/`dispatch_revert` de ese pedido y repone EXACTO lo descontado. Retrocompatible con pedidos ya aplicados.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-17 · Orden de Recibo de Inventario (multi-artículo, firma, PDF, correo)
- **Tipo:** feat
- **Archivos:** `backend/models.py` (InventoryReceipt + InventoryReceiptItem), `backend/schemas.py` (ReceiptCreate/Update/Finalize/Out/ListItem/Email + ReceiptItemIn/Out), `backend/routers/inventory.py` (helpers + endpoints + PDF/correo), `frontend/src/components/SignaturePad.jsx` (nuevo), `frontend/src/components/ReceiptOrders.jsx` (nuevo), `frontend/src/pages/Inventario.jsx` (botón "Órdenes de recibo" + modal), `frontend/src/services/api.js`
- **Qué hace / lógica:** Nuevo flujo de recepción multi-artículo con ciclo **Borrador → Recibida**. Admin crea la orden (número secuencial `REC-0001`, proveedor, items) sin tocar stock; al **finalizar** el mensajero valida/edita cantidades, ingresa nombre de quien entrega + **firma** (canvas → data URI), la recepción se toma del usuario logueado, y solo entonces se **aplica el stock** (promedio ponderado, `_apply_receipt_stock`, txn `source_type='recepcion' source_id=receipt.id`). Endpoints bajo `/api/inventory/receipts` (next-number, CRUD, finalize, `/{id}/pdf`, `/{id}/send-email`). PDF con branding (`_brand_logo_tag` + `_build_receipt_html` con TABLAS, no flex) vía `_html_to_pdf` (Playwright→WeasyPrint). Correo al proveedor con PDF adjunto usando `_send_with_logo(api_key=..., file_attachments=[...])` (Brevo). Tablas nuevas las crea `create_all` (sin ALTER). **Coexiste** con el "Recibir" por fila existente (no lo reemplaza). **Gotcha de rutas:** las órdenes van en un `receipts_router` propio (prefix `/api/inventory/receipts`) incluido en main.py **antes** que `inventory.router`; si no, `GET /api/inventory/receipts` cae en `GET /api/inventory/{item_id}` → `int("receipts")` → 422.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-17 · Dockerfile: Chromium opcional (no tumba el build)
- **Tipo:** chore (infra/build) — **afecta a las 3 instancias** (comparten Dockerfile)
- **Archivos:** `Dockerfile`
- **Qué hace / lógica:** `RUN python -m playwright install chromium` → `... || true`. La descarga de Chromium es grande y flakea; si falla tumbaba TODO el build (deploys fallando, contenedor sin arrancar). Ahora el paso no es fatal: si Chromium no queda, `_html_to_pdf` (settings.py) cae a **WeasyPrint** (ya instalado con libpango/cairo/fuentes) sin pérdida de función para los PDFs. Descubierto al fallar 3 deploys seguidos de un cambio solo-Python (el build no corre Python, así que el fallo era del paso Chromium).
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-18 · Fix deploys: `.railwayignore` (snapshot timeout)
- **Tipo:** chore (infra/deploy) — **crítico para deploys por `railway up`**
- **Archivos:** `.railwayignore` (nuevo)
- **Qué hace / lógica:** `railway up` **NO** respeta `.dockerignore` ni `.gitignore`; sin `.railwayignore` subía TODO el directorio (~291 MB, 268 de `frontend/node_modules`) y el paso "Initialization › Snapshot code" **agotaba el tiempo** → todos los deploys fallaban ("Repository snapshot operation timed out"). El `.railwayignore` excluye `node_modules`, `dist`, `.git`, `graphify-out`, `__pycache__`, etc. (el Dockerfile ya regenera node_modules con `npm ci`), dejando la subida en ~15 MB. **Este era el motivo de la racha de deploys fallidos**, no el código. También: linkear el CLI al proyecto correcto con `railway link -p <proj> -s <svc> -e <env>` (estaba linkeado a empresas 82223aa0).
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-18 · Orden de Recibo: estado de revisión por item
- **Tipo:** feat
- **Archivos:** `backend/models.py` (`InventoryReceiptItem.review_status`), `backend/main.py` (`_migrate_pg` ALTER add `review_status`), `backend/schemas.py` (`ReceiptItemIn/Out.review_status`, `ReceiptReviewIn/Item`), `backend/routers/inventory.py` (`_sync_receipt_items` set status, PDF columna "Estado", nuevo `PATCH /receipts/{id}/review`), `frontend/src/services/api.js` (`reviewReceiptItems`), `frontend/src/components/ReceiptOrders.jsx`
- **Qué hace / lógica:** Cada item de la orden tiene `review_status` ∈ {`pendiente`, `revisado`} (ambos = recibido; default pendiente). En el editor: select por fila + botones "Marcar todos como" (aplica a todos). Aparece en el PDF como columna "Estado" (badge verde/ámbar). Una orden **Recibida** se puede abrir en modo revisión (`reviewMode`, botón "Revisar" en la lista): bloquea proveedor/cantidades/costo/firma y solo permite cambiar el estatus, guardado con `PATCH /review` (no toca stock). El endpoint `/review` matchea items por su id.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-18 · Orden de Recibo: artículo nuevo (sin código) + banner de pendientes por revisar
- **Tipo:** feat
- **Archivos:** `backend/models.py` (`InventoryItem.needs_code`), `backend/main.py` (`_migrate_pg` ALTER inventory add needs_code), `backend/schemas.py` (`InventoryItemOut.needs_code`, `ReceiptListItem.pending_review`), `backend/routers/inventory.py` (`_next_sin_codigo_code`, `_apply_receipt_stock` crea artículo nuevo, `GET /receipts/pending-review`, pending_review en lista), `frontend/src/services/api.js` (`getReceiptsPendingReview`), `frontend/src/components/ReceiptOrders.jsx`, `frontend/src/pages/Inventario.jsx`
- **Qué hace / lógica:** (1) En el editor de la orden, botón "Artículo nuevo" agrega una línea con `item_id=null` y nombre editable (badge "Nuevo · sin código"). Al **finalizar**, `_apply_receipt_stock` lo CREA en el inventario con código temporal secuencial `S/C-000x` y `needs_code=True`; en Inventario la fila muestra badge "⚠ Sin código" hasta asignarle un código real. (2) Endpoint `/receipts/pending-review` cuenta órdenes Recibidas con ítems `review_status='pendiente'`; Inventario muestra un **banner ámbar** (bajo los tabs) mientras haya pendientes, con botón "Revisar órdenes" que abre el modal; se recalcula al cerrar el modal. Además la lista de órdenes muestra badge "⚠ N por revisar" por orden Recibida.
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-18 · Órdenes de recibo: tab maestro-detalle + FAB + fix solape Ayuda
- **Tipo:** feat + ui
- **Archivos:** `frontend/src/components/ReceiptOrdersPanel.jsx` (nuevo), `frontend/src/components/ReceiptOrders.jsx` (prop `initial`), `frontend/src/components/Layout.jsx` (FAB item), `frontend/src/pages/Inventario.jsx`
- **Qué hace / lógica:** (1) Nuevo **tab "Órdenes de recibo"** en Inventario con **maestro-detalle**: lista con filtro por estado (default Recibida) a la izquierda y **panel de detalle** a la derecha (proveedor, fechas, responsables, firma, tabla de items con estado de revisión editable inline + "Guardar revisión", botones PDF/correo, Editar/Eliminar para Borrador). El modal `ReceiptOrders` ahora acepta `initial={{mode:'new'|'edit', id}}` para abrir directo; Inventario expone `openReceiptEditor(id)`. Al cerrar el modal se incrementa `receiptsTick` para refrescar el panel. Header "Órdenes de recibo" y banner "Revisar órdenes" ahora navegan al tab (`handleTabChange('ordenes')`). (2) **FAB** global (Layout) nueva opción "Orden de recibo" → `/inventario?action=new-receipt`; Inventario lee el param y abre el modal en modo nuevo. (3) **Fix solape**: `lg:pr-28` en el header de Inventario para que "Nuevo artículo" no quede bajo el botón flotante de Ayuda (`fixed top-3 right-3`).
- **Portado a service-desk:** ⬜ pendiente

### 2026-08-18 · Devolución a proveedor (desde orden de recibo) + PDF con motivo
- **Tipo:** feat
- **Archivos:** `backend/models.py` (SupplierReturn + SupplierReturnItem), `backend/schemas.py` (ReturnCreate/ItemIn/Out/ReturnOut/ListItem/Email), `backend/routers/inventory.py` (`returns_router`, `_next_return_number`, `_apply_return_stock`, `_build_return_html`, endpoints), `backend/main.py` (include returns_router antes del genérico), `frontend/src/services/api.js`, `frontend/src/components/SupplierReturnForm.jsx` (nuevo), `frontend/src/components/ReceiptOrdersPanel.jsx`
- **Qué hace / lógica:** Desde el detalle de una orden **Recibida** (panel), botón **"Devolver"** abre `SupplierReturnForm`: se marcan equipos, cantidad y **motivo por equipo**. `POST /api/inventory/returns` crea `SupplierReturn` (número `DEV-0001`, hereda proveedor de la orden), **descuenta stock** (`_apply_return_stock` → txn `source_type='devolucion'` con el motivo en notes), y marca esos items de la orden como `revisado`. PDF con branding titulado "DEVOLUCIÓN A PROVEEDOR" (columna Motivo, ref. a la orden) vía `_html_to_pdf`; descargar/enviar por correo (Brevo adjunto). Las devoluciones se **listan en el detalle** de la orden (`GET /returns?receipt_id=`). Tablas nuevas por `create_all`. Router incluido ANTES del genérico `/{item_id}` (mismo gotcha que receipts).
- **Portado a service-desk:** ⬜ pendiente

<!-- Nuevas entradas arriba de esta línea -->
