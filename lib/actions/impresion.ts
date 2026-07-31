'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { getPermisos } from '@/lib/utils/permisos'
import { construirTirillaTicket } from '@/lib/escpos/tirilla-ticket'
import { aBytes, selectorCodepage } from '@/lib/escpos/codificacion'
import { CMD, TAMANO } from '@/lib/escpos/comandos'
import { centrar, linea } from '@/lib/escpos/formato'
import type { Ticket, PrintJob, EstadoPrintJob } from '@/lib/types'

/**
 * Cliente admin (service_role), sin sesión de usuario.
 *
 * Se usa solo para la relectura de deduplicación de imprimirTicket: la
 * única policy de SELECT de print_jobs para no-admin es
 * `solicitado_por = auth.uid()`, así que con el cliente de sesión una
 * cajera nunca ve el trabajo que otra cajera acaba de encolar para el
 * mismo boleto. Sin esto, dos cajeras que intentan imprimir el mismo
 * boleto casi a la vez: la primera gana el INSERT, la segunda choca
 * contra uq_print_jobs_ticket_en_vuelo (23505), intenta releer con su
 * propio cliente de sesión, no ve nada (no es suyo), y el mensaje crudo
 * de Postgres sobre la violación de índice único se cuela hasta la
 * pantalla. El cliente admin sí ve cualquier trabajo de la fila,
 * exactamente lo que hace falta para devolver el trabajo real en vez de
 * un error que nadie en caja puede interpretar.
 *
 * No reemplaza ninguna comprobación de permiso: esas siguen todas en el
 * cliente de sesión, más arriba en imprimirTicket.
 */
function crearClienteAdmin() {
    return createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )
}

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
 *
 * La comprobación previa (SELECT) es solo la vía rápida del caso común: no
 * cierra la ventana de carrera por sí sola (dos peticiones casi
 * simultáneas pueden leer ambas "no existe" antes de que cualquiera
 * inserte). Quien la cierra de verdad es el índice único parcial
 * `uq_print_jobs_ticket_en_vuelo` (20260730_05_dedup_print_jobs.sql), igual
 * que `uq_tickets_pago` cierra la carrera de `emitir_ticket`. Si el INSERT
 * choca con ese índice, se trata como éxito: se relee el trabajo que ganó
 * la carrera y se devuelve `nuevo: false`, en vez de dejar escapar un error
 * crudo de Postgres hacia la interfaz.
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
    //
    // Con el cliente admin, no el de sesión: la única policy de SELECT de
    // print_jobs para no-admin es `solicitado_por = auth.uid()`, así que
    // si el trabajo en vuelo lo encoló OTRO usuario (otra cajera, otra
    // pestaña con otra sesión), el cliente de sesión no lo vería nunca y
    // esta comprobación fallaría en silencio, dejando pasar un INSERT que
    // de todos modos va a chocar contra uq_print_jobs_ticket_en_vuelo más
    // abajo. Ver crearClienteAdmin() arriba.
    const clienteAdmin = crearClienteAdmin()
    const { data: jobExistente } = await clienteAdmin
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

    if (error) {
        // 23505 = unique_violation. Otra petición ganó la carrera contra
        // uq_print_jobs_ticket_en_vuelo entre nuestro SELECT y este INSERT
        // (dos clics casi simultáneos, dos pestañas). No es un error real
        // desde el punto de vista del usuario: su boleto ya está en cola,
        // solo que lo encoló la otra petición. Mismo criterio que
        // emitir_ticket en 20260729_04_emitir_ticket.sql (EXCEPTION WHEN
        // unique_violation): se relee el trabajo ganador y se devuelve.
        if (error.code === '23505') {
            // Mismo motivo que la comprobación previa: el trabajo ganador
            // puede ser de otro usuario, así que la relectura también usa
            // el cliente admin. Con el de sesión, este `if` nunca
            // encontraba nada cuando el ganador era otra cajera y el
            // `throw new Error(error.message)` de abajo escupía el 23505
            // crudo de Postgres a la pantalla.
            const { data: jobGanador } = await clienteAdmin
                .from('print_jobs')
                .select('id')
                .eq('ticket_id', ticket.id)
                .in('estado', ['pendiente', 'reclamado'])
                .limit(1)
                .maybeSingle()

            if (jobGanador) {
                return { jobId: jobGanador.id, nuevo: false }
            }
        }
        throw new Error(error.message)
    }

    revalidatePath(`/clientes/${ticket.cliente_id}`)
    revalidatePath('/tickets')

    return { jobId: job.id, nuevo: true }
}

