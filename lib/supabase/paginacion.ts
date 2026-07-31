/**
 * Lectura completa y paginada de una consulta de PostgREST.
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────
 *
 * PostgREST aplica un tope de filas por respuesta (`max-rows`), fijado en
 * **1000** en este proyecto. Cuando lo aplica **no devuelve error ni ninguna
 * cabecera de aviso**: devuelve 200, `error: null` y exactamente 1000 filas.
 * Desde el lado del cliente, una lectura truncada es indistinguible de una
 * tabla que de verdad tiene 1000 filas.
 *
 * Para una lista de pantalla eso es un defecto molesto. Para un cálculo, un
 * conteo o un hash es otra cosa: el sorteo se barajaba solo sobre los 1000
 * boletos de `numero` más bajo, todo boleto a partir del 1001 tenía
 * probabilidad cero de ganar, y `pool_count`/`pool_hash` quedaban coherentes
 * entre sí sobre el pool amputado, de modo que "Verificar ejecución"
 * confirmaba el sesgo en verde. Un pool corto no es un error visible: es un
 * sorteo amañado.
 *
 * ── CÓMO EVITA TRUNCAR EN SILENCIO ────────────────────────────
 *
 * Tres defensas, porque una sola no basta:
 *
 *  1. **Paginación por clave (keyset)**, no por `.range()`/OFFSET. Se pide
 *     lote a lote `clave > último_visto`, ordenando por `clave` ascendente.
 *     A diferencia del OFFSET, un INSERT concurrente no desplaza la ventana,
 *     así que no se puede saltar ni repetir filas por una carrera.
 *
 *  2. **Contraste contra el `count` exacto** de la misma consulta. Si lo
 *     leído no cuadra con lo que dice la base, se reintenta la lectura
 *     entera (la tabla pudo cambiar mientras se leía) y, si sigue sin
 *     cuadrar, se **lanza un error**. Esta es la defensa que importa: sin
 *     ella, bastaría con que alguien bajase `max-rows` por debajo de
 *     `TAMANO_LOTE` para que el primer lote llegase corto y el bucle
 *     terminase creyendo haber leído todo.
 *
 *  3. **Invariantes por fila**: la clave de paginación tiene que venir en
 *     cada fila (si el `select` la omite, el cursor no avanzaría y la
 *     lectura se quedaría corta o giraría en redondo) y no puede repetirse
 *     (si se repite, el `order` no es el que se cree y el keyset no es
 *     estable). Las dos cosas fallan ruidosamente.
 *
 * ── ORDEN ─────────────────────────────────────────────────────
 *
 * Este helper devuelve las filas ordenadas por la **clave de paginación**,
 * que es única y por tanto un orden total y determinista **a través de los
 * lotes**, no solo dentro de cada uno. No intenta imponer ningún otro orden:
 * el orden canónico de negocio (en el módulo de sorteos, `(numero, id)`) lo
 * aplica quien consume el resultado, sobre el conjunto ya completo. Es
 * deliberado: un orden de negocio no único —`numero` a secas— no sirve como
 * cursor, porque los empates en la frontera de un lote se perderían o se
 * repetirían.
 */

/** Tamaño de lote. NUNCA debe superar el `max-rows` de PostgREST (1000). */
export const TAMANO_LOTE = 1000

/** Tope de lotes por lectura (1000 lotes × 1000 filas = 1.000.000 de filas). */
const MAX_LOTES = 1000

/** Reintentos completos cuando el conteo no cuadra por escrituras concurrentes. */
const MAX_INTENTOS = 3

/**
 * Vista mínima y NO genérica de un query builder de PostgREST.
 *
 * Los tipos reales de `postgrest-js` son genéricos sobre el esquema, la tabla
 * y la forma del `select`, y encadenar un helper genérico sobre ellos hace que
 * TypeScript se rinda con "Type instantiation is excessively deep" (TS2589).
 * Como los clientes de este proyecto se construyen sin el genérico `Database`
 * (son `SupabaseClient<any>`), esa inferencia no aporta seguridad real: no hay
 * ningún esquema contra el que comprobar los nombres de columna. Así que se
 * reinterpretan explícitamente con `encadenable()`, y la forma de las filas la
 * fija quien llama vía el parámetro de tipo de `leerTodasLasFilas`.
 */
export interface ConsultaEncadenable {
    eq(columna: string, valor: unknown): ConsultaEncadenable
    neq(columna: string, valor: unknown): ConsultaEncadenable
    gt(columna: string, valor: unknown): ConsultaEncadenable
    gte(columna: string, valor: unknown): ConsultaEncadenable
    lte(columna: string, valor: unknown): ConsultaEncadenable
    is(columna: string, valor: unknown): ConsultaEncadenable
    in(columna: string, valores: readonly unknown[]): ConsultaEncadenable
    order(columna: string, opciones?: { ascending?: boolean }): ConsultaEncadenable
    limit(n: number): ConsultaEncadenable
}

