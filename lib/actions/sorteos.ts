'use server'

import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getPermisos } from '@/lib/utils/permisos'
import { rangoRDaUTC } from '@/lib/utils/fecha-rd'
import {
    seleccionarGanadores,
    calcularPoolHash,
    ALGORITMO_SORTEO,
    type TicketParticipante,
} from '@/lib/utils/sorteo'
import {
    SorteoSchema, EjecutarSorteoSchema,
    type SorteoFormData, type EjecutarSorteoFormData,
} from '@/lib/validations/sorteos'
import type { Sorteo, EstadoSorteo } from '@/lib/types'

async function contexto() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: perfil } = await supabase
        .from('profiles').select('id, rol, permisos').eq('id', user.id).single()
    if (!perfil) throw new Error('Perfil no encontrado')

    return { supabase, user, permisos: getPermisos(perfil) }
}

async function exigirPermisoSorteo() {
    const ctx = await contexto()
    if (!ctx.permisos.realizar_sorteo) {
        throw new Error('No tienes permiso para gestionar sorteos')
    }
    return ctx
}

// ─── CRUD ─────────────────────────────────────────────────────

export async function getSorteos(): Promise<Sorteo[]> {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('sorteos').select('*').order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as Sorteo[]
}

export async function getSorteoDetalle(id: string) {
    const supabase = await createClient()

    const { data: sorteo, error } = await supabase
        .from('sorteos').select('*').eq('id', id).single()
    if (error || !sorteo) throw new Error('Sorteo no encontrado')

    const { data: ejecuciones } = await supabase
        .from('sorteo_ejecuciones')
        .select('*, ejecutor:profiles(id, full_name)')
        .eq('sorteo_id', id)
        .order('ejecutado_at', { ascending: false })

    const vigente = ejecuciones?.find(e => e.vigente) ?? null

    const ganadores = vigente
        ? (await supabase
            .from('sorteo_ganadores')
            .select('*, ticket:tickets(id, numero_formateado, estado), cliente:clientes(id, nombre, apellido, telefono)')
            .eq('ejecucion_id', vigente.id)
            .order('posicion')
          ).data ?? []
        : []

    const { count: totalBoletos } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('sorteo_id', id)
        .eq('estado', 'valido')

    return {
        sorteo: sorteo as Sorteo,
        ejecuciones: ejecuciones ?? [],
        ejecucionVigente: vigente,
        ganadores,
        totalBoletos: totalBoletos ?? 0,
    }
}

export async function crearSorteo(input: SorteoFormData): Promise<Sorteo> {
    const { supabase, user } = await exigirPermisoSorteo()
    const validado = SorteoSchema.parse(input)

    const { data, error } = await supabase
        .from('sorteos')
        .insert({ ...validado, creado_por: user.id })
        .select()
        .single()

    if (error) {
        if (error.code === '23505') {
            throw new Error('Ya existe un sorteo con ese prefijo')
        }
        throw new Error(error.message)
    }

    revalidatePath('/sorteos')
    return data as Sorteo
}

export async function actualizarSorteo(
    id: string, input: SorteoFormData,
): Promise<void> {
    const { supabase } = await exigirPermisoSorteo()
    const validado = SorteoSchema.parse(input)

    const { error } = await supabase.from('sorteos').update(validado).eq('id', id)
    if (error) throw new Error(error.message)

    revalidatePath('/sorteos')
    revalidatePath(`/sorteos/${id}`)
}

/** Activa un sorteo. Solo puede haber uno activo: el anterior pasa a borrador. */
export async function activarSorteo(id: string): Promise<void> {
    const { supabase } = await exigirPermisoSorteo()

    const { data: sorteo } = await supabase
        .from('sorteos').select('estado').eq('id', id).single()

    if (sorteo?.estado === 'cerrado') {
        throw new Error('Un sorteo cerrado no se puede reactivar')
    }

    // El índice único uq_sorteo_activo impide dos activos a la vez
    await supabase
        .from('sorteos').update({ estado: 'borrador' })
        .eq('estado', 'activo').neq('id', id)

    const { error } = await supabase
        .from('sorteos').update({ estado: 'activo' }).eq('id', id)

    if (error) throw new Error(error.message)

    revalidatePath('/sorteos')
    revalidatePath(`/sorteos/${id}`)
}

/** Sella el sorteo: no admite más ejecuciones ni boletos nuevos. */
export async function cerrarSorteo(id: string): Promise<void> {
    const { supabase } = await exigirPermisoSorteo()

    const { error } = await supabase
        .from('sorteos').update({ estado: 'cerrado' }).eq('id', id)

    if (error) throw new Error(error.message)

    revalidatePath('/sorteos')
    revalidatePath(`/sorteos/${id}`)
}

// ─── POOL Y EJECUCIÓN ─────────────────────────────────────────

