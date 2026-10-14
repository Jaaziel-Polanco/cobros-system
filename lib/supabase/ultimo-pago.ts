/**
 * Último pago registrado por deuda.
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────
 *
 * Dos sitios construían este mapa con el mismo `select` sin paginar:
 *
 *   supabase.from('pagos')
 *     .select('deuda_id, created_at')
 *     .in('deuda_id', deudaIds)
 *     .order('created_at', { ascending: false })
 *
 * ...y se quedaban con la primera aparición de cada `deuda_id`, confiando en
 * que el `order` descendente pusiera el pago más reciente arriba. Dentro de
 * una respuesta completa eso es correcto. El problema es que la respuesta no
 * era completa: PostgREST corta en 1000 filas sin error, sin cabecera y con
 * `error: null` (ver `paginacion.ts`).
 *
 * Y el corte, combinado con ese `order`, es de la peor clase posible: se
 * queda con los 1000 pagos más recientes **del conjunto entero**, no con el
 * más reciente de cada deuda. Una deuda cuyo último pago sea más antiguo que
 * el pago nº 1000 desaparece del mapa. No aparece como "pagó hace mucho":
 * aparece como **no ha pagado nunca**.
 *
 * Medido contra producción (2026-07-31): 741 deudas activas, 1905 pagos
 * suyos, cortados a 1000; de las 513 deudas con pagos, **82 quedaban
 * invisibles**. Esas 82 se trataban como impagadas y el cron les mandaba un
 * recordatorio de cobro por WhatsApp a clientes que ya habían pagado.
 *
 * ── POR QUÉ SE PAGINA Y NO SE AGREGA ──────────────────────────
 *
 * Traer 1905 filas para quedarse con 513 es un desperdicio, y lo correcto
 * sería que la base devolviera ya `max(created_at)` agrupado por deuda. Se
 * probaron las dos formas de hacerlo y ninguna está disponible sin DDL:
 *
 *  - Agregados de PostgREST (`select=deuda_id,created_at.max()`): el
 *    proyecto los tiene desactivados. Comprobado contra producción, responde
 *    `400 PGRST123 "Use of aggregate functions is not allowed"`.
 *  - Un RPC con `DISTINCT ON (deuda_id)`, como el `ultimos_envios_por_deuda`
 *    que ya existe para `envios_log`: es la solución buena, pero crearlo es
 *    DDL sobre la base de producción y queda fuera de este cambio. Está
 *    escrito y **sin aplicar** en
 *    `supabase/migrations/20260731_03_ultimos_pagos_por_deuda.sql`; cuando el
 *    dueño lo aplique, esta función puede pasar a una sola llamada.
 *
 * Mientras tanto se pagina, que es correcto hoy y no depende de nada nuevo en
 * la base. Son 2 peticiones en vez de 1, y el coste está acotado por
 * `leerTodasLasFilas`, que además **falla ruidosamente** si la lectura no
 * cuadra con el conteo exacto en vez de devolver un mapa incompleto.
 *
 * ── POR QUÉ YA NO SE ORDENA POR `created_at` ──────────────────
 *
 * La paginación por keyset exige que el cursor sea único, así que se ordena
 * por `id`. El "más reciente" ya no puede deducirse de la posición: se
 * calcula explícitamente comparando fechas al llenar el mapa. Es más robusto
 * que antes, porque tampoco dependía de que PostgREST desempatara dos pagos
 * con el mismo `created_at` de una forma concreta.
 *
 * ── POR QUÉ SE TROCEA `deudaIds` ──────────────────────────────
 *
 * El `.in('deuda_id', deudaIds)` viaja en la URL del GET, y la URL tiene
 * tope. Medido contra producción (2026-10-14) con UUIDs de deuda: hasta 393
 * responde; desde 394 Node aborta por cabeceras demasiado grandes, y desde
 * 644 Cloudflare devuelve `400 Bad Request`. Con las deudas activas de hoy,
 * esta lectura fallaba en cada corrida y el cron de recordatorios no envió
 * nada del 2026-08-06 al 2026-10-14.
 *
 * El código anterior a la paginación hacía la misma consulta y ya fallaba,
 * pero descartaba el `error`: el mapa salía vacío y el filtro de «ya pagó
 * este período» no se aplicaba a nadie.
 *
 * Cada bloque pasa por `leerTodasLasFilas` con su propio conteo exacto, así
 * que la comprobación de completitud se conserva bloque a bloque.
 */

