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
 */

export const MAX_ROWS = 1000

export type Fila = Record<string, unknown>

export const comparar = (a: unknown, b: unknown): number => {
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

export class ConsultaFalsa {
    private filtros: ((f: Fila) => boolean)[] = []
    private orden: { col: string; asc: boolean } | null = null
    private limite: number | null = null

    constructor(
        private filas: Fila[],
        private readonly head: boolean,
        private readonly quiereConteo: boolean,
        private readonly maxRows: number,
    ) { }

    eq(c: string, v: unknown) { this.filtros.push(f => f[c] === v); return this }
    neq(c: string, v: unknown) { this.filtros.push(f => f[c] !== v); return this }
    gt(c: string, v: unknown) { this.filtros.push(f => comparar(f[c], v) > 0); return this }
    gte(c: string, v: unknown) { this.filtros.push(f => comparar(f[c], v) >= 0); return this }
    lte(c: string, v: unknown) { this.filtros.push(f => comparar(f[c], v) <= 0); return this }
    is(c: string, v: unknown) { this.filtros.push(f => f[c] === v); return this }

    in(c: string, valores: readonly unknown[]) {
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

export interface OpcionesBaseFalsa {
    maxRows?: number
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
                    )
                },
                insert(valores: Fila | Fila[]) {
                    return new InsercionFalsa(filas, valores)
                },
            }
        },
        async rpc(nombre: string, args?: unknown) {
            const fn = opcionesBase.rpc?.[nombre]
            if (!fn) return { data: null, error: null }
            return fn(args)
        },
    }
}