/**
 * Encola una página de prueba en una estación concreta.
 * Incluye a propósito una línea con acentos y eñes: es la forma rápida de
 * comprobar que el codepage de esa impresora está bien configurado.
 *
 * Es un trabajo de servicio, no la impresión de un boleto: se encola con
 * ticket_id NULL y es_prueba = true (ver crearEstacion/print_jobs en
 * 20260730_07_print_jobs_prueba.sql), así que nunca toca tickets.
 * veces_impreso ni ticket_eventos de ningún cliente, y funciona aunque no
 * exista todavía ningún boleto en el sistema — justo el caso de una
 * estación recién instalada, antes de emitir el primer boleto.
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

    // La página de prueba no pertenece a ningún boleto real: ticket_id
    // queda NULL y es_prueba = true la marca como trabajo de servicio
    // (20260730_07_print_jobs_prueba.sql). Antes se colgaba del boleto
    // real más reciente "solo para satisfacer la clave foránea", lo que
    // inflaba veces_impreso y el historial de un cliente ajeno a la
    // prueba, y además bloqueaba su impresión real mientras la prueba
    // seguía pendiente (uq_print_jobs_ticket_en_vuelo). Con ticket_id NULL
    // eso ya no puede pasar, y de paso deja de exigir que exista al menos
    // un boleto — justo lo que hace falta para probar una estación recién
    // instalada, sin ningún cliente cargado todavía.
    const { data: job, error } = await supabase
        .from('print_jobs')
        .insert({
            ticket_id: null,
            es_prueba: true,
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

// ─── Cola de impresión (administración) ────────────────────────
//
// Decisión de permisos de la Tarea 8, para que interfaz, Server Action y
// policy RLS coincidan (defecto que ya se repitió seis veces entre el
// Plan 1 y el 2):
//
//   · getColaImpresion / cancelarTrabajoImpresion / reencolarTrabajoImpresion
//     son EXCLUSIVAS de administradores. La cola completa de una sucursal
//     revela a qué boletos de QUÉ clientes pertenece cada trabajo, cosa que
//     un agente no debe ver en bloque aunque sea de su propia sucursal. La
//     interfaz solo las ofrece en /estaciones (ya redirige a quien no sea
//     admin — app/(dashboard)/estaciones/page.tsx), la Server Action repite
//     la comprobación de rol por si alguien la invoca sin pasar por esa
//     página, y la policy "print_jobs: admin acceso total" (FOR ALL) ya
//     cubre SELECT/UPDATE para admin: no hace falta ninguna policy nueva
//     de UPDATE, porque a un agente nunca se le expone la acción.
//
//   · getEstadoImpresionTickets, en cambio, es de cualquiera que pueda ver
//     el boleto: es el indicador discreto del perfil del cliente, gateado
//     ahí por el permiso `ver_tickets`, no por rol. La policy de SELECT de
//     print_jobs para no-admin ("print_jobs: ver los propios") solo cubría
//     `solicitado_por = auth.uid()`; se amplió en
//     20260730_12_print_jobs_ver_ticket_propio.sql para incluir también los
//     trabajos de un ticket de un cliente propio, aunque los haya encolado
//     otro usuario — si no, la cajera B no vería el estado del boleto que
//     imprimió la cajera A para el mismo cliente.
//
// Nada de esto necesita comprobar permisos dentro de estas funciones más
// allá de "hay sesión": la policy es quien decide fila por fila qué ve
// cada usuario, y exigirAdmin() es quien decide qué usuario puede llamar
// a las tres primeras.

/** print_jobs con lo mínimo para mostrarlo en la cola sin una segunda
 *  consulta: número de boleto (o nada, si es una página de prueba) y
 *  nombre de la estación que lo reclamó. */