/**
 * Deudas por petición. Muy por debajo del tope medido (393): un UUID ocupa
 * ~39 caracteres en la URL, así que 150 son unos 6 KB.
 */
export const DEUDAS_POR_BLOQUE = 150

import {
    leerTodasLasFilas, encadenable, comoLote, comoConteo,
    type ConsultaEncadenable,
} from './paginacion'

/**
 * Lo mínimo que se necesita de un cliente de Supabase para leer.
 *
 * No se usa `SupabaseClient` porque los dos llamantes construyen clientes
 * distintos (el de `@supabase/ssr` con cookies y el admin de
 * `@supabase/supabase-js`) y porque encadenar los tipos genéricos de
 * `postgrest-js` a través de un helper dispara TS2589 (ver `paginacion.ts`).
 */
export interface ClienteLector {
    from(tabla: string): {
        select(
            columnas: string,
            opciones?: { count?: 'exact'; head?: boolean },
        ): unknown
    }
}

interface FilaPago {
    id: string
    deuda_id: string
    created_at: string
}

/** Milisegundos de una fecha ISO, o `null` si no es una fecha usable. */
function instante(iso: unknown): number | null {
    if (typeof iso !== 'string' || iso === '') return null
    const ms = Date.parse(iso)
    return Number.isNaN(ms) ? null : ms
}

/**
 * `deuda_id` → `created_at` del pago **más reciente** de esa deuda.
 *
 * Las deudas sin ningún pago no aparecen en el mapa. Lanza si la lectura no
 * se puede completar: un mapa corto aquí no produce un error visible,
 * produce recordatorios de cobro a gente que ya pagó.
 */
export async function leerUltimoPagoPorDeuda(
    cliente: ClienteLector,
    deudaIds: readonly string[],
): Promise<Map<string, string>> {
    const mapa = new Map<string, string>()
    if (deudaIds.length === 0) return mapa

    const pagos: FilaPago[] = []
    for (let i = 0; i < deudaIds.length; i += DEUDAS_POR_BLOQUE) {
        const bloque = deudaIds.slice(i, i + DEUDAS_POR_BLOQUE)

        // Los mismos filtros para el lote y para el conteo de control,
        // escritos una sola vez: si no fueran idénticos, la comprobación de
        // completitud de `leerTodasLasFilas` no comprobaría nada.
        const filtrar = (consulta: ConsultaEncadenable) =>
            consulta.in('deuda_id', bloque)

        pagos.push(...await leerTodasLasFilas<FilaPago>({
            etiqueta: 'los pagos de las deudas consultadas',
            clave: 'id',
            lote: (cursor, limite) => {
                const base = filtrar(
                    encadenable(cliente.from('pagos').select('id, deuda_id, created_at')),
                )
                return comoLote<FilaPago>(
                    (cursor ? base.gt('id', cursor) : base).order('id').limit(limite),
                )
            },
            contar: () => comoConteo(filtrar(
                encadenable(cliente.from('pagos').select('id', { count: 'exact', head: true })),
            )),
        }))
    }

    const masReciente = new Map<string, number>()
    for (const pago of pagos) {
        const ms = instante(pago.created_at)
        if (ms === null) continue
        const previo = masReciente.get(pago.deuda_id)
        if (previo === undefined || ms > previo) {
            masReciente.set(pago.deuda_id, ms)
            mapa.set(pago.deuda_id, pago.created_at)
        }
    }

    return mapa
}
