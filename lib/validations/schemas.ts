import { z } from 'zod'

// ─── CLIENTES ────────────────────────────────────────────────

export const ClienteSchema = z.object({
    nombre: z.string().min(1, 'El nombre es requerido').max(100),
    apellido: z.string().min(1, 'El apellido es requerido').max(100),
    dni_ruc: z.string().max(20).optional().or(z.literal('')),
    telefono: z.string().min(7, 'Teléfono inválido').max(20),
    email: z.string().email('Email inválido').optional().or(z.literal('')),
    direccion: z.string().max(200).optional().or(z.literal('')),
    notas: z.string().max(500).optional().or(z.literal('')),
    agente_id: z.string().uuid().optional().or(z.literal('')),
})

export type ClienteFormData = z.infer<typeof ClienteSchema>

// ─── DEUDAS ──────────────────────────────────────────────────

export const DeudaSchema = z.object({
    cliente_id: z.string().uuid('Selecciona un cliente válido'),
    descripcion: z.string().max(300).optional().or(z.literal('')),
    montos_activos: z.boolean(),
    monto_original: z.coerce.number().min(0, 'El monto no puede ser negativo').optional(),
    saldo_pendiente: z.coerce.number().min(0, 'El saldo no puede ser negativo').optional(),
    cuota_mensual: z.coerce.number().min(0, 'La cuota no puede ser negativa').optional(),
    tasa_interes: z.coerce.number().min(0).max(100, 'La tasa no puede superar 100%').optional(),
    frecuencia_pago: z.enum(['mensual', 'quincenal', 'semanal']),
    dia_corte_2: z.coerce.number().int().min(1).max(31).optional(),
    fecha_corte: z.string().min(1, 'La fecha de corte es requerida'),
    es_deuda_existente: z.boolean(),
    fecha_deuda_origen: z.string().optional().or(z.literal('')),
    agente_id: z.string().uuid().optional().or(z.literal('')),
    dias_antes_vencimiento: z.coerce.number().int().min(1).max(30),
    frecuencia_mora_h: z.coerce.number().int().min(1).max(168),
    frecuencia_recuperacion_h: z.coerce.number().int().min(1).max(168),
}).refine(d => {
    if (!d.montos_activos) return true
    return (d.monto_original ?? 0) > 0
}, {
    message: 'El monto debe ser mayor a 0 cuando los montos están activos',
    path: ['monto_original'],
}).refine(d => {
    if (!d.montos_activos) return true
    return (d.saldo_pendiente ?? 0) <= (d.monto_original ?? 0)
}, {
    message: 'El saldo pendiente no puede ser mayor al monto original',
    path: ['saldo_pendiente'],
}).refine(d => {
    if (!d.montos_activos) return true
    if (!d.cuota_mensual) return true
    return d.cuota_mensual <= (d.monto_original ?? 0)
}, {
    message: 'La cuota no puede ser mayor al monto original',
    path: ['cuota_mensual'],
}).refine(d => {
    if (d.frecuencia_pago !== 'quincenal') return true
    return d.dia_corte_2 && d.dia_corte_2 >= 1 && d.dia_corte_2 <= 31
}, {
    message: 'Debes indicar el segundo día de corte para pagos quincenales',
    path: ['dia_corte_2'],
})

export type DeudaFormData = z.infer<typeof DeudaSchema>

// ─── PLANTILLAS ──────────────────────────────────────────────

export const PlantillaSchema = z.object({
    nombre: z.string().min(1, 'El nombre es requerido').max(100),
    etapa: z.enum(['preventivo', 'mora_temprana', 'mora_alta', 'recuperacion', 'referencia']),
    contenido: z.string().min(10, 'El contenido debe tener al menos 10 caracteres').max(2000),
    activo: z.boolean(),
})

export type PlantillaFormData = z.infer<typeof PlantillaSchema>

// ─── WEBHOOKS ────────────────────────────────────────────────

export const WebhookSchema = z.object({
    nombre: z.string().min(1, 'El nombre es requerido').max(100),
    url: z.string().url('URL inválida'),
    descripcion: z.string().max(300).optional().or(z.literal('')),
    activo: z.boolean(),
})

export type WebhookFormData = z.infer<typeof WebhookSchema>

// ─── REFERENCIAS ─────────────────────────────────────────────

export const ReferenciaSchema = z.object({
    cliente_id: z.string().uuid(),
    nombre: z.string().min(1, 'El nombre es requerido').max(100),
    telefono: z.string().min(7, 'Teléfono inválido').max(20),
    relacion: z.string().max(50).optional().or(z.literal('')),
    estado_contacto: z.enum(['pendiente', 'contactado', 'entregado', 'no_responde']),
    notas: z.string().max(500).optional().or(z.literal('')),
})

export type ReferenciaFormData = z.infer<typeof ReferenciaSchema>

// ─── USUARIOS ────────────────────────────────────────────────

export const UsuarioInviteSchema = z.object({
    email: z.string().email('Email inválido'),
    full_name: z.string().min(1, 'El nombre es requerido').max(100),
    rol: z.enum(['admin', 'agente']),
})

export type UsuarioInviteFormData = z.infer<typeof UsuarioInviteSchema>

export const UsuarioUpdateSchema = z.object({
    full_name: z.string().min(1).max(100),
    rol: z.enum(['admin', 'agente']),
    activo: z.boolean(),
})

export type UsuarioUpdateFormData = z.infer<typeof UsuarioUpdateSchema>

// Creación directa (sin email de invitación, ya confirmado)
export const UsuarioCreateDirectoSchema = z.object({
    email:     z.string().email('Email inválido'),
    full_name: z.string().min(1, 'El nombre es requerido').max(100),
    rol:       z.enum(['admin', 'agente']),
    password:  z.string()
        .min(8, 'Mínimo 8 caracteres')
        .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
        .regex(/[0-9]/, 'Debe contener al menos un número'),
    confirm:   z.string(),
}).refine(d => d.password === d.confirm, {
    message: 'Las contraseñas no coinciden',
    path: ['confirm'],
})

export type UsuarioCreateDirectoFormData = z.infer<typeof UsuarioCreateDirectoSchema>

// ─── TIENDAS REFERIDAS ───────────────────────────────────────

export const TiendaReferidaSchema = z.object({
    nombre: z.string().min(1, 'El nombre es requerido').max(150),
    telefono: z.string().min(7, 'Teléfono inválido').max(20),
    notas: z.string().max(500).optional().or(z.literal('')),
})

export type TiendaReferidaFormData = z.infer<typeof TiendaReferidaSchema>

// ─── LOGIN ───────────────────────────────────────────────────

export const LoginSchema = z.object({
    email: z.string().email('Email inválido'),
    password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
})

export type LoginFormData = z.infer<typeof LoginSchema>