/** Reinterpreta un builder de supabase-js como `ConsultaEncadenable`. */
export function encadenable(consulta: unknown): ConsultaEncadenable {
    return consulta as ConsultaEncadenable
}

/** La misma consulta, vista como la promesa de un lote de filas `T`. */
export function comoLote<T>(consulta: ConsultaEncadenable): PromiseLike<RespuestaLote<T>> {
    return consulta as unknown as PromiseLike<RespuestaLote<T>>
}

/** La misma consulta, vista como la promesa de un conteo. */
export function comoConteo(consulta: ConsultaEncadenable): PromiseLike<RespuestaConteo> {
    return consulta as unknown as PromiseLike<RespuestaConteo>
}

export interface RespuestaLote<T> {
    data: T[] | null
    error: { message: string } | null
}

export interface RespuestaConteo {
    count: number | null
    error: { message: string } | null
}

export interface OpcionesLecturaCompleta<T> {
    /** Cómo llamar a esto en los mensajes de error. Ej.: 'los boletos del sorteo'. */
    etiqueta: string
    /** Columna única por la que paginar. Debe venir en el `select` de `lote`. */
    clave?: string
    tamanoLote?: number
    /**
     * Un lote: las filas con `clave > cursor`, ordenadas por `clave`
     * ascendente, como mucho `limite`.
     */
    lote(cursor: string | null, limite: number): PromiseLike<RespuestaLote<T>>
    /** Conteo exacto con **exactamente los mismos filtros** que `lote`. */
    contar(): PromiseLike<RespuestaConteo>
}

/**
 * Lee TODAS las filas de una consulta, o lanza un error. Nunca devuelve un
 * resultado parcial.
 */
export async function leerTodasLasFilas<T>(
    opciones: OpcionesLecturaCompleta<T>,
): Promise<T[]> {
    const { etiqueta } = opciones
    const clave = opciones.clave ?? 'id'
    const tamanoLote = opciones.tamanoLote ?? TAMANO_LOTE

    if (!Number.isInteger(tamanoLote) || tamanoLote < 1) {
        throw new Error(`Tamaño de lote inválido para ${etiqueta}: ${tamanoLote}`)
    }

    let ultimoDesfase: { leidas: number; total: number } | null = null

    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
        const filas: T[] = []
        const vistos = new Set<string>()
        let cursor: string | null = null
        let completo = false

        for (let n = 0; n < MAX_LOTES; n++) {
            const { data, error } = await opciones.lote(cursor, tamanoLote)
            if (error) {
                throw new Error(`No se pudo leer ${etiqueta}: ${error.message}`)
            }

            const trozo = data ?? []
            for (const fila of trozo) {
                const valor = (fila as Record<string, unknown>)[clave]
                if (typeof valor !== 'string' || valor === '') {
                    throw new Error(
                        `Lectura de ${etiqueta} abortada: la clave de paginación ` +
                        `"${clave}" no viene en las filas (o no es un texto). Sin ` +
                        `ella el cursor no avanza y la lectura se truncaría en silencio.`,
                    )
                }
                if (vistos.has(valor)) {
                    throw new Error(
                        `Lectura de ${etiqueta} abortada: la fila con ${clave}=${valor} ` +
                        `llegó dos veces. El orden por "${clave}" no es estable, así que ` +
                        `la paginación no puede garantizar haber leído todo.`,
                    )
                }
                vistos.add(valor)
                filas.push(fila)
                cursor = valor
            }

            if (trozo.length < tamanoLote) {
                completo = true
                break
            }
        }

        if (!completo) {
            throw new Error(
                `Lectura de ${etiqueta} abortada: superó ${MAX_LOTES} lotes de ` +
                `${tamanoLote} filas sin terminar.`,
            )
        }

        // La red de seguridad. Un lote corto puede significar "ya no hay más"
        // o "el servidor recortó por debajo de lo que pedimos"; solo el conteo
        // exacto de la base distingue una cosa de la otra.
        const { count, error: errorConteo } = await opciones.contar()
        if (errorConteo) {
            throw new Error(
                `No se pudo contar ${etiqueta} para comprobar que la lectura ` +
                `está completa: ${errorConteo.message}`,
            )
        }
        if (count === null || count === undefined) {
            throw new Error(
                `La consulta de ${etiqueta} no devolvió un conteo exacto. Sin él no ` +
                `hay forma de saber si la lectura está completa, y una lectura ` +
                `incompleta aquí no produce un error: produce un resultado falso.`,
            )
        }

        if (count === filas.length) return filas

        ultimoDesfase = { leidas: filas.length, total: count }
        // Puede ser una escritura concurrente: se reintenta la lectura entera.
    }

    throw new Error(
        `Lectura incompleta de ${etiqueta}: se leyeron ${ultimoDesfase?.leidas} filas ` +
        `pero la base dice que hay ${ultimoDesfase?.total}, y sigue sin cuadrar tras ` +
        `${MAX_INTENTOS} intentos. Se aborta antes que devolver un resultado parcial.`,
    )
}
