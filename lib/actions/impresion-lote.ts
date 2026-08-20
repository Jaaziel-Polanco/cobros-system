'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { getPermisos } from '@/lib/utils/permisos'
import { construirTirillaTicket } from '@/lib/escpos/tirilla-ticket'
import {
    leerTodasLasFilas, encadenable, comoLote, comoConteo,
} from '@/lib/supabase/paginacion'
import {
    resolverObjetivoDelLote, destinoDelBoleto, type SeleccionLote,
} from '@/lib/utils/lote-impresion'
import type { Ticket } from '@/lib/types'

/**
 * Impresión por lotes de los boletos de un sorteo.
 *
 * ── POR QUÉ ESTÁ EN SU PROPIO ARCHIVO ─────────────────────────
 *
 * `impresion.ts` lleva la impresión de UN boleto, que es la operación de
 * mostrador: la hace una cajera, sobre un cliente suyo, y la RLS por ficha
 * la protege entera. Esto es otra cosa: recorre los boletos de TODAS las
 * carteras, escribe con el cliente admin y puede encolar miles de trabajos
 * de una vez. Mezclar las dos en un archivo invita a copiar el patrón
 * equivocado.
 *
 * ── LO QUE HAY QUE TENER PRESENTE ─────────────────────────────
 *
 *  · **El papel no se deshace.** Encolar 1.300 boletos por error son
 *    1.300 papeles y un par de horas de impresora. Por eso existe
 *    `cancelarPendientesDeSorteo()`: un lote sin freno no es una función
 *    terminada.
 *
 *  · **Casi todos saldrán marcados COPIA.** Un boleto se imprime al
 *    emitirse, así que su `veces_impreso` ya es 1. Reimprimir el sorteo
 *    entero produce papeles con `***** COPIA *****`, que es la verdad y
 *    hay que anunciarla antes, no descubrirla en el rollo.
 *
 *  · **Los ids vienen del navegador.** Nunca se usan tal cual: se cruzan
 *    contra los boletos que de verdad pertenecen a este sorteo. Sin ese
 *    cruce, y como aquí se escribe con el cliente admin (que no pasa por
 *    RLS), bastaría con inventar ids en la petición para imprimir boletos
 *    de cualquier cliente del sistema.
 */

/** Cuántos trabajos se insertan por petición. Cada payload pesa 1-2 KB. */
const TAMANO_INSERCION = 100

function crearClienteAdmin() {
    return createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )
}

export interface BoletoDelLote {
    id: string
    numero_formateado: string
    cliente: string
    /** 0 = nunca impreso. Cualquier otro valor sale marcado como copia. */
    veces_impreso: number
    anulado: boolean
    /** Ya tiene un trabajo pendiente o reclamado: volver a pedirlo no hace nada. */
    enCola: boolean
}

export interface ResultadoLote {
    encolados: number
    /** Ya tenían un trabajo en vuelo. No es un error: no se duplica. */
    yaEnCola: number
    omitidosAnulados: number
    /** Cuántos de los encolados llevan la marca `***** COPIA *****`. */
    copias: number
    /** Fallos por boleto. Un lote parcial se informa, no se lanza. */
    errores: string[]
}

/**
 * Permisos del operador de lotes.
 *
 * Dos, los mismos que exige la interfaz:
 *
 *  · `ver_sorteos`, porque esto lista boletos de todas las carteras; y
 *  · `imprimir_ticket`, porque el resultado es papel.
 *
 * Aquí no hay una tercera pata de RLS que valga como red: la escritura va
 * con el cliente admin a propósito (la policy de INSERT de `print_jobs`
 * exige que el boleto sea del agente, y un lote de sorteo cruza carteras
 * por definición). Es decir: **estas dos comprobaciones son la única
 * protección**. Si se relaja una, no hay nada detrás.
 */
async function exigirOperadorDeLote() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('No autenticado')

    const { data: perfil } = await supabase
        .from('profiles')
        .select('id, rol, permisos, sucursal_id')
        .eq('id', user.id)
        .single()

    if (!perfil) throw new Error('Perfil no encontrado')

    const permisos = getPermisos(perfil)
    if (!permisos.ver_sorteos) {
        throw new Error('No tienes permiso para ver sorteos')
    }
    if (!permisos.imprimir_ticket) {
        throw new Error('No tienes permiso para imprimir boletos')
    }

    return { supabase, user, perfil }
}