export interface PrintJobConDetalle extends PrintJob {
    ticket: { numero_formateado: string } | null
    estacion: { nombre: string } | null
}

async function exigirAdminImpresion(mensaje: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: perfil } = await supabase
        .from('profiles').select('rol').eq('id', user.id).single()

    if (perfil?.rol !== 'admin') throw new Error(mensaje)
    return supabase
}

/** Orden de "lo más urgente primero": error y trabajos aún en curso antes
 *  que los ya terminados, y dentro de cada grupo, el más antiguo primero. */
const ORDEN_ESTADO_PRINT_JOB: Record<EstadoPrintJob, number> = {
    error: 0,
    reclamado: 1,
    pendiente: 2,
    impreso: 3,
    cancelado: 4,
}

/**
 * Cola de impresión de una sucursal (o de todas, sin argumento), para
 * administradores. Solo trae lo que no terminó hace tiempo: los trabajos
 * activos (pendiente/reclamado/error) sin límite de antigüedad, más
 * cualquier trabajo —terminado o no— de las últimas 24 horas. Un trabajo
 * `impreso` de hace un mes no aporta nada aquí; uno de hace 10 minutos sí,
 * como confirmación de que salió bien.
 */
export async function getColaImpresion(sucursalId?: string): Promise<PrintJobConDetalle[]> {
    const supabase = await exigirAdminImpresion('Solo un administrador puede ver la cola de impresión')

    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    let query = supabase
        .from('print_jobs')
        .select('*, ticket:tickets(numero_formateado), estacion:estaciones_impresion(nombre)')
        .or(`estado.in.(pendiente,reclamado,error),created_at.gte.${hace24h}`)

    if (sucursalId) query = query.eq('sucursal_id', sucursalId)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const jobs = (data ?? []) as unknown as PrintJobConDetalle[]

    return jobs.sort((a, b) => {
        const porEstado = ORDEN_ESTADO_PRINT_JOB[a.estado] - ORDEN_ESTADO_PRINT_JOB[b.estado]
        if (porEstado !== 0) return porEstado
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })
}

/** Trae `cliente_id` del boleto de un trabajo, para poder revalidar su
 *  página tras cancelar/reencolar. `null` si es un trabajo de prueba. */
function clienteIdDe(job: { tickets?: { cliente_id: string } | null }): string | null {
    return job.tickets?.cliente_id ?? null
}

/**
 * Cancela un trabajo `pendiente` o `reclamado`, con motivo.
 *
 * Es la salida al problema que motiva esta tarea: mientras un trabajo
 * quede en uno de esos dos estados, el índice único parcial
 * `uq_print_jobs_ticket_en_vuelo` bloquea cualquier otra impresión del
 * mismo boleto. Pasarlo a `cancelado` libera ese índice de inmediato.
 */
export async function cancelarTrabajoImpresion(jobId: string, motivo: string): Promise<void> {
    const supabase = await exigirAdminImpresion('Solo un administrador puede cancelar trabajos de impresión')

    const motivoLimpio = motivo?.trim() ?? ''
    if (motivoLimpio.length < 3) {
        throw new Error('Escribe un motivo de al menos 3 caracteres')
    }

    const { data: job, error: errorLectura } = await supabase
        .from('print_jobs')
        .select('estado, tickets(cliente_id)')
        .eq('id', jobId)
        .single()

    if (errorLectura || !job) throw new Error('Trabajo de impresión no encontrado')
    if (job.estado !== 'pendiente' && job.estado !== 'reclamado') {
        throw new Error('Solo se puede cancelar un trabajo pendiente o en curso')
    }

    const { error } = await supabase
        .from('print_jobs')
        .update({ estado: 'cancelado', error_mensaje: `Cancelado: ${motivoLimpio}` })
        .eq('id', jobId)

    if (error) throw new Error(error.message)

    revalidatePath('/estaciones')
    const clienteId = clienteIdDe(job as unknown as { tickets?: { cliente_id: string } | null })
    if (clienteId) revalidatePath(`/clientes/${clienteId}`)
}

