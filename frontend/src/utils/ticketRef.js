// Número visible de un ticket. Los mantenimientos tienen su propia secuencia (MANT-0001);
// el resto de tickets se identifica con su id (#123).
export const ticketRef = (t) => (t?.maint_number || `#${t?.id ?? ''}`)

// Etiqueta con la palabra "Ticket" delante: "Ticket #123" o "Ticket MANT-0001".
export const ticketLabel = (t) => `Ticket ${ticketRef(t)}`