/**
 * Ids de los boletos que de verdad pertenecen a este sorteo.
 *
 * Se lee con `leerTodasLasFilas` y no con una consulta suelta porque
 * PostgREST corta en 1.000 filas sin decirlo. Con un `.select()` normal, un
 * sorteo de 1.300 boletos daría un "todos" de 1.000: nadie vería un error,
 * y los 300 que faltan no se imprimirían jamás. Es el mismo defecto que ya
 * amañó el pool del sorteo una vez.
 */
async function idsDelSorteo(
    admin: ReturnType<typeof crearClienteAdmin>,
    sorteoId: string,
): Promise<Set<string>> {
    const filas = await leerTodasLasFilas<{ id: string }>({
        etiqueta: 'los boletos del sorteo',
        clave: 'id',
        lote: (cursor, limite) => {
            const base = encadenable(admin.from('tickets').select('id'))
                .eq('sorteo_id', sorteoId)
            return comoLote<{ id: string }>(
                (cursor ? base.gt('id', cursor) : base).order('id').limit(limite),
            )
        },
        contar: () => comoConteo(
            encadenable(admin.from('tickets').select('id', { count: 'exact', head: true }))
                .eq('sorteo_id', sorteoId),
        ),
    })
    return new Set(filas.map(f => f.id))
}

/** Boletos con un trabajo pendiente o reclamado, de entre los que se pasen. */
async function enVuelo(
    admin: ReturnType<typeof crearClienteAdmin>,
    sorteoId: string,
): Promise<Set<string>> {
    // Se filtra por sorteo con un `inner join` implícito en vez de por una
    // lista de ids: pasar 1.300 uuid en la query string revienta el límite
    // de longitud de URL mucho antes de llegar al servidor.
    const filas = await leerTodasLasFilas<{ id: string; ticket_id: string }>({
        etiqueta: 'los trabajos de impresión en vuelo',
        clave: 'id',
        lote: (cursor, limite) => {
            const base = encadenable(
                admin.from('print_jobs').select('id, ticket_id, tickets!inner(sorteo_id)'),
            )
                .eq('tickets.sorteo_id', sorteoId)
                .in('estado', ['pendiente', 'reclamado'])
            return comoLote<{ id: string; ticket_id: string }>(
                (cursor ? base.gt('id', cursor) : base).order('id').limit(limite),
            )
        },
        contar: () => comoConteo(
            encadenable(
                admin.from('print_jobs')
                    .select('id, tickets!inner(sorteo_id)', { count: 'exact', head: true }),
            )
                .eq('tickets.sorteo_id', sorteoId)
                .in('estado', ['pendiente', 'reclamado']),
        ),
    })
    return new Set(filas.map(f => f.ticket_id))
}

/**
 * Lista los boletos de un sorteo para elegir cuáles imprimir.
 *
 * Devuelve la lista COMPLETA, no una página: la casilla «seleccionar todos»
 * tiene que poder decir un número que sea verdad.
 */
export async function getBoletosDeSorteo(sorteoId: string): Promise<BoletoDelLote[]> {
    await exigirOperadorDeLote()

    const admin = crearClienteAdmin()

    interface Fila {
        id: string
        numero_formateado: string
        veces_impreso: number
        estado: string
        numero: number
        clientes: { nombre: string | null; apellido: string | null } | null
    }

    const filas = await leerTodasLasFilas<Fila>({
        etiqueta: 'los boletos del sorteo',
        clave: 'id',
        lote: (cursor, limite) => {
            const base = encadenable(
                admin.from('tickets').select(
                    'id, numero, numero_formateado, veces_impreso, estado, clientes(nombre, apellido)',
                ),
            ).eq('sorteo_id', sorteoId)
            return comoLote<Fila>(
                (cursor ? base.gt('id', cursor) : base).order('id').limit(limite),
            )
        },
        contar: () => comoConteo(
            encadenable(admin.from('tickets').select('id', { count: 'exact', head: true }))
                .eq('sorteo_id', sorteoId),
        ),
    })

    const cola = await enVuelo(admin, sorteoId)

    return filas
        // Por número, que es como los busca una persona. La lectura viene
        // ordenada por `id` porque así lo exige la paginación por clave.
        .sort((a, b) => a.numero - b.numero)
        .map(f => ({
            id: f.id,
            numero_formateado: f.numero_formateado,
            cliente: [f.clientes?.nombre, f.clientes?.apellido].filter(Boolean).join(' ')
                || 'Cliente eliminado',
            veces_impreso: f.veces_impreso,
            anulado: f.estado === 'anulado',
            enCola: cola.has(f.id),
        }))
}

