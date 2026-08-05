import type { Cliente, Profile } from './index'

// ─── ENUMS ────────────────────────────────────────────────────

export type EstadoTicket = 'valido' | 'anulado'
export type OrigenTicket = 'automatico' | 'manual'
export type EstadoSorteo = 'borrador' | 'activo' | 'cerrado'
export type ModoAdjunto = 'base64' | 'url' | 'ambos' | 'ninguno'
export type EstadoPrintJob =
    | 'pendiente' | 'reclamado' | 'impreso' | 'error' | 'cancelado'
export type TipoConexionEstacion = 'red' | 'windows'
export type TipoTicketEvento =
    | 'emitido' | 'enviado_wa' | 'impreso' | 'anulado' | 'asignado_sorteo'

// ─── SNAPSHOT ─────────────────────────────────────────────────

/**
 * Datos congelados en el momento de emitir el boleto. El PDF y la tirilla
 * impresa se generan SIEMPRE desde aquí, nunca desde las tablas vivas, para
 * que un boleto ya entregado no cambie si luego se corrigen los datos.
 */
export interface TicketSnapshot {
    cliente: {
        id: string
        nombre: string
        apellido: string
        telefono: string | null
        dni_ruc: string | null
    }
    sorteo: {
        id: string
        nombre: string
        premio: string | null
        fecha_fin: string
    } | null
    negocio: {
        nombre_comercial: string
        rnc: string | null
        direccion: string | null
        telefono: string | null
        texto_legal: string | null
        url_terminos: string | null
        pie_impresion: string | null
        logo_url: string | null
    }
    emitido_at_rd: string
    origen: OrigenTicket
    version_snapshot: number
}

// ─── ENTIDADES ────────────────────────────────────────────────

export interface Sucursal {
    id: string
    nombre: string
    direccion: string | null
    telefono: string | null
    activo: boolean
    created_at: string
    updated_at: string
}

export interface EstacionImpresion {
    id: string
    sucursal_id: string
    nombre: string
    token_prefijo: string
    tipo_conexion: TipoConexionEstacion
    impresora_ip: string | null
    impresora_port: number
    impresora_nombre: string | null
    ancho_cols: number
    codepage: string
    activo: boolean
    ultimo_heartbeat: string | null
    ultima_ip_agente: string | null
    version_agente: string | null
    created_at: string
    updated_at: string
    sucursal?: Sucursal
}

export interface ConfiguracionTicket {
    id: boolean
    nombre_comercial: string
    rnc: string | null
    direccion: string | null
    telefono: string | null
    logo_url: string | null
    texto_legal: string | null
    url_terminos: string | null
    prefijo_numeracion: string
    pie_impresion: string | null
    modo_adjunto: ModoAdjunto
    updated_at: string
    updated_by: string | null
}

export interface Sorteo {
    id: string
    nombre: string
    descripcion: string | null
    premio: string | null
    fecha_inicio: string
    fecha_fin: string
    estado: EstadoSorteo
    prefijo: string
    ultimo_numero: number
    cantidad_ganadores_default: number
    creado_por: string | null
    created_at: string
    updated_at: string
}

export interface Ticket {
    id: string
    numero: number
    numero_formateado: string
    sorteo_id: string | null
    cliente_id: string
    pago_id: string | null
    deuda_id: string | null
    origen: OrigenTicket
    motivo: string | null
    estado: EstadoTicket
    anulado_por: string | null
    anulado_at: string | null
    motivo_anulacion: string | null
    token_publico: string
    snapshot: TicketSnapshot
    emitido_por: string | null
    emitido_at: string
    veces_enviado: number
    veces_impreso: number
    created_at: string
    // Joins opcionales. Ninguna consulta de lib/actions/tickets.ts trae la
    // entidad completa: ver TicketConRelaciones / TicketConSorteoResumen más
    // abajo para las formas parciales reales que sí se devuelven (I10).
    cliente?: Cliente
    sorteo?: Sorteo
}

export interface TicketEvento {
    id: string
    ticket_id: string
    tipo: TipoTicketEvento
    estado: 'ok' | 'error'
    es_copia: boolean
    detalle: string | null
    payload: Record<string, unknown> | null
    respuesta_http: number | null
    respuesta_body: string | null
    usuario_id: string | null
    created_at: string
    usuario?: Profile
}

