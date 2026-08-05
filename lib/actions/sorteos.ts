'use server'

import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { getPermisos } from '@/lib/utils/permisos'
import { rangoRDaUTC } from '@/lib/utils/fecha-rd'
import {
    leerTodasLasFilas, encadenable, comoLote, comoConteo,
    type ConsultaEncadenable,
} from '@/lib/supabase/paginacion'
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

/**
 * Exige poder gestionar sorteos.
 *
 * Comprueba TAMBIÉN `ver_sorteos`, y no por celo: todas las policies de
 * SELECT de `sorteos`/`sorteo_*` (20260729_02) dependen de `ver_sorteos`, y
 * Postgres exige que una fila sea visible por SELECT para poder
 * actualizarla. Un perfil con `realizar_sorteo` pero sin `ver_sorteos` (una
 * combinación que /usuarios permite marcar, porque los dos permisos son
 * casillas independientes) no obtenía un "no tienes permiso": obtenía
 * "Sorteo no encontrado" al crear, o un UPDATE de 0 filas sin ningún error
 * al marcar un premio como entregado. Mejor un mensaje que diga la verdad.
 */
async function exigirPermisoSorteo() {
    const ctx = await contexto()
    if (!ctx.permisos.realizar_sorteo) {
        throw new Error('No tienes permiso para gestionar sorteos')
    }
    if (!ctx.permisos.ver_sorteos) {
        throw new Error(
            'Para gestionar sorteos hace falta también el permiso de ver sorteos',
        )
    }
    return ctx
}

async function exigirVerSorteos() {
    const ctx = await contexto()
    if (!ctx.permisos.ver_sorteos) {
        throw new Error('No tienes permiso para ver sorteos')
    }
    return ctx
}

/**
 * Cliente service_role, sin sesión, para las lecturas TRANSVERSALES del
 * módulo de sorteos. Mismo patrón (y mismas cautelas) que el
 * `crearClienteAdmin()` de lib/actions/tickets.ts.
 *
 * POR QUÉ HACE FALTA (verificado contra producción impersonando a un agente
 * real con `SET LOCAL ROLE authenticated` + `request.jwt.claims`, sobre un
 * sorteo ZZTEST con 4 boletos de 2 clientes de agentes DISTINTOS):
 *
 * un sorteo es transversal a toda la cartera, pero las policies de RLS de
 * `tickets`, `clientes` y `profiles` son POR AGENTE. Leyendo con el cliente
 * de sesión, un agente con `ver_sorteos`/`realizar_sorteo` obtenía:
 *
 *   - el pool del sorteo: 2 de 4 boletos    → el barajado se hacía sobre
 *     MEDIA cartera y los ganadores salían solo de sus propios clientes,
 *     sin ningún error visible. Es el fallo más grave del módulo: un sorteo
 *     silenciosamente amañado por construcción.
 *   - los participantes al re-verificar: 2 de 4 → "Verificar ejecución"
 *     habría dicho que los ganadores NO coinciden en un sorteo perfectamente
 *     limpio: una acusación falsa de fraude.
 *   - el cliente del ganador: 1 de 2, y su boleto: 1 de 2 → nombre, teléfono
 *     y número de boleto en blanco para los ganadores de otros agentes (y la
 *     advertencia de "boleto anulado" nunca se mostraría para ellos).
 *   - quién ejecutó el sorteo: 0 de 1 → el panel de auditoría oculta al
 *     auditor (`profiles` solo deja a un agente leer su propia fila).
 *   - el contador de boletos válidos del sorteo: 2 de 4.
 *
 * Ninguna de estas lecturas puede resolverse ampliando RLS sin abrir la
 * cartera entera (es exactamente el callejón sin salida que documentan las
 * migraciones 20260730_14/15/16). Como el permiso ya se comprueba de forma
 * explícita en cada función de este archivo ANTES de usar este cliente, la
 * puerta de control sigue existiendo: solo cambia de sitio, de la policy a
 * la Server Action. Lo que se lee aquí es lo mínimo del caso de uso: ids,
 * números, nombre y teléfono del ganador. Nunca `snapshot` (que lleva la
 * cédula) ni `token_publico`.
 */
function crearClienteAdmin() {
    return createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )
}

type ClienteAdmin = ReturnType<typeof crearClienteAdmin>

