"""Siembra de guías de uso ("Cómo usar") en la Base de Conocimientos.

Idempotente (no duplica por título), solo para el vertical it_support. Crea una
categoría "Guías de uso" y un artículo por cada módulo habilitado para admin, con
procedimientos paso a paso, en lenguaje amigable para el usuario.
"""
import os
import logging

GUIDE_ARTICLES = [
    {
        "title": "👋 Bienvenido: cómo usar la plataforma",
        "tags": "inicio, ayuda, guía",
        "content": """# Bienvenido

Esta plataforma reúne, en un solo lugar, todo lo necesario para operar tu soporte de TI: mesa de ayuda, inventario, equipos, pedidos y garantías.

## Cómo está organizado el menú

- **Principal:** Dashboard, Tickets, Agenda, Proyectos.
- **Comercial › Ventas:** Dashboard de Pedidos, Pedidos, Garantías.
- **Comercial › Maestros:** Contactos, Proveedores, Inventario, Solicitudes de Partes, Licencias, Contratos, Equipos, Cartas.
- **Sistema:** Base de Conocimientos, Reportes, Papelera, Configuración.

## Consejos rápidos

1. Usa el botón **Ayuda** (arriba a la derecha) para volver aquí en cualquier momento.
2. El botón **azul con "+"** (abajo a la derecha) crea rápido lo más usado (ticket, pedido, etc.).
3. La **campana 🔔** muestra tus notificaciones (nuevos tickets, pedidos, aprobaciones…).
4. La plataforma se puede **instalar en el celular** como app (PWA).

> Cada guía de esta sección explica, paso a paso, cómo usar un módulo.""",
    },
    {
        "title": "🎫 Tickets: cómo gestionar el soporte",
        "tags": "tickets, soporte, sla",
        "content": """# Tickets

El módulo de Tickets es el corazón de la mesa de ayuda: cada solicitud o incidencia se registra como un ticket y se le da seguimiento hasta resolverla.

## Crear un ticket

1. Entra a **Tickets** y presiona **Nuevo** (o el botón **+** flotante).
2. Completa: **título**, **cliente/contacto**, **prioridad** y **categoría**.
3. Indica si el equipo entra **con o sin cargador** (cuando aplique).
4. Guarda. El ticket queda registrado y empieza a contar su **SLA** (tiempo de atención).

## Dar seguimiento

1. Abre el ticket y **asígnalo a un técnico**.
2. Registra avances y notas en la **línea de tiempo**.
3. Si necesitas ir al sitio, usa **Agendar** para crear la visita.
4. Puedes **escanear el QR** del equipo para abrirlo rápido.
5. Si falta un repuesto, usa **Solicitar parte** (ver la guía de Solicitudes de Partes).

## Cerrar un ticket

1. Cambia el **estado** a resuelto/cerrado.
2. Agrega las **notas de resolución**.
3. El cliente podrá **calificar la atención** (CSAT).

> **Tip:** el filtro de estado por defecto muestra "No resueltos". Elige **"Todos los estados"** para ver también los cerrados.""",
    },
    {
        "title": "🧩 Solicitudes de Partes: pedir y aprobar repuestos",
        "tags": "partes, repuestos, inventario, aprobación",
        "content": """# Solicitudes de Partes

Permite que un técnico pida repuestos desde un ticket, con aprobación del responsable de inventario.

## Solicitar una parte (técnico)

1. Abre el **ticket** donde se necesita el repuesto.
2. Usa **Solicitar parte** y elige el artículo (de la bodega de **partes**) y la cantidad.
3. Envía la solicitud: queda en estado **pendiente**.

## Aprobar o rechazar (admin / responsable de inventario)

1. Recibirás un aviso en la **campana 🔔** y por **push**.
2. Entra a **Solicitudes de Partes** (o desde la notificación).
3. **Aprobar** descuenta el stock automáticamente; **Rechazar** la cierra.
4. El técnico recibe la notificación con la decisión.

## Devolver o cancelar

- Una parte aprobada se puede **devolver**, y el stock se repone.
- Una solicitud pendiente se puede **cancelar** desde el ticket.

> **Tip:** solo se pueden solicitar artículos de la bodega **partes**.""",
    },
    {
        "title": "📦 Pedidos: crear y entregar",
        "tags": "pedidos, entrega, inventario",
        "content": """# Pedidos

Gestiona la **salida y entrega** de equipos o partes al cliente. Al despachar, el inventario se descuenta solo.

## Crear un pedido

1. Entra a **Pedidos** y presiona **Nuevo pedido**.
2. Elige el **cliente** y agrega los **artículos** (se buscan del inventario por código o nombre).
3. Escribe el **precio** de cada artículo directamente en el pedido.
4. Guarda como **Borrador** o emítelo.

## Descuento de inventario

- Al pasar de **Borrador** a cualquier otro estado, el sistema **descuenta el stock** automáticamente.

## Entregar

1. Agenda la **fecha de entrega** si aplica.
2. Genera la **Garantía** del pedido (ver guía de Garantías).
3. Cambia el estado a **Entregado**. *Nota:* solo se permite si la garantía está completa (con los N° de serie).

## Cancelar

- El botón **Cancelar** devuelve los artículos al inventario y elimina la garantía vinculada. El pedido queda en estado **Cancelado**.

> **Tip:** revisa el **Dashboard de Pedidos** para ver totales, entregados y cancelados.""",
    },
    {
        "title": "🛡️ Garantías: generar el certificado",
        "tags": "garantías, certificado, series, pdf",
        "content": """# Garantías

Genera el **certificado de garantía** de los equipos entregados, listo para imprimir o compartir.

## Generar desde un pedido

1. En el **pedido** entregado, presiona **Garantía**.
2. Se abre el formulario ya con el **cliente** y los **equipos** (el "Tipo" toma la **categoría** del inventario).
3. Completa el **N° de serie** de cada equipo (obligatorio).
4. Elige el **período** (6 meses por defecto) y guarda.

## Avisos de estado

- Si falta alguna serie, el certificado se marca como **incompleto** (y el pedido no se puede entregar).
- Al completar todas las series, queda **vigente**.

## Imprimir o compartir

- Usa **Imprimir**, **PDF** o **Compartir** para entregar el certificado al cliente.

> **Tip:** el N° de garantía es **secuencial** (GRT-0001, GRT-0002…), igual que los pedidos.""",
    },
    {
        "title": "📥 Inventario: administrar el stock",
        "tags": "inventario, stock, csv, artículos",
        "content": """# Inventario

Controla los equipos y partes disponibles: altas, existencias, categorías y ubicaciones.

## Registrar artículos

1. Entra a **Inventario** y presiona **Nuevo artículo**.
2. Completa: **código**, **nombre**, **categoría**, **proveedor**, **condición** y **ubicación**.
3. Guarda. También puedes **Importar CSV** para cargar muchos a la vez (usa la **Plantilla**).

## Autocompletado y alertas

- Al escribir la descripción, el sistema **sugiere** artículos y **avisa de duplicados** con código distinto.
- Al seleccionar un artículo con **poco o sin stock**, muestra una alerta.

## Salidas y movimientos

- Los **pedidos** y las **solicitudes de partes** descuentan stock automáticamente.
- La pestaña **Movimientos** muestra el historial de entradas y salidas.

## Exportar

- Usa **Exportar CSV** o **Exportar PDF** para llevar el inventario a otro formato.

> **Tip:** los filtros (categoría, bodega, condición, estado) ayudan a encontrar artículos rápido.""",
    },
    {
        "title": "🖥️ Equipos (Flota): administrar el parque de equipos",
        "tags": "equipos, flota, activos",
        "content": """# Equipos

Lleva el registro de los equipos administrados (la "flota"): marca, modelo, serie, ubicación y contrato.

## Registrar un equipo

1. Entra a **Equipos** y presiona **Nueva**.
2. Completa **marca, modelo, N° de serie, ubicación** y demás datos.
3. Vincúlalo a un **contrato** si corresponde. Guarda.

## Importar y filtrar

- Usa **Importar** para cargar varios equipos de una vez.
- Filtra por **tipo** o **propiedad** para encontrarlos rápido; marca "Mostrar equipos dados de baja" si necesitas ver los retirados.

> **Tip:** desde un equipo puedes ver su historial y los tickets relacionados.""",
    },
    {
        "title": "📝 Contratos: gestión de contratos de servicio",
        "tags": "contratos, vigencia",
        "content": """# Contratos

Registra los contratos de servicio con tus clientes y controla su vigencia.

## Crear un contrato

1. Entra a **Contratos** y presiona **Nuevo**.
2. Completa: **cliente**, **número de contrato**, **vigencia** y **equipos cubiertos**.
3. Guarda.

## Seguimiento

- Consulta la **fecha de vencimiento** de cada contrato.
- Vincula equipos de la flota al contrato para saber qué cubre.""",
    },
    {
        "title": "🔑 Licencias de Software: inventario de licencias",
        "tags": "licencias, software, vencimiento",
        "content": """# Licencias de Software

Controla las licencias de software: producto, clave, vencimiento y asignación.

## Registrar una licencia

1. Entra a **Licencias Software** y presiona **Nueva**.
2. Completa: **producto**, **clave/serial**, **fecha de vencimiento** y a quién se **asigna**.
3. Guarda.

## Seguimiento

- Revisa periódicamente las **licencias por vencer** para renovarlas a tiempo.""",
    },
    {
        "title": "🚚 Proveedores: catálogo de proveedores",
        "tags": "proveedores, compras",
        "content": """# Proveedores

Mantén el catálogo de proveedores para asociarlos a los artículos del inventario.

## Registrar un proveedor

1. Entra a **Proveedores** y presiona **Nuevo**.
2. Completa los **datos de contacto** del proveedor y guarda.

## Uso

- Al crear o editar un **artículo de inventario**, puedes seleccionar su **proveedor**.""",
    },
    {
        "title": "👤 Contactos: clientes, contactos y empresas",
        "tags": "contactos, clientes, empresas",
        "content": """# Contactos

Es el directorio central de clientes, contactos y empresas que usa el resto de la plataforma.

## Registrar un contacto

1. Entra a **Contactos** y presiona **Nuevo**.
2. Completa **nombre**, **empresa** y datos de contacto. Guarda.

## Uso

- Los contactos se seleccionan al crear **tickets**, **pedidos** y **garantías**, evitando reescribir datos.""",
    },
    {
        "title": "📅 Agenda: programar visitas y citas",
        "tags": "agenda, calendario, visitas",
        "content": """# Agenda

Organiza las visitas y citas del equipo, con vista por día o semana.

## Crear una cita

1. Entra a **Agenda**.
2. Crea un evento nuevo, **o** agéndalo directamente desde un **ticket** o **pedido**.
3. Elige fecha, hora y responsable. Guarda.

## Vistas

- Cambia entre vista de **día** y **semana** con los botones superiores.
- Si está conectado, se **sincroniza con Google Calendar**.""",
    },
    {
        "title": "🗂️ Proyectos: agrupar tickets con avance",
        "tags": "proyectos, avance",
        "content": """# Proyectos

Agrupa varios tickets bajo un mismo proyecto y sigue su avance global.

## Crear un proyecto

1. Entra a **Proyectos** y presiona **Nuevo**.
2. Completa **nombre**, **cliente** y **fechas**. Guarda.

## Vincular tickets

1. Dentro del proyecto, **vincula los tickets** que le corresponden.
2. Asigna un **peso (%)** a cada ticket.
3. El avance del proyecto se calcula a medida que los tickets se resuelven.""",
    },
    {
        "title": "✉️ Cartas: generar documentos",
        "tags": "cartas, documentos, pdf",
        "content": """# Cartas

Genera cartas y documentos a partir de plantillas, listos para imprimir.

## Crear una carta

1. Entra a **Cartas** y elige o crea una **plantilla**.
2. Completa los **datos** solicitados.
3. **Imprime** o **descarga** el documento en PDF.""",
    },
    {
        "title": "📊 Dashboards: leer los tableros",
        "tags": "dashboard, indicadores, pedidos",
        "content": """# Dashboards

Los tableros resumen el estado de la operación de un vistazo.

## Dashboard (servicios)

- Muestra **tickets abiertos**, por estado y **cumplimiento de SLA**, más la actividad reciente.

## Dashboard de Pedidos

- Muestra el **total de pedidos** y su **monto**, y el detalle por estado: borrador/emitido/programado, **entregados** y **cancelados**.
- Usa los filtros de **año** y **mes** para acotar el período.

> **Tip:** el monto en pedidos corresponde a lo que indicas en cada pedido.""",
    },
    {
        "title": "📚 Base de Conocimientos: artículos de ayuda",
        "tags": "base de conocimientos, artículos, ayuda",
        "content": """# Base de Conocimientos

Es esta misma sección: un lugar para **guías y procedimientos** que el equipo puede consultar.

## Crear o editar un artículo

1. Entra a **Base de Conocimientos** y presiona **Nuevo artículo**.
2. Escribe el **título** y el **contenido** (admite formato: títulos, listas, negrita).
3. Elige la **audiencia** (todos, agentes/admins, solo administradores) y guarda.

## Consultar

- Usa el **buscador** o navega por **categorías** para encontrar una guía.""",
    },
    {
        "title": "📈 Reportes: informes de la operación",
        "tags": "reportes, informes, analítica",
        "content": """# Reportes

Consulta informes y analítica para tomar decisiones con datos.

## Cómo usarlo

1. Entra a **Reportes**.
2. Elige el **reporte** y aplica los **filtros** (fechas, estado, etc.).
3. **Visualiza** los resultados y expórtalos si lo necesitas.""",
    },
    {
        "title": "🗑️ Papelera: restaurar o eliminar",
        "tags": "papelera, restaurar, eliminar",
        "content": """# Papelera

Guarda los elementos eliminados para poder **recuperarlos** o **borrarlos definitivamente**.

## Cómo usarla

1. Entra a **Papelera**.
2. Verás lo eliminado (tickets, pedidos, contactos…).
3. **Restaurar** devuelve el elemento a su módulo.
4. **Confirmar** lo elimina de forma **permanente** (esta acción no se puede deshacer).

> **Tip:** ante la duda, **restaura**; siempre puedes volver a eliminarlo después.""",
    },
    {
        "title": "⚙️ Configuración: empresa, roles y accesos",
        "tags": "configuración, roles, accesos, usuarios",
        "content": """# Configuración

Ajustes generales de la empresa y control de accesos (solo administradores).

## Qué puedes ajustar

1. **Identidad:** logo, colores, nombre y datos fiscales de la empresa.
2. **Usuarios:** crear y administrar las personas del equipo.
3. **Roles y accesos:** definir qué puede **ver** o **editar** cada rol, por módulo.
4. **Preferencias:** formato de fecha, zona horaria y **módulos activos**.

> **Tip:** los accesos por rol tienen tres niveles: **sin acceso**, **lectura** y **edición**.""",
    },
]


