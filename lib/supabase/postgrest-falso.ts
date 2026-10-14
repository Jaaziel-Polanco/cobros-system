/**
 * Doble de PostgREST para pruebas. **No lo importa ningún código de
 * producción**; vive aquí y no en un `.test.ts` porque lo comparten varias
 * suites (`lib/`, y la del cron en `app/`).
 *
 * Reproduce la única propiedad que causa toda esta familia de defectos:
 *
 *   PostgREST recorta la respuesta al `max-rows` del proyecto (1000)
 *   **sin error, sin cabecera y sin nada**. Devuelve 200, `error: null` y
 *   menos filas de las que hay. Desde el cliente, una lectura truncada es
 *   indistinguible de una tabla que de verdad tiene ese tamaño.
 *
 * Y reproduce también la asimetría que hace posible detectarlo:
 * `count: 'exact'` NO está sujeto al tope, porque lo calcula Postgres.
 *
 * Es una copia deliberada del doble que ya había en
 * `lib/actions/sorteos.test.ts`, ampliada con `.in()`, `.or()`, `insert()` y
 * `rpc()`. Aquella suite no se toca: reescribirla para compartir este
 * módulo cambiaría pruebas que hoy están en verde y que son la red del
 * módulo de sorteos.
 *
 * ── LOS RPC TAMBIÉN SE RECORTAN ───────────────────────────────
 *
 * `rpc()` devolvía antes el resultado del manejador tal cual, como si una
 * función fuera inmune al tope. No lo es: PostgREST expone una función que
 * devuelve `SETOF`/`TABLE` como una relación más, y le aplica el mismo
 * `max-rows` **sin error y sin cabecera**. Comprobado contra producción
 * (2026-07-31): `ultimos_envios_por_deuda` con 1102 deudas devuelve 1000
 * filas con `error: null` cuando el total real es 1088.
 *
 * Y como es una relación, admite también `.eq()`, `.order()`, `.gt()`,
 * `.limit()` y `count: 'exact'`, todo resuelto en la base **antes** del
 * recorte. Eso es lo que hace paginable un RPC, y por eso el doble tiene que
 * reproducir las dos mitades: el recorte y las herramientas para detectarlo.
 * Un manejador que devuelva un array pasa por `ConsultaFalsa`; uno que
 * devuelva cualquier otra cosa (un escalar, `null`) se entrega tal cual.
 *
 * ── `.in()` VIAJA EN LA URL, Y LA URL TIENE TOPE ──────────────
 *
 * Un `select` es un GET: `.in('deuda_id', ids)` mete cada UUID en la query
 * string. Medido contra producción (2026-10-14) con UUIDs de `deudas`:
 * hasta 393 valores responde bien; de 394 a 643 Node aborta con
 * `UND_ERR_HEADERS_OVERFLOW` (la respuesta trae la URL de vuelta en una
 * cabecera); desde 644, Cloudflare devuelve `400 Bad Request`. Eso dejó el
 * cron de recordatorios sin enviar nada desde el 2026-08-06, mientras esta
 * suite —que ya probaba con 1200 deudas— seguía en verde porque el doble
 * aceptaba listas de cualquier tamaño.
 *
 * Aquí se modela por número de valores, no por bytes: los ids de las
 * pruebas son cortos y un tope por longitud no saltaría nunca.
 */

export const MAX_ROWS = 1000

/** Valores que admite un `.in()` antes de que la petición falle (ver arriba). */
export const MAX_VALORES_IN = 393

export type Fila = Record<string, unknown>