/** Lee los boletos que participarían, en orden canónico por número. */
async function leerPool(
    supabase: Awaited<ReturnType<typeof createClient>>,
    sorteoId: string,
    desde: string,
    hasta: string,
): Promise<TicketParticipante[]> {
    const { desdeISO, hastaISO } = rangoRDaUTC(desde, hasta)

    const { data, error } = await supabase
        .from('tickets')
        .select('id, numero, cliente_id')
        .eq('sorteo_id', sorteoId)
        .eq('estado', 'valido')
        .gte('emitido_at', desdeISO)
        .lte('emitido_at', hastaISO)
        .order('numero')

    if (error) throw new Error(error.message)
    return (data ?? []) as TicketParticipante[]
}

/** Cuántos boletos y cuántos clientes distintos participarían. */
export async function previsualizarPool(
    sorteoId: string, desde: string, hasta: string,
): Promise<{ boletos: number; clientes: number }> {
    const supabase = await createClient()
    const pool = await leerPool(supabase, sorteoId, desde, hasta)

    return {
        boletos: pool.length,
        clientes: new Set(pool.map(t => t.cliente_id)).size,
    }
}

/**
 * Resultado de ejecutar un sorteo.
 *
 * `estadoSorteo`, `transicionadoAActivo` y `motivoNoTransicion` vienen tal
 * cual del RPC `guardar_ejecucion_sorteo` (ver
 * supabase/migrations/20260730_13_guardar_ejecucion_sorteo_transicion.sql):
 * la ejecución puede haberse guardado con éxito (ganadores incluidos) y aun
 * así el sorteo seguir en 'borrador' porque ya había otro sorteo activo. Sin
 * propagar esto, la interfaz (Tarea 4) no tendría forma de distinguir ese
 * caso de "todavía no se ha ejecutado nada".
 */
export interface ResultadoEjecucionSorteo {
    ejecucionId: string
    ganadoresInsuficientes: boolean
    poolCount: number
    estadoSorteo: EstadoSorteo
    transicionadoAActivo: boolean
    motivoNoTransicion: string | null
}

/**
 * Ejecuta el sorteo.
 *
 * El barajado se calcula aquí, en TypeScript, con la función pura probada en
 * lib/utils/sorteo.ts. El RPC solo persiste el resultado, de forma atómica.
 */
export async function ejecutarSorteo(
    input: EjecutarSorteoFormData,
): Promise<ResultadoEjecucionSorteo> {
    const { supabase, user } = await exigirPermisoSorteo()
    const validado = EjecutarSorteoSchema.parse(input)

    const { data: sorteo } = await supabase
        .from('sorteos').select('*').eq('id', validado.sorteo_id).single()
    if (!sorteo) throw new Error('Sorteo no encontrado')
    if (sorteo.estado === 'cerrado') {
        throw new Error('El sorteo está cerrado y no admite nuevas ejecuciones')
    }

    const pool = await leerPool(
        supabase, validado.sorteo_id, validado.rango_desde, validado.rango_hasta,
    )

    if (pool.length === 0) {
        throw new Error('No hay boletos válidos en ese rango de fechas')
    }

    // Semilla aleatoria criptográfica si el usuario no fija una propia.
    // Se guarda tal cual, y es lo que hace el sorteo reproducible.
    const semilla = validado.semilla?.trim() || crypto.randomUUID()

    const resultado = seleccionarGanadores(pool, validado.cantidad_ganadores, semilla)

    const ganadores = resultado.ganadores.map((t, i) => ({
        ticket_id: t.id,
        cliente_id: t.cliente_id,
        posicion: i + 1,
        premio: sorteo.premio ?? null,
        snapshot: { numero: t.numero, elegido_en_posicion: i + 1 },
    }))

    const { data, error } = await supabase.rpc('guardar_ejecucion_sorteo', {
        p_sorteo_id: validado.sorteo_id,
        p_rango_desde: validado.rango_desde,
        p_rango_hasta: validado.rango_hasta,
        p_cantidad: validado.cantidad_ganadores,
        p_semilla: semilla,
        p_algoritmo: ALGORITMO_SORTEO,
        p_pool_hash: resultado.poolHash,
        p_pool_count: resultado.poolCount,
        p_participantes: resultado.orden.map(o => ({
            ticket_id: o.ticketId, orden: o.orden,
        })),
        p_ganadores: ganadores,
        p_ejecutado_por: user.id,
    })

    if (error) throw new Error(error.message)
    if (!data?.ok) throw new Error(data?.error ?? 'No se pudo guardar la ejecución')

    revalidatePath('/sorteos')
    revalidatePath(`/sorteos/${validado.sorteo_id}`)

    return {
        ejecucionId: data.ejecucion_id as string,
        ganadoresInsuficientes: resultado.ganadoresInsuficientes,
        poolCount: resultado.poolCount,
        estadoSorteo: (data.estado_sorteo as EstadoSorteo) ?? sorteo.estado,
        transicionadoAActivo: Boolean(data.transicionado_a_activo),
        motivoNoTransicion: (data.motivo_no_transicion as string | null) ?? null,
    }
}

