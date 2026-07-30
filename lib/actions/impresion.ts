'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getPermisos } from '@/lib/utils/permisos'
import { construirTirillaTicket } from '@/lib/escpos/tirilla-ticket'
import type { Ticket } from '@/lib/types'

/** Estación asociada al usuario actual, con su estado de conexión. */
export async function getEstadoEstacionDeUsuario(): Promise<{
    sucursalId: string
    sucursalNombre: string
    estacionNombre: string
    enLinea: boolean
} | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: perfil } = await supabase
        .from('profiles').select('sucursal_id').eq('id', user.id).single()

    if (!perfil?.sucursal_id) return null

    const { data: estacion } = await supabase
        .from('estaciones_impresion')
        .select('nombre, ultimo_heartbeat, sucursal:sucursales(nombre)')
        .eq('sucursal_id', perfil.sucursal_id)
        .eq('activo', true)
        .maybeSingle()

    if (!estacion) return null

    const enLinea = estacion.ultimo_heartbeat
        ? Date.now() - new Date(estacion.ultimo_heartbeat).getTime() < 60_000
        : false

    return {
        sucursalId: perfil.sucursal_id,
        sucursalNombre:
            (estacion.sucursal as unknown as { nombre: string } | null)?.nombre ?? '',
        estacionNombre: estacion.nombre,
        enLinea,
    }
}

/**
 * Encola la impresión de un boleto en la sucursal del usuario.
 *
 * Los bytes ESC/POS se construyen AQUÍ, en el servidor: el agente local no
 * conoce el formato, así que cambiar el diseño de la tirilla no obliga a
 * actualizar ninguna PC de sucursal.
 */
export async function imprimirTicket(
    ticketId: string,
    opciones?: { esCopia?: boolean },
): Promise<{ jobId: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: perfil } = await supabase
        .from('profiles').select('id, rol, permisos, sucursal_id').eq('id', user.id).single()

    if (!perfil) throw new Error('Perfil no encontrado')
    if (!getPermisos(perfil).imprimir_ticket) {
        throw new Error('No tienes permiso para imprimir boletos')
    }
    if (!perfil.sucursal_id) {
        throw new Error('Tu usuario no tiene sucursal asignada. Pídeselo a un administrador.')
    }

    const { data: estacion } = await supabase
        .from('estaciones_impresion')
        .select('ancho_cols, codepage')
        .eq('sucursal_id', perfil.sucursal_id)
        .eq('activo', true)
        .maybeSingle()

    if (!estacion) {
        throw new Error('Tu sucursal no tiene una estación de impresión activa')
    }

    const { data: ticketData, error: ticketError } = await supabase
        .from('tickets').select('*').eq('id', ticketId).single()

    if (ticketError || !ticketData) throw new Error('Boleto no encontrado')

    const ticket = ticketData as Ticket
    if (ticket.estado === 'anulado') throw new Error('El boleto está anulado')

    // La primera impresión no lleva marca; las siguientes sí.
    const esCopia = opciones?.esCopia ?? ticket.veces_impreso > 0

    const base = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000'
    const { bytes, preview } = construirTirillaTicket({
        numeroFormateado: ticket.numero_formateado,
        snapshot: ticket.snapshot,
        esCopia,
        anchoCols: estacion.ancho_cols,
        codepage: estacion.codepage,
        urlPublica: `${base}/t/${ticket.token_publico}`,
    })

    const { data: job, error } = await supabase
        .from('print_jobs')
        .insert({
            ticket_id: ticket.id,
            sucursal_id: perfil.sucursal_id,
            es_copia: esCopia,
            payload_escpos: bytes.toString('base64'),
            preview_texto: preview,
            solicitado_por: user.id,
        })
        .select('id')
        .single()

    if (error) throw new Error(error.message)

    revalidatePath(`/clientes/${ticket.cliente_id}`)
    revalidatePath('/tickets')

    return { jobId: job.id }
}
