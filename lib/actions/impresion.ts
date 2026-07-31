'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getPermisos } from '@/lib/utils/permisos'
import { construirTirillaTicket } from '@/lib/escpos/tirilla-ticket'
import { aBytes, selectorCodepage } from '@/lib/escpos/codificacion'
import { CMD, TAMANO } from '@/lib/escpos/comandos'
import { centrar, linea } from '@/lib/escpos/formato'
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
 *
 * Idempotente frente a doble clic / doble tap: si ya hay un trabajo
 * `pendiente` o `reclamado` para este mismo boleto, no se encola otro — se
 * devuelve el existente. Una reimpresión legítima sí se encola, pero solo
 * cuando el trabajo anterior ya terminó (`impreso`, `error` o `cancelado`);
 * nunca puede haber dos impresiones del mismo boleto esperando a la vez, o
 * saldrían dos boletos físicos idénticos del papel.
 */
export async function imprimirTicket(
    ticketId: string,
    opciones?: { esCopia?: boolean },
): Promise<{ jobId: string; nuevo: boolean }> {
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

    // Deduplicación: si ya hay un trabajo esperando (pendiente o reclamado
    // por un agente, aún no confirmado) para este boleto, se reutiliza en
    // vez de encolar otro. No hay ninguna forma de deshacer un corte de
    // papel ya hecho, así que esta comprobación va antes de construir nada.
    const { data: jobExistente } = await supabase
        .from('print_jobs')
        .select('id')
        .eq('ticket_id', ticket.id)
        .in('estado', ['pendiente', 'reclamado'])
        .limit(1)
        .maybeSingle()

    if (jobExistente) {
        return { jobId: jobExistente.id, nuevo: false }
    }

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

    return { jobId: job.id, nuevo: true }
}

/**
 * Encola una página de prueba en una estación concreta.
 * Incluye a propósito una línea con acentos y eñes: es la forma rápida de
 * comprobar que el codepage de esa impresora está bien configurado.
 */
export async function imprimirPaginaDePrueba(
    estacionId: string,
): Promise<{ jobId: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: perfil } = await supabase
        .from('profiles').select('rol').eq('id', user.id).single()
    if (perfil?.rol !== 'admin') {
        throw new Error('Solo un administrador puede imprimir páginas de prueba')
    }

    const { data: estacion } = await supabase
        .from('estaciones_impresion')
        .select('id, sucursal_id, nombre, ancho_cols, codepage')
        .eq('id', estacionId)
        .single()

    if (!estacion) throw new Error('Estación no encontrada')

    const cols = estacion.ancho_cols
    const cp = estacion.codepage
    const lineas = [
        linea(cols),
        centrar('PAGINA DE PRUEBA', cols),
        linea(cols),
        `Estacion: ${estacion.nombre}`,
        `Ancho:    ${cols} columnas`,
        `Codepage: ${cp}`,
        '',
        'Prueba de acentos:',
        'Muñoz Peña García Jiménez Núñez',
        'áéíóú ÁÉÍÓÚ ñÑ üÜ ¿? ¡!',
        '',
        'Si las letras de arriba se ven mal,',
        'cambia el codepage de esta estacion.',
        linea(cols),
        '', '', '',
    ]

    const partes: Buffer[] = [
        CMD.INIT,
        CMD.codepage(selectorCodepage(cp)),
        CMD.interlineado(30),
        CMD.tamano(TAMANO.NORMAL),
    ]
    for (const l of lineas) partes.push(aBytes(l, cp), CMD.SALTO)
    partes.push(CMD.CORTAR)

    const bytes = Buffer.concat(partes)

    // La página de prueba no pertenece a ningún boleto real; se ata al más
    // reciente solo para satisfacer la clave foránea.
    const { data: cualquierTicket } = await supabase
        .from('tickets').select('id').order('created_at', { ascending: false })
        .limit(1).maybeSingle()

    if (!cualquierTicket) {
        throw new Error('Emite al menos un boleto antes de imprimir una prueba')
    }

    const { data: job, error } = await supabase
        .from('print_jobs')
        .insert({
            ticket_id: cualquierTicket.id,
            sucursal_id: estacion.sucursal_id,
            es_copia: true,
            payload_escpos: bytes.toString('base64'),
            preview_texto: lineas.join('\n'),
            solicitado_por: user.id,
        })
        .select('id')
        .single()

    if (error) throw new Error(error.message)

    revalidatePath('/estaciones')
    return { jobId: job.id }
}