// ─── CRUD ─────────────────────────────────────────────────────

export async function getSorteos(): Promise<Sorteo[]> {
    // La tabla `sorteos` sí es visible entera con `ver_sorteos` (policy
    // "sorteos: lectura con permiso"), así que aquí basta el cliente de
    // sesión. La comprobación explícita duplica a propósito lo que ya hace
    // la policy: la página no debe ser la única puerta.
    const { supabase } = await exigirVerSorteos()
    const { data, error } = await supabase
        .from('sorteos').select('*').order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as Sorteo[]
}

export interface EjecucionConEjecutor {
    id: string
    sorteo_id: string
    rango_desde: string
    rango_hasta: string
    cantidad_ganadores: number
    semilla: string
    algoritmo: string
    pool_count: number
    pool_hash: string
    vigente: boolean
    ejecutado_por: string | null
    ejecutado_at: string
    notas: string | null
    ejecutor: { id: string; full_name: string } | null
}

export interface GanadorDetalle {
    id: string
    ejecucion_id: string
    ticket_id: string
    cliente_id: string
    posicion: number
    premio: string | null
    entregado: boolean
    entregado_at: string | null
    notas: string | null
    snapshot: Record<string, unknown>
    ticket: { id: string; numero_formateado: string; estado: string } | null
    cliente: { id: string; nombre: string; apellido: string; telefono: string | null } | null
}