/**
 * Encola los boletos indicados de un sorteo.
 *
 * `modo: 'todos'` no recibe ids: los resuelve el servidor. Es a propósito
 * — así «todos» significa todos de verdad, y no «todos los que el navegador
 * tenía cargados en ese momento».
 */
export async function imprimirLoteDeSorteo(
    sorteoId: string,
    seleccion: SeleccionLote,
): Promise<ResultadoLote> {
    const { user, perfil } = await exigirOperadorDeLote()

    if (!perfil.sucursal_id) {
        throw new Error('Tu usuario no tiene sucursal asignada. Pídeselo a un administrador.')
    }

    const supabase = await createClient()
    const { data: estacion } = await supabase
        .from('estaciones_impresion')
        .select('ancho_cols, codepage')
        .eq('sucursal_id', perfil.sucursal_id)
        .eq('activo', true)
        .maybeSingle()

    if (!estacion) {
        throw new Error('Tu sucursal no tiene una estación de impresión activa')
    }

    const admin = crearClienteAdmin()
    const delSorteo = await idsDelSorteo(admin, sorteoId)

    // El cruce que impide imprimir boletos ajenos vive en `lib/utils` y
    // está probado ahí: aquí se escribe sin RLS, así que un id inventado en
    // la petición llegaría hasta la impresora si no se filtrara.
    const objetivo = resolverObjetivoDelLote(delSorteo, seleccion)

    if (objetivo.length === 0) {
        return { encolados: 0, yaEnCola: 0, omitidosAnulados: 0, copias: 0, errores: [] }
    }

    const cola = await enVuelo(admin, sorteoId)

    const resultado: ResultadoLote = {
        encolados: 0, yaEnCola: 0, omitidosAnulados: 0, copias: 0, errores: [],
    }

    const base = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000'
    const objetivoSet = new Set(objetivo)
    const porInsertar: { fila: Record<string, unknown>; numero: string }[] = []

    // Los boletos se releen enteros (hacen falta `snapshot` y
    // `token_publico` para construir la tirilla) en lotes, no de uno en uno.
    for (let i = 0; i < objetivo.length; i += TAMANO_INSERCION) {
        const trozo = objetivo.slice(i, i + TAMANO_INSERCION)
        const { data, error } = await admin
            .from('tickets').select('*').in('id', trozo)

        if (error) throw new Error(`No se pudieron leer los boletos: ${error.message}`)

        for (const fila of (data ?? []) as Ticket[]) {
            if (!objetivoSet.has(fila.id)) continue

            const destino = destinoDelBoleto({
                anulado: fila.estado === 'anulado',
                enCola: cola.has(fila.id),
                vecesImpreso: fila.veces_impreso,
            })

            if (destino === 'anulado') {
                resultado.omitidosAnulados++
                continue
            }
            if (destino === 'ya-en-cola') {
                resultado.yaEnCola++
                continue
            }

            const esCopia = destino === 'copia'
            if (esCopia) resultado.copias++

            const { bytes, preview } = construirTirillaTicket({
                numeroFormateado: fila.numero_formateado,
                snapshot: fila.snapshot,
                esCopia,
                anchoCols: estacion.ancho_cols,
                codepage: estacion.codepage,
                urlPublica: `${base}/t/${fila.token_publico}`,
            })

            porInsertar.push({
                numero: fila.numero_formateado,
                fila: {
                    ticket_id: fila.id,
                    sucursal_id: perfil.sucursal_id,
                    es_copia: esCopia,
                    payload_escpos: bytes.toString('base64'),
                    preview_texto: preview,
                    solicitado_por: user.id,
                },
            })
        }
    }

    for (let i = 0; i < porInsertar.length; i += TAMANO_INSERCION) {
        const trozo = porInsertar.slice(i, i + TAMANO_INSERCION)
        const { error } = await admin.from('print_jobs').insert(trozo.map(t => t.fila))

        if (!error) {
            resultado.encolados += trozo.length
            continue
        }

        // Un solo choque contra `uq_print_jobs_ticket_en_vuelo` tumba la
        // inserción entera del trozo, incluidos los boletos que no tenían
        // ningún problema. Se reintenta fila a fila para no perder 99
        // boletos buenos por 1 que ya estaba en cola.
        for (const item of trozo) {
            const { error: errorFila } = await admin.from('print_jobs').insert(item.fila)
            if (!errorFila) {
                resultado.encolados++
            } else if (errorFila.code === '23505') {
                resultado.yaEnCola++
                if (item.fila.es_copia) resultado.copias--
            } else {
                resultado.copias -= item.fila.es_copia ? 1 : 0
                resultado.errores.push(`${item.numero}: ${errorFila.message}`)
            }
        }
    }

    revalidatePath(`/sorteos/${sorteoId}`)
    revalidatePath('/estaciones')
    revalidatePath('/tickets')

    return resultado
}