/**
 * Devuelve a la cola un trabajo que terminó en `error`, para reintentar
 * sin emitir otro boleto. Reinicia los intentos: si no, un trabajo que ya
 * agotó `max_intentos` volvería a `pendiente` pero `reclamar_print_jobs`
 * jamás lo entregaría (exige `intentos < max_intentos`), y se quedaría
 * fantasma en la cola para siempre.
 *
 * Si el boleto ya tiene otro trabajo en vuelo, la actualización choca con
 * `uq_print_jobs_ticket_en_vuelo` (23505): se traduce a un mensaje
 * entendible en vez de dejar pasar el error crudo de Postgres.
 */
export async function reencolarTrabajoImpresion(jobId: string): Promise<{ jobId: string }> {
    const supabase = await exigirAdminImpresion('Solo un administrador puede reencolar trabajos de impresión')

    const { data: job, error: errorLectura } = await supabase
        .from('print_jobs')
        .select('estado, tickets(cliente_id)')
        .eq('id', jobId)
        .single()

    if (errorLectura || !job) throw new Error('Trabajo de impresión no encontrado')
    if (job.estado !== 'error') {
        throw new Error('Solo se puede reencolar un trabajo que haya terminado en error')
    }

    const { error } = await supabase
        .from('print_jobs')
        .update({
            estado: 'pendiente',
            intentos: 0,
            claimed_at: null,
            estacion_id: null,
            error_mensaje: null,
        })
        .eq('id', jobId)

    if (error) {
        // 23505 = unique_violation contra uq_print_jobs_ticket_en_vuelo: el
        // boleto ya tiene otro trabajo pendiente/reclamado en este momento
        // (por ejemplo, alguien lo reimprimió mientras este seguía en
        // error). Mismo criterio que imprimirTicket() más arriba: nunca se
        // deja escapar el 23505 crudo hacia la pantalla.
        if (error.code === '23505') {
            throw new Error(
                'Este boleto ya tiene otra impresión en curso. Cancélala antes de reencolar esta.',
            )
        }
        throw new Error(error.message)
    }

    revalidatePath('/estaciones')
    const clienteId = clienteIdDe(job as unknown as { tickets?: { cliente_id: string } | null })
    if (clienteId) revalidatePath(`/clientes/${clienteId}`)

    return { jobId }
}

/**
 * Estado del trabajo de impresión más reciente de cada boleto, para el
 * indicador discreto del perfil del cliente. No exige ningún rol ni
 * permiso aquí: quien no deba ver el trabajo de un boleto ajeno
 * simplemente no lo recibe, por la policy de SELECT de print_jobs (ver
 * nota de permisos más arriba) — la página del cliente ya gatea todo el
 * panel con el permiso `ver_tickets` antes de llamar a esta función.
 */
export async function getEstadoImpresionTickets(
    ticketIds: string[],
): Promise<Map<string, EstadoPrintJob>> {
    const mapa = new Map<string, EstadoPrintJob>()
    if (ticketIds.length === 0) return mapa

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return mapa

    const { data, error } = await supabase
        .from('print_jobs')
        .select('ticket_id, estado, created_at')
        .in('ticket_id', ticketIds)
        .order('created_at', { ascending: false })

    if (error || !data) return mapa

    // Ordenado por created_at DESC: la primera fila que se ve de cada
    // ticket_id es la más reciente, así que basta con no sobrescribir.
    for (const fila of data) {
        if (!fila.ticket_id || mapa.has(fila.ticket_id)) continue
        mapa.set(fila.ticket_id, fila.estado as EstadoPrintJob)
    }
    return mapa
}