// ─── VERIFICACIÓN ─────────────────────────────────────────────

export interface ResultadoVerificacion {
    coincide: boolean
    algoritmo: string
    semilla: string
    poolCount: number
    poolIntacto: boolean
    mensaje: string
    ganadoresEsperados: string[]
    ganadoresGuardados: string[]
}

/**
 * Reconstruye el sorteo desde la semilla y los participantes almacenados y
 * comprueba que salgan los mismos ganadores.
 *
 * También compara el hash del pool contra el conjunto de participantes
 * guardado: si alguien anuló un boleto después del sorteo, se detecta.
 */
export async function verificarEjecucion(
    ejecucionId: string,
): Promise<ResultadoVerificacion> {
    const { supabase } = await contexto()

    const { data: ejecucion, error } = await supabase
        .from('sorteo_ejecuciones').select('*').eq('id', ejecucionId).single()

    if (error || !ejecucion) throw new Error('Ejecución no encontrada')

    if (ejecucion.algoritmo !== ALGORITMO_SORTEO) {
        return {
            coincide: false,
            algoritmo: ejecucion.algoritmo,
            semilla: ejecucion.semilla,
            poolCount: ejecucion.pool_count,
            poolIntacto: false,
            mensaje: `Esta ejecución usó el algoritmo "${ejecucion.algoritmo}" y el sistema actual usa "${ALGORITMO_SORTEO}". No se puede verificar automáticamente.`,
            ganadoresEsperados: [],
            ganadoresGuardados: [],
        }
    }

    const { data: participantes } = await supabase
        .from('sorteo_participantes')
        .select('ticket_id, ticket:tickets(id, numero, cliente_id)')
        .eq('ejecucion_id', ejecucionId)

    const pool: TicketParticipante[] = (participantes ?? [])
        .map(p => p.ticket as unknown as TicketParticipante)
        .filter(Boolean)

    const { data: guardados } = await supabase
        .from('sorteo_ganadores')
        .select('ticket_id, posicion, ticket:tickets(numero_formateado)')
        .eq('ejecucion_id', ejecucionId)
        .order('posicion')

    const recalculado = seleccionarGanadores(
        pool, ejecucion.cantidad_ganadores, ejecucion.semilla,
    )

    const esperados = recalculado.ganadores.map(g => g.id)
    const almacenados = (guardados ?? []).map(g => g.ticket_id)

    const coincide =
        esperados.length === almacenados.length &&
        esperados.every((id, i) => id === almacenados[i])

    const poolIntacto = calcularPoolHash(pool.map(t => t.id)) === ejecucion.pool_hash

    let mensaje: string
    if (coincide && poolIntacto) {
        mensaje = 'Verificado. Al repetir el sorteo con la misma semilla salen exactamente los mismos ganadores.'
    } else if (coincide && !poolIntacto) {
        mensaje = 'Los ganadores coinciden, pero la lista de participantes guardada ya no cuadra con la huella original. Es probable que algún boleto se haya eliminado de la base de datos.'
    } else {
        mensaje = 'Los ganadores NO coinciden con lo que produce el algoritmo a partir de la semilla guardada. Revisa esta ejecución.'
    }

    return {
        coincide,
        algoritmo: ejecucion.algoritmo,
        semilla: ejecucion.semilla,
        poolCount: ejecucion.pool_count,
        poolIntacto,
        mensaje,
        ganadoresEsperados: esperados,
        ganadoresGuardados: almacenados,
    }
}

// ─── PREMIOS ──────────────────────────────────────────────────

export async function marcarPremioEntregado(
    ganadorId: string, entregado: boolean, notas?: string,
): Promise<void> {
    const { supabase } = await exigirPermisoSorteo()

    const { data: ganador } = await supabase
        .from('sorteo_ganadores')
        .select('ejecucion_id, ejecucion:sorteo_ejecuciones(sorteo_id)')
        .eq('id', ganadorId)
        .single()

    const { error } = await supabase
        .from('sorteo_ganadores')
        .update({
            entregado,
            entregado_at: entregado ? new Date().toISOString() : null,
            notas: notas?.trim() || null,
        })
        .eq('id', ganadorId)

    if (error) throw new Error(error.message)

    const sorteoId = (ganador?.ejecucion as unknown as { sorteo_id: string } | null)?.sorteo_id
    if (sorteoId) revalidatePath(`/sorteos/${sorteoId}`)
}
