// ─── ENUMS & TIPOS BASE ───────────────────────────────────────

export type Rol = 'admin' | 'agente'

export type FrecuenciaPago = 'mensual' | 'quincenal' | 'semanal'

// Permisos granulares que el admin puede otorgar a agentes
export interface PermisosAgente {
    ver_webhooks: boolean
    ver_plantillas: boolean
    ver_logs: boolean
    ver_referencias: boolean
    ver_simulador: boolean
    editar_clientes: boolean
    eliminar_cuentas: boolean
    registrar_pagos: boolean
    crear_cuentas: boolean
}

export type EtapaCobranza =
    | 'preventivo'
    | 'mora_temprana'
    | 'mora_alta'
    | 'recuperacion'
    | 'saldado'

export type EstadoDeuda = 'activo' | 'saldado' | 'cancelado' | 'refinanciado'

export type EstadoContactoReferencia =
    | 'pendiente'
    | 'contactado'
    | 'entregado'
    | 'no_responde'

export type EstadoEnvio = 'pendiente' | 'enviado' | 'error' | 'omitido'

export type EtapaPlantilla =
    | 'preventivo'
    | 'mora_temprana'
    | 'mora_alta'
    | 'recuperacion'
    | 'referencia'

// ─── ENTIDADES PRINCIPALES ────────────────────────────────────

export interface Profile {
    id: string
    full_name: string
    rol: Rol
    activo: boolean
    permisos?: PermisosAgente | null   // null before migration, populated after
    created_at: string
    updated_at: string
}

export const DEFAULT_PERMISOS_AGENTE: PermisosAgente = {
    ver_webhooks: false,
    ver_plantillas: false,
    ver_logs: true,
    ver_referencias: true,
    ver_simulador: false,
    editar_clientes: true,
    eliminar_cuentas: false,
    registrar_pagos: true,
    crear_cuentas: true,
}

export interface Cliente {
    id: string
    nombre: string
    apellido: string
    dni_ruc?: string
    telefono: string
    email?: string
    direccion?: string
    notas?: string
    agente_id?: string
    activo: boolean
    created_at: string
    updated_at: string
    // Joins opcionales
    agente?: Profile
    deudas?: Deuda[]
}

export interface Deuda {
    id: string
    cliente_id: string
    descripcion?: string
    monto_original: number
    saldo_pendiente: number
    cuota_mensual: number | null
    tasa_interes: number
    frecuencia_pago: FrecuenciaPago
    dia_corte_2: number | null
    fecha_corte: string
    es_deuda_existente: boolean
    fecha_deuda_origen?: string
    dias_atraso: number
    etapa: EtapaCobranza
    pausado: boolean
    estado: EstadoDeuda
    agente_id?: string
    created_at: string
    updated_at: string
    // Joins opcionales
    cliente?: Cliente
    agente?: Profile
    configuracion?: ConfiguracionRecordatorio
}

export interface Pago {
    id: string
    deuda_id: string
    cliente_id: string
    monto: number
    periodo: string
    registrado_por?: string
    nota?: string
    created_at: string
    // Joins
    deuda?: Deuda
    cliente?: Cliente
    registrador?: Profile
}

export interface ConfiguracionRecordatorio {
    id: string
    deuda_id: string
    dias_antes_vencimiento: number
    frecuencia_mora_h: number
    frecuencia_recuperacion_h: number
    activo: boolean
    created_at: string
    updated_at: string
}

export interface ReferenciaCliente {
    id: string
    cliente_id: string
    nombre: string
    telefono: string
    relacion?: string
    estado_contacto: EstadoContactoReferencia
    notas?: string
    created_at: string
    updated_at: string
    // Joins
    cliente?: Cliente
}

export interface PlantillaMensaje {
    id: string
    nombre: string
    etapa: EtapaPlantilla
    contenido: string
    activo: boolean
    created_at: string
    updated_at: string
}

export interface Webhook {
    id: string
    nombre: string
    url: string
    descripcion?: string
    activo: boolean
    headers: Record<string, string>
    created_at: string
    updated_at: string
}

export interface EnvioLog {
    id: string
    deuda_id: string
    cliente_id: string
    webhook_id?: string
    plantilla_id?: string
    etapa: EtapaCobranza
    mensaje_enviado: string
    payload: Record<string, unknown>
    tipo_destino: 'cliente' | 'referencia'
    referencia_id?: string
    estado: EstadoEnvio
    respuesta_http?: number
    respuesta_body?: string
    enviado_por: 'cron' | 'manual'
    agente_id?: string
    sent_at: string
    // Joins
    cliente?: Cliente
    deuda?: Deuda
    agente?: Profile
}

// ─── PAYLOAD DEL WEBHOOK ──────────────────────────────────────

export interface WebhookPayload {
    evento: 'recordatorio_cobranza'
    timestamp: string
    enviado_por: 'cron' | 'manual'
    etapa: EtapaCobranza
    tipo_destino: 'cliente' | 'referencia'
    cliente: {
        id: string
        nombre: string
        apellido: string
        telefono: string
        email?: string
    }
    deuda: {
        id: string
        monto_original: number
        saldo_pendiente: number
        cuota_mensual?: number | null
        tasa_interes: number
        fecha_corte: string
        dias_atraso: number
        frecuencia_pago?: FrecuenciaPago
    }
    mensaje: string
    referencia?: {
        id: string
        nombre: string
        telefono: string
        relacion?: string
    }
    agente?: {
        id: string
        nombre: string
    }
}

// ─── TIPOS DE DASHBOARD ───────────────────────────────────────

export interface DashboardStats {
    total_cartera: number
    total_clientes: number
    clientes_al_dia: number
    clientes_mora_temprana: number
    clientes_mora_alta: number
    clientes_recuperacion: number
    monto_al_dia: number
    monto_mora: number
    enviados_hoy: number
    pendientes_envio: number
}

// ─── HELPERS ─────────────────────────────────────────────────

export const ETAPA_LABELS: Record<EtapaCobranza, string> = {
    preventivo: 'Preventivo',
    mora_temprana: 'Mora Temprana',
    mora_alta: 'Mora Alta',
    recuperacion: 'Recuperación',
    saldado: 'Saldado',
}

export const ETAPA_COLORS: Record<EtapaCobranza, string> = {
    preventivo: 'bg-blue-100 text-blue-800',
    mora_temprana: 'bg-yellow-100 text-yellow-800',
    mora_alta: 'bg-orange-100 text-orange-800',
    recuperacion: 'bg-red-100 text-red-800',
    saldado: 'bg-green-100 text-green-800',
}

export const ESTADO_DEUDA_LABELS: Record<EstadoDeuda, string> = {
    activo: 'Activo',
    saldado: 'Saldado',
    cancelado: 'Cancelado',
    refinanciado: 'Refinanciado',
}

export const ESTADO_ENVIO_COLORS: Record<EstadoEnvio, string> = {
    pendiente: 'bg-yellow-100 text-yellow-800',
    enviado: 'bg-green-100 text-green-800',
    error: 'bg-red-100 text-red-800',
    omitido: 'bg-gray-100 text-gray-700',
}

export const FRECUENCIA_LABELS: Record<FrecuenciaPago, string> = {
    mensual: 'Mensual',
    quincenal: 'Quincenal',
    semanal: 'Semanal',
}

export const FRECUENCIA_DIAS: Record<FrecuenciaPago, number> = {
    mensual: 30,
    quincenal: 15,
    semanal: 7,
}