export const comparar = (a: unknown, b: unknown): number => {
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

export class ConsultaFalsa {
    private filtros: ((f: Fila) => boolean)[] = []
    private orden: { col: string; asc: boolean } | null = null
    private limite: number | null = null
    private urlDemasiadoLarga = false

    constructor(
        private filas: Fila[],
        private readonly head: boolean,
        private readonly quiereConteo: boolean,
        private readonly maxRows: number,
        private readonly maxValoresIn: number = MAX_VALORES_IN,
    ) { }

    eq(c: string, v: unknown) { this.filtros.push(f => f[c] === v); return this }
    neq(c: string, v: unknown) { this.filtros.push(f => f[c] !== v); return this }
    gt(c: string, v: unknown) { this.filtros.push(f => comparar(f[c], v) > 0); return this }
    gte(c: string, v: unknown) { this.filtros.push(f => comparar(f[c], v) >= 0); return this }
    lte(c: string, v: unknown) { this.filtros.push(f => comparar(f[c], v) <= 0); return this }
    is(c: string, v: unknown) { this.filtros.push(f => f[c] === v); return this }

    in(c: string, valores: readonly unknown[]) {
        if (valores.length > this.maxValoresIn) this.urlDemasiadoLarga = true
        const conjunto = new Set(valores)
        this.filtros.push(f => conjunto.has(f[c]))
        return this
    }

    order(col: string, opciones?: { ascending?: boolean }) {
        this.orden = { col, asc: opciones?.ascending ?? true }
        return this
    }

    limit(n: number) { this.limite = n; return this }

    private resolver() {
        // Lo que ve supabase-js cuando Cloudflare corta: sin cuerpo JSON,
        // `error.message` es el `statusText`.
        if (this.urlDemasiadoLarga) {
            return { data: null, error: { message: 'Bad Request' }, count: null }
        }
        let filas = this.filas.filter(f => this.filtros.every(p => p(f)))
        if (this.orden) {
            const { col, asc } = this.orden
            filas = [...filas].sort((a, b) => (asc ? 1 : -1) * comparar(a[col], b[col]))
        }
        // `count: 'exact'` NO está sujeto al tope: lo calcula Postgres.
        const total = filas.length
        if (this.limite !== null) filas = filas.slice(0, this.limite)
        // ── EL CORTE SILENCIOSO ──
        // Sin error, sin cabecera, sin nada. Es todo el defecto.
        if (filas.length > this.maxRows) filas = filas.slice(0, this.maxRows)

        return {
            data: this.head ? null : filas,
            error: null,
            count: this.quiereConteo ? total : null,
        }
    }

    single() {
        const r = this.resolver()
        const fila = (r.data as Fila[] | null)?.[0]
        return Promise.resolve(
            fila
                ? { data: fila, error: null }
                : { data: null, error: { message: 'no rows', code: 'PGRST116' } },
        )
    }

    maybeSingle() {
        const r = this.resolver()
        return Promise.resolve({ data: (r.data as Fila[] | null)?.[0] ?? null, error: null })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(alCumplir: any, alFallar?: any) {
        return Promise.resolve(this.resolver()).then(alCumplir, alFallar)
    }
}

/** INSERT, lo justo para que el cron pueda escribir en `envios_log`. */
class InsercionFalsa {
    constructor(private filas: Fila[], private valores: Fila | Fila[]) { }

    private resolver() {
        const nuevas = Array.isArray(this.valores) ? this.valores : [this.valores]
        this.filas.push(...nuevas)
        return { data: nuevas, error: null }
    }

    select() { return this }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(alCumplir: any, alFallar?: any) {
        return Promise.resolve(this.resolver()).then(alCumplir, alFallar)
    }
}

/**
 * Una consulta que sólo sabe fallar, pero que se deja encadenar igual. Hace
 * falta para que un RPC con error se comporte como los demás builders: el
 * código de producción encadena `.eq().order().limit()` antes de esperar.
 */
class ConsultaFallida {
    constructor(private readonly error: { message: string }) { }
    eq() { return this }
    neq() { return this }
    gt() { return this }
    gte() { return this }
    lte() { return this }
    is() { return this }
    in() { return this }
    order() { return this }
    limit() { return this }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(alCumplir: any, alFallar?: any) {
        return Promise.resolve({ data: null, error: this.error, count: null })
            .then(alCumplir, alFallar)
    }
}

export interface OpcionesBaseFalsa {
    maxRows?: number
    /** Tope de valores de un `.in()`; por defecto, el medido en producción. */
    maxValoresIn?: number
    /** Respuestas de `rpc(nombre, args)`, por nombre. */
    rpc?: Record<string, (args: unknown) => { data: unknown; error: { message: string } | null }>
}

/**
 * Una base falsa sobre `db`, un objeto `{ tabla: filas[] }`.
 *
 * `maxRows` es el tope que recorta en silencio; súbelo por encima del
 * volumen de datos de la prueba para simular "sin corte", o bájalo para
 * simular un servidor que recorta por debajo del tamaño de lote.
 */
export function crearBaseFalsa(
    db: Record<string, Fila[]>,
    opcionesBase: OpcionesBaseFalsa = {},
) {
    const maxRows = opcionesBase.maxRows ?? MAX_ROWS

    return {
        from(tabla: string) {
            const filas = (db[tabla] ??= [])
            return {
                select(_cols?: string, opciones?: { count?: string; head?: boolean }) {
                    return new ConsultaFalsa(
                        filas,
                        opciones?.head === true,
                        Boolean(opciones?.count),
                        maxRows,
                        opcionesBase.maxValoresIn,
                    )
                },
                insert(valores: Fila | Fila[]) {
                    return new InsercionFalsa(filas, valores)
                },
            }
        },
        rpc(
            nombre: string,
            args?: unknown,
            opciones?: { count?: string; head?: boolean },
        ) {
            const fn = opcionesBase.rpc?.[nombre]
            const resultado = fn ? fn(args) : { data: null, error: null }

            if (resultado.error) return new ConsultaFallida(resultado.error)

            // Sólo un conjunto de filas es una relación para PostgREST. Un
            // escalar o un `void` (p. ej. `actualizar_dias_atraso`) se
            // devuelve tal cual, esperable con un simple `await`.
            if (!Array.isArray(resultado.data)) {
                return Promise.resolve(resultado)
            }

            return new ConsultaFalsa(
                resultado.data as Fila[],
                opciones?.head === true,
                Boolean(opciones?.count),
                maxRows,
            )
        },
    }
}