// ─── TIPOS DE CONSULTA (formas parciales reales) ──────────────
//
// Las consultas de lib/actions/tickets.ts embeben relaciones parciales
// (`.select('*, cliente:clientes(id, nombre, ...)')`), no la entidad
// completa. Tiparlas como `Ticket` a secas —con `cliente?: Cliente`— miente
// sobre lo que trae cada fila: el tipo deja compilar `ticket.cliente.email`
// aunque esa columna nunca viaja en el SELECT, y revienta en runtime con
// `undefined`. Estos tipos documentan, función por función, lo que
// devuelve de verdad cada consulta (I10).

/** Cliente tal como lo embebe getTickets(): id, nombre, apellido, teléfono. */
export interface TicketClienteResumen {
    id: string
    nombre: string
    apellido: string
    telefono: string | null
}

/** Sorteo tal como lo embebe getTickets(): solo id y nombre. */
export interface TicketSorteoResumenListado {
    id: string
    nombre: string
}

/** Sorteo tal como lo embebe getTicketsCliente(): incluye el premio. */
export interface TicketSorteoResumenPremio {
    id: string
    nombre: string
    premio: string | null
}

/** Usuario tal como lo embebe getEventosTicket(): id y nombre, nada más. */
export interface TicketEventoUsuarioResumen {
    id: string
    full_name: string
}

/** Retorno real de getTickets(): el listado general de /tickets. */
export interface TicketConRelaciones extends Omit<Ticket, 'cliente' | 'sorteo'> {
    cliente: TicketClienteResumen
    sorteo: TicketSorteoResumenListado | null
}

/** Retorno real de getTicketsCliente(): boletos de UN cliente ya conocido,
 *  por eso no se re-embebe `cliente`; el sorteo sí trae premio. */
export interface TicketConSorteoResumen extends Omit<Ticket, 'cliente' | 'sorteo'> {
    sorteo: TicketSorteoResumenPremio | null
}

/** Retorno real de getEventosTicket(): historial de un boleto con el
 *  nombre de quien generó cada evento. */
export interface TicketEventoConUsuario extends Omit<TicketEvento, 'usuario'> {
    usuario: TicketEventoUsuarioResumen | null
}

export interface PrintJob {
    id: string
    /** NULL para trabajos de servicio (es_prueba = true): ver esa columna. */
    ticket_id: string | null
    sucursal_id: string
    estado: EstadoPrintJob
    /** true para páginas de prueba encoladas desde /estaciones. No representa un boleto real. */
    es_prueba: boolean
    es_copia: boolean
    payload_escpos: string | null
    preview_texto: string | null
    intentos: number
    max_intentos: number
    estacion_id: string | null
    claimed_at: string | null
    impreso_at: string | null
    error_mensaje: string | null
    solicitado_por: string | null
    created_at: string
}

// ─── PAYLOAD DEL WEBHOOK DE BOLETOS ───────────────────────────

export interface TicketWebhookPayload {
    evento: 'ticket_emitido'
    timestamp: string
    enviado_por: 'sistema' | 'manual'
    reenvio: boolean
    cliente: {
        id: string
        nombre: string
        apellido: string
        telefono: string
    }
    ticket: {
        id: string
        numero: string
        sorteo: string | null
        emitido_at: string
    }
    mensaje: string
    url_terminos: string | null
    url_publica: string | null
    adjunto: { tipo: 'pdf'; nombre: string; base64: string } | null
}

// ─── ETIQUETAS ────────────────────────────────────────────────

export const ESTADO_TICKET_LABELS: Record<EstadoTicket, string> = {
    valido: 'Válido',
    anulado: 'Anulado',
}

export const ESTADO_TICKET_COLORS: Record<EstadoTicket, string> = {
    valido: 'bg-green-500/20 text-green-300',
    anulado: 'bg-red-500/20 text-red-300',
}

export const ORIGEN_TICKET_LABELS: Record<OrigenTicket, string> = {
    automatico: 'Automático',
    manual: 'Manual',
}

export const ESTADO_SORTEO_LABELS: Record<EstadoSorteo, string> = {
    borrador: 'Borrador',
    activo: 'Activo',
    cerrado: 'Cerrado',
}

export const ESTADO_PRINT_JOB_LABELS: Record<EstadoPrintJob, string> = {
    pendiente: 'En cola',
    reclamado: 'Imprimiendo',
    impreso: 'Impreso',
    error: 'Error',
    cancelado: 'Cancelado',
}

export const ESTADO_PRINT_JOB_COLORS: Record<EstadoPrintJob, string> = {
    pendiente: 'bg-slate-500/20 text-slate-300',
    reclamado: 'bg-blue-500/20 text-blue-300',
    impreso: 'bg-green-500/20 text-green-300',
    error: 'bg-red-500/20 text-red-300',
    cancelado: 'bg-slate-500/20 text-slate-400',
}
