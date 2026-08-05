import { z } from 'zod'

export const TicketManualSchema = z.object({
    cliente_id: z.string().uuid('Cliente inválido'),
    motivo: z.string()
        .trim()
        .min(3, 'El motivo debe tener al menos 3 caracteres')
        .max(200, 'El motivo no puede pasar de 200 caracteres'),
})

export type TicketManualFormData = z.infer<typeof TicketManualSchema>

export const AnularTicketSchema = z.object({
    ticket_id: z.string().uuid(),
    motivo: z.string()
        .trim()
        .min(3, 'Indica el motivo de la anulación')
        .max(200, 'El motivo no puede pasar de 200 caracteres'),
})

export type AnularTicketFormData = z.infer<typeof AnularTicketSchema>

export const ConfiguracionTicketSchema = z.object({
    nombre_comercial: z.string().trim()
        .min(1, 'El nombre comercial es obligatorio')
        .max(32, 'Máximo 32 caracteres: va impreso en el encabezado de la tirilla del boleto y debe caber en el papel más angosto que soporta la impresora (32 columnas)'),
    rnc: z.string().trim().optional().nullable(),
    direccion: z.string().trim().optional().nullable(),
    telefono: z.string().trim().optional().nullable(),
    logo_url: z.string().trim().url('URL inválida').optional().or(z.literal('')).nullable(),
    texto_legal: z.string().trim().max(500).optional().nullable(),
    url_terminos: z.string().trim().url('URL inválida').optional().or(z.literal('')).nullable(),
    prefijo_numeracion: z.string().trim().min(1).max(12)
        .regex(/^[A-Z0-9]+$/, 'Solo mayúsculas y números'),
    pie_impresion: z.string().trim().max(300).optional().nullable(),
    modo_adjunto: z.enum(['base64', 'url', 'ambos', 'ninguno']),
})

export type ConfiguracionTicketFormData = z.infer<typeof ConfiguracionTicketSchema>