def seed_kb_guides():
    """Crea las guías de uso si no existen. Solo it_support. No falla el arranque."""
    if os.getenv("PRODUCT_VERTICAL", "mps").strip().lower() != "it_support":
        return
    try:
        from database import SessionLocal
        import models
    except Exception as e:
        logging.warning("seed_kb_guides: no se pudo importar (%s)", e)
        return
    db = SessionLocal()
    try:
        author = (
            db.query(models.User)
            .filter(models.User.role.in_([models.UserRole.superadmin, models.UserRole.admin]))
            .order_by(models.User.id)
            .first()
        )
        if not author:
            return  # aún no hay admin; se sembrará en un arranque posterior
        cat = db.query(models.KBCategory).filter(models.KBCategory.name == "Guías de uso").first()
        if not cat:
            cat = models.KBCategory(
                name="Guías de uso",
                description="Cómo usar cada módulo de la plataforma, paso a paso.",
                icon="book", order=0, is_active=True,
            )
            db.add(cat)
            db.flush()
        created = 0
        for art in GUIDE_ARTICLES:
            exists = (
                db.query(models.KBArticle)
                .filter(models.KBArticle.title == art["title"], models.KBArticle.deleted_at.is_(None))
                .first()
            )
            if exists:
                continue
            db.add(models.KBArticle(
                title=art["title"],
                content=art["content"],
                category_id=cat.id,
                created_by_id=author.id,
                tags=art.get("tags"),
                audience="agents",  # visible para todo el staff (no clientes)
                is_published=True,
            ))
            created += 1
        db.commit()
        if created:
            logging.info("seed_kb_guides: %d artículos creados", created)
    except Exception as e:
        db.rollback()
        logging.warning("seed_kb_guides error: %s", e)
    finally:
        db.close()
