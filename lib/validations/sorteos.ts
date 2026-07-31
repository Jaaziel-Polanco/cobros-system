import { z } from 'zod'

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')

export const SorteoSchema = z.object({
    nombre: z.string().trim().min(3, 'El nombre debe tener al menos 3 caracteres').max(120),
    descripcion: z.string().trim().max(500).optional().nullable(),
    premio: z.string().trim().max(200).optional().nullable(),
    fecha_inicio: FECHA,
    fecha_fin: FECHA,
    prefijo: z.string().trim().min(2).max(12)
        .regex(/^[A-Z0-9]+$/, 'El prefijo solo admite mayúsculas y números'),
    cantidad_ganadores_default: z.number().int().min(1).max(100),
}).refine(d => d.fecha_fin >= d.fecha_inicio, {
    message: 'La fecha final no puede ser anterior a la inicial',
    path: ['fecha_fin'],
})

export type SorteoFormData = z.infer<typeof SorteoSchema>

export const EjecutarSorteoSchema = z.object({
    sorteo_id: z.string().uuid(),
    rango_desde: FECHA,
    rango_hasta: FECHA,
    cantidad_ganadores: z.number().int().min(1).max(100),
    semilla: z.string().trim().max(120).optional(),
    // Aquí había un campo `notas` que se validaba y se tiraba: ningún
    // formulario lo rellena, `ejecutarSorteo` no lo lee y el RPC
    // `guardar_ejecucion_sorteo` no tiene parámetro donde ponerlo, así que
    // `sorteo_ejecuciones.notas` no se escribía nunca. Un campo que el
    // esquema acepta y el sistema descarta es peor que no tenerlo: promete
    // que se guarda algo. Se retira del esquema; la columna sigue en la base
    // y, cuando se quiera de verdad, hay que añadir el parámetro al RPC y
    // pasarlo — no basta con volver a declararlo aquí.
}).refine(d => d.rango_hasta >= d.rango_desde, {
    message: 'La fecha final no puede ser anterior a la inicial',
    path: ['rango_hasta'],
})

export type EjecutarSorteoFormData = z.infer<typeof EjecutarSorteoSchema>
