import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { createTicket, createClientDispatch, getStatuses } from '../services/api'
import toast from 'react-hot-toast'

/**
 * Si un visitante llenó una solicitud (ticket/pedido) sin sesión, la guardamos en
 * localStorage y al iniciar sesión / crear cuenta la enviamos automáticamente bajo su cuenta.
 */
export default function PendingRequestHandler() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const doneRef = useRef(false)

  useEffect(() => {
    if (!user || doneRef.current) return
    let raw
    try { raw = localStorage.getItem('pendingRequest') } catch { return }
    if (!raw) return
    let draft
    try { draft = JSON.parse(raw) } catch { localStorage.removeItem('pendingRequest'); return }
    // El funnel es de clientes: solo autoenviamos si quien entra es cliente.
    if (user.role !== 'client') return
    doneRef.current = true
    localStorage.removeItem('pendingRequest')
    ;(async () => {
      try {
        if (draft.type === 'pedido') {
          await createClientDispatch({ title: draft.title, notes: draft.notes || null, items: draft.items || null })
          toast.success('¡Listo! Tu pedido fue enviado. Un agente lo revisará.')
          navigate('/mis-pedidos')
        } else {
          let statusId = draft.status_id
          if (!statusId) {
            const r = await getStatuses().catch(() => ({ data: [] }))
            const st = r.data || []
            statusId = (st.find((s) => /abierto|nuevo|open/i.test(s.name)) || st[0])?.id
          }
          await createTicket({
            title: draft.title,
            description: draft.notes || '',
            priority: 'medium',
            status_id: statusId,
            client_id: user.id,
            category: 'Solicitud web',
            charger: 'Sin cargador',
          })
          toast.success('¡Listo! Tu ticket fue creado.')
          navigate('/tickets')
        }
      } catch (err) {
        toast.error('No pudimos enviar tu solicitud automáticamente. Vuelve a intentarlo desde el portal.')
        navigate('/inicio')
      }
    })()
  }, [user, navigate])

  return null
}