export async function getSorteoDetalle(id: string) {
    const { supabase } = await exigirVerSorteos()

    const { data: sorteo, error } = await supabase
        .from('sorteos').select('*').eq('id', id).single()
    if (error || !sorteo) throw new Error('Sorteo no encontrado')

    // A partir de aquí, cliente admin: ver el comentario de crearClienteAdmin().
    // Con el cliente de sesión, un agente veía el ejecutor en blanco, la mitad
    // de los ganadores sin nombre ni número de boleto, y un contador de
    // boletos que solo cuenta los de sus propios clientes.
    const admin = crearClienteAdmin()

    const { data: ejecuciones } = await admin
        .from('sorteo_ejecuciones')
        .select('*, ejecutor:profiles(id, full_name)')
        .eq('sorteo_id', id)
        .order('ejecutado_at', { ascending: false })

    const lista = (ejecuciones ?? []) as unknown as EjecucionConEjecutor[]
    const vigente = lista.find(e => e.vigente) ?? null

    const ganadores = vigente
        ? ((await admin
            .from('sorteo_ganadores')
            .select('*, ticket:tickets(id, numero_formateado, estado), cliente:clientes(id, nombre, apellido, telefono)')
            .eq('ejecucion_id', vigente.id)
            .order('posicion')
          ).data ?? []) as unknown as GanadorDetalle[]
        : []

    const { count: totalBoletos } = await admin
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('sorteo_id', id)
        .eq('estado', 'valido')

    return {
        sorteo: sorteo as Sorteo,
        ejecuciones: lista,
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

/**
 * Edita un sorteo.
 *
 * Las dos reglas que se comprueban aquí vivían SOLO en el formulario
 * (`sorteo-form-dialog.tsx`: el `disabled` del campo de prefijo y el hecho de
 * que el botón Editar no se pinte para un sorteo cerrado). Un `disabled` no
 * protege nada: esta función es una Server Action, es decir un endpoint HTTP,
 * y acepta el payload que le manden. Tampoco hay defensa en la base (el único
 * trigger sobre `sorteos` es `trg_sorteos_updated_at`).
 *
 *  1. **Prefijo congelado en cuanto se ha emitido un boleto**
 *     (`ultimo_numero > 0`). `numero_formateado` (`NAV26-000123`) se compone
 *     con el prefijo en el momento de emitir y se persiste: ya está impreso en
 *     papel y enviado por WhatsApp. Renombrar el prefijo después no renombra
 *     nada de eso — solo consigue que el boleto que el cliente tiene en la
 *     mano deje de corresponderse con el sorteo al que pertenece.
 *
 *  2. **Un sorteo cerrado está sellado.** `cerrarSorteo` lo describe como "no
 *     admite más ejecuciones ni boletos nuevos"; editarle las fechas o el
 *     nombre después de haber publicado ganadores contradice eso.
 *
 * Se comprueba en la Server Action porque es la capa que TODO camino
 * atraviesa. Hay además una migración escrita para llevar la regla a la base
 * (supabase/migrations/20260731_01_sorteos_congelar_prefijo_y_cerrado.sql),
 * pendiente de aplicar.
 */
export async function actualizarSorteo(
    id: string, input: SorteoFormData,
): Promise<void> {
    const { supabase } = await exigirPermisoSorteo()
    const validado = SorteoSchema.parse(input)

    const { data: actual, error: errorLectura } = await supabase
        .from('sorteos').select('estado, prefijo, ultimo_numero').eq('id', id).single()
    if (errorLectura || !actual) throw new Error('Sorteo no encontrado')

    if (actual.estado === 'cerrado') {
        throw new Error('Un sorteo cerrado no se puede editar')
    }
    if (actual.ultimo_numero > 0 && validado.prefijo !== actual.prefijo) {
        throw new Error(
            'El prefijo no se puede cambiar: este sorteo ya emitió boletos y su ' +
            'número está impreso o enviado tal cual al cliente',
        )
    }

    const { error } = await supabase.from('sorteos').update(validado).eq('id', id)
    if (error) {
        // Mismo mensaje que crearSorteo: sin esto, al editar salía el
        // "duplicate key value violates unique constraint uq_sorteo_prefijo"
        // crudo de Postgres.
        if (error.code === '23505') {
            throw new Error('Ya existe un sorteo con ese prefijo')
        }
        throw new Error(error.message)
    }

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

    // El índice único uq_sorteo_activo impide dos activos a la vez.
    // El error no se ignora: si este UPDATE falla, el siguiente choca contra
    // uq_sorteo_activo y el usuario recibiría el mensaje crudo del índice en
    // vez de la causa real.
    const { error: errorDegradar } = await supabase
        .from('sorteos').update({ estado: 'borrador' })
        .eq('estado', 'activo').neq('id', id)
    if (errorDegradar) throw new Error(errorDegradar.message)

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

/**
 * Lee los boletos que participarían, en orden canónico por número.
 *
 * SIEMPRE con el cliente admin: el pool de un sorteo es toda la cartera, y
 * el cliente de sesión solo ve los boletos de los clientes del agente que
 * llama (verificado: 2 de 4 en la prueba con dos agentes). Un pool
 * amputado no produce un error, produce un sorteo amañado en silencio.
 * Solo salen de aquí `id`, `numero` y `cliente_id`, y ninguno de los tres
 * llega nunca al navegador.
 *
 * SIEMPRE paginado, por la segunda razón por la que un pool puede salir
 * amputado sin que nada falle: PostgREST corta en 1000 filas sin error ni
 * aviso (ver lib/supabase/paginacion.ts). Con el `.order('numero')`
 * ascendente que había aquí, el corte era además determinista y siempre en
 * la misma dirección: los 1000 boletos más antiguos entraban y todo boleto a
 * partir del 1001 tenía probabilidad CERO de ganar, con `pool_count` y
 * `pool_hash` calculados sobre el pool recortado —coherentes entre sí— de
 * modo que "Verificar ejecución" certificaba el sesgo en verde.
 *
 * Se pagina por `id`, no por `numero`: el cursor tiene que ser único o los
 * empates en la frontera de un lote se pierden. El orden canónico del
 * módulo, `(numero, id)`, no se pierde por ello: lo aplica
 * `seleccionarGanadores()` sobre el pool ya completo, y es un orden total
 * real, así que el resultado no depende de en qué orden llegaran las filas.
 */
async function leerPool(
    admin: ClienteAdmin,
    sorteoId: string,
    desde: string,
    hasta: string,
): Promise<TicketParticipante[]> {
    const { desdeISO, hastaISO } = rangoRDaUTC(desde, hasta)

    // Los mismos filtros para el lote y para el conteo de control, escritos
    // una sola vez: si los dos no son idénticos, la comprobación de
    // completitud del helper no comprueba nada.
    const filtrar = (consulta: ConsultaEncadenable) =>
        consulta
            .eq('sorteo_id', sorteoId)
            .eq('estado', 'valido')
            .gte('emitido_at', desdeISO)
            .lte('emitido_at', hastaISO)

    return leerTodasLasFilas<TicketParticipante>({
        etiqueta: 'los boletos participantes del sorteo',
        clave: 'id',
        lote: (cursor, limite) => {
            const base = filtrar(
                encadenable(admin.from('tickets').select('id, numero, cliente_id')),
            )
            return comoLote<TicketParticipante>(
                (cursor ? base.gt('id', cursor) : base).order('id').limit(limite),
            )
        },
        contar: () => comoConteo(filtrar(
            encadenable(admin.from('tickets').select('id', { count: 'exact', head: true })),
        )),
    })
}

/**
 * Cuántos boletos y cuántos clientes distintos participarían.
 *
 * Gateada con `realizar_sorteo`, no con `ver_sorteos`: la vista previa solo
 * existe dentro del diálogo de ejecución, que a su vez solo se muestra con
 * `realizar_sorteo`. Antes no comprobaba ningún permiso y se apoyaba en RLS,
 * que además la truncaba (ver leerPool).
 */
export async function previsualizarPool(
    sorteoId: string, desde: string, hasta: string,
): Promise<{ boletos: number; clientes: number }> {
    await exigirPermisoSorteo()
    const pool = await leerPool(crearClienteAdmin(), sorteoId, desde, hasta)

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
        crearClienteAdmin(), validado.sorteo_id,
        validado.rango_desde, validado.rango_hasta,
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
    /**
     * true cuando la lista de participantes guardada ya no está completa
     * (borrados en cascada). Distingue "falta información" de "la información
     * no cuadra": sin esta distinción, un borrado se presenta como fraude.
     */
    faltanParticipantes: boolean
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
    const { supabase } = await exigirVerSorteos()

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
            faltanParticipantes: false,
            mensaje: `Esta ejecución usó el algoritmo "${ejecucion.algoritmo}" y el sistema actual usa "${ALGORITMO_SORTEO}". No se puede verificar automáticamente.`,
            ganadoresEsperados: [],
            ganadoresGuardados: [],
        }
    }

    // Cliente admin, obligatoriamente: el recálculo tiene que partir del pool
    // COMPLETO. Con el cliente de sesión, un agente solo recuperaba los
    // participantes de sus propios clientes (2 de 4 en la prueba real) y la
    // verificación de un sorteo intachable devolvía "los ganadores NO
    // coinciden" — el peor falso positivo posible en una función cuyo único
    // trabajo es demostrar que no hubo trampa.
    const admin = crearClienteAdmin()

    // Paginado por el mismo motivo que leerPool, y con la misma urgencia
    // invertida: aquí el truncado a 1000 de PostgREST no falsea un sorteo,
    // falsea su auditoría. Antes de paginar leerPool este `select` no podía
    // pasar de 1000 filas porque el propio bug se lo impedía; arreglado el
    // primero y no este, la verificación de cualquier sorteo de más de 1000
    // boletos habría empezado a responder "los ganadores NO coinciden" sobre
    // ejecuciones perfectamente limpias — la acusación falsa de fraude que la
    // pantalla existe justamente para desmentir.
    //
    // La clave de paginación es `ticket_id`: `sorteo_participantes` no tiene
    // columna `id` (su PK es `(ejecucion_id, ticket_id)`), y como la consulta
    // ya fija `ejecucion_id`, `ticket_id` es único dentro del resultado.
    type FilaParticipante = {
        ticket_id: string
        ticket: TicketParticipante | null
    }

    const participantes = await leerTodasLasFilas<FilaParticipante>({
        etiqueta: 'los participantes guardados de la ejecución',
        clave: 'ticket_id',
        lote: (cursor, limite) => {
            const base = encadenable(
                admin
                    .from('sorteo_participantes')
                    .select('ticket_id, ticket:tickets(id, numero, cliente_id)'),
            ).eq('ejecucion_id', ejecucionId)
            return comoLote<FilaParticipante>(
                (cursor ? base.gt('ticket_id', cursor) : base)
                    .order('ticket_id')
                    .limit(limite),
            )
        },
        contar: () => comoConteo(
            encadenable(
                admin
                    .from('sorteo_participantes')
                    .select('ticket_id', { count: 'exact', head: true }),
            ).eq('ejecucion_id', ejecucionId),
        ),
    })

    const pool: TicketParticipante[] = participantes
        .map(p => p.ticket as unknown as TicketParticipante)
        .filter(Boolean)

    // `sorteo_participantes` conserva la fila aunque el boleto desaparezca?
    // No: `ticket_id` es ON DELETE CASCADE hacia `tickets`, y `tickets` lo es
    // hacia `clientes`. Borrar un cliente arrastra en cascada las filas de
    // auditoría del sorteo. Aun así se cuenta el hueco por si algún join
    // devolviera `null`, para no confundirlo con "los ganadores no coinciden".
    const participantesSinBoleto = participantes.length - pool.length

    // Sin paginar a propósito: `cantidad_ganadores` está acotada a 100 por
    // EjecutarSorteoSchema y por `uq_ganador_posicion`, así que este `select`
    // no puede acercarse al tope de 1000 filas de PostgREST.
    const { data: guardados } = await admin
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

    // Cuatro ramas, no tres. Antes cualquier `!coincide` caía en "revisa esta
    // ejecución" —una acusación de manipulación— aunque `poolIntacto` fuese
    // false y la explicación real fuese que faltan filas. Y faltar pueden:
    // `sorteo_participantes.ticket_id` y `sorteo_ganadores.ticket_id` son
    // ON DELETE CASCADE hacia `tickets`, y `tickets.cliente_id` lo es hacia
    // `clientes`, así que borrar un cliente destruye parte de la auditoría del
    // sorteo. Cuando eso pasa, el recálculo parte de menos participantes de
    // los que hubo y por fuerza da otros ganadores: la pantalla que existe
    // para desmentir una acusación de fraude la estaría formulando ella misma.
    // Falta información, no cuadra la información — no es lo mismo y el
    // mensaje tiene que decir cuál de las dos es.
    const faltanParticipantes =
        !poolIntacto || pool.length !== ejecucion.pool_count || participantesSinBoleto > 0

    let mensaje: string
    if (coincide && poolIntacto) {
        mensaje = 'Verificado. Al repetir el sorteo con la misma semilla salen exactamente los mismos ganadores.'
    } else if (coincide && !poolIntacto) {
        mensaje = 'Los ganadores coinciden, pero la lista de participantes guardada ya no cuadra con la huella original. Es probable que algún boleto se haya eliminado de la base de datos.'
    } else if (faltanParticipantes) {
        mensaje =
            `No se puede verificar esta ejecución: la lista de participantes guardada ya no cuadra con la huella original. ` +
            `Se registraron ${ejecucion.pool_count} boletos participantes y hoy quedan ${pool.length}. ` +
            `Al faltar participantes, el recálculo parte de un pool distinto y necesariamente da otros ganadores, ` +
            `así que esto NO indica que el sorteo se manipulara: indica que se borraron filas de la base de datos ` +
            `(borrar un cliente arrastra en cascada sus boletos y con ellos la auditoría del sorteo).`
    } else {
        mensaje = 'Los ganadores NO coinciden con lo que produce el algoritmo a partir de la semilla guardada. Revisa esta ejecución.'
    }

    return {
        coincide,
        algoritmo: ejecucion.algoritmo,
        semilla: ejecucion.semilla,
        poolCount: ejecucion.pool_count,
        poolIntacto,
        faltanParticipantes,
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

    // `.select('id')` no es decorativo: sin él, un UPDATE que RLS deje en 0
    // filas se comporta igual que uno exitoso (Postgres no lo considera un
    // error), el interruptor de la interfaz se quedaría marcado y el premio
    // constaría como entregado sin estarlo.
    // `notas` solo se escribe si el llamante la pasa. Con `notas: notas?.trim()
    // || null` fijo, el único llamante de hoy (ganadores-panel.tsx, que invoca
    // sin notas) ponía la columna a NULL en cada pulsación del interruptor: el
    // día que exista un campo de notas, alternar "entregado" las borraría.
    const cambios: Record<string, unknown> = {
        entregado,
        entregado_at: entregado ? new Date().toISOString() : null,
    }
    if (notas !== undefined) cambios.notas = notas.trim() || null

    const { data: actualizado, error } = await supabase
        .from('sorteo_ganadores')
        .update(cambios)
        .eq('id', ganadorId)
        .select('id')

    if (error) throw new Error(error.message)
    if (!actualizado || actualizado.length === 0) {
        throw new Error('No se pudo actualizar la entrega del premio')
    }

    const sorteoId = (ganador?.ejecucion as unknown as { sorteo_id: string } | null)?.sorteo_id
    if (sorteoId) revalidatePath(`/sorteos/${sorteoId}`)
}