/**
 * Cancela los trabajos de este sorteo que todavía no ha tomado ningún
 * agente. Es el freno del lote.
 *
 * Solo toca los `pendiente`. Un `reclamado` ya está en manos del agente y
 * puede tener el papel saliendo ahora mismo: cancelarlo en la base no
 * detiene la impresora y dejaría el sistema mintiendo sobre lo que pasó.
 *
 * Para parar de verdad una tanda que ya está saliendo, hay que pausar el
 * agente desde su página local (http://127.0.0.1:9110 en la PC de la caja)
 * y luego cancelar aquí lo que quede pendiente.
 */
export async function cancelarPendientesDeSorteo(
    sorteoId: string,
    motivo: string,
): Promise<{ cancelados: number }> {
    const { user } = await exigirOperadorDeLote()

    const razon = motivo.trim()
    if (razon.length < 3) throw new Error('Escribe un motivo de al menos 3 caracteres')

    const admin = crearClienteAdmin()

    const pendientes = await leerTodasLasFilas<{ id: string }>({
        etiqueta: 'los trabajos pendientes del sorteo',
        clave: 'id',
        lote: (cursor, limite) => {
            const base = encadenable(
                admin.from('print_jobs').select('id, tickets!inner(sorteo_id)'),
            )
                .eq('tickets.sorteo_id', sorteoId)
                .eq('estado', 'pendiente')
            return comoLote<{ id: string }>(
                (cursor ? base.gt('id', cursor) : base).order('id').limit(limite),
            )
        },
        contar: () => comoConteo(
            encadenable(
                admin.from('print_jobs')
                    .select('id, tickets!inner(sorteo_id)', { count: 'exact', head: true }),
            )
                .eq('tickets.sorteo_id', sorteoId)
                .eq('estado', 'pendiente'),
        ),
    })

    let cancelados = 0
    for (let i = 0; i < pendientes.length; i += TAMANO_INSERCION) {
        const trozo = pendientes.slice(i, i + TAMANO_INSERCION).map(p => p.id)

        // `.eq('estado','pendiente')` otra vez, no solo en la lectura: entre
        // el SELECT y este UPDATE un agente puede haber reclamado el
        // trabajo. Sin este filtro se cancelaría algo que ya está saliendo
        // por la impresora.
        const { data, error } = await admin
            .from('print_jobs')
            .update({
                estado: 'cancelado',
                error_mensaje: `Lote cancelado por ${user.id}: ${razon}`,
            })
            .in('id', trozo)
            .eq('estado', 'pendiente')
            .select('id')

        if (error) throw new Error(`No se pudo cancelar el lote: ${error.message}`)
        cancelados += data?.length ?? 0
    }

    revalidatePath(`/sorteos/${sorteoId}`)
    revalidatePath('/estaciones')

    return { cancelados }
}
