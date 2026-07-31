/**
 * Pruebas de las Server Actions de sorteos contra un doble de PostgREST.
 * Cubren H1 (truncado silencioso del pool), H2 (prefijo congelado y sorteo
 * cerrado), H4 (las notas del premio) y H5 (el mensaje de verificación).
 *
 * ── H1 ────────────────────────────────────────────────────────
 *
 * ESTA PRUEBA FALLA CON EL CÓDIGO ANTERIOR A LA CORRECCIÓN. Con el `leerPool`
 * de un solo `select` sin paginar, `previsualizarPool` devolvía 1000 sobre un
 * sorteo de 2500 boletos, y `verificarEjecucion` releía 1000 de 2500
 * participantes y respondía "los ganadores NO coinciden" sobre una ejecución
 * limpia. Las dos cosas se comprueban aquí.
 *
 * El defecto sobrevivió a 107 pruebas porque todas ellas probaban la función
 * pura `seleccionarGanadores` con pools que le pasaban ya completos: nadie
 * probaba el trozo que va a buscarlos. Lo que hace falta para atraparlo es
 * simular la propiedad concreta de PostgREST que lo causa —recortar a
 * `max-rows` sin error ni cabecera, devolviendo 200 y `error: null`— y eso es
 * exactamente lo que hace el doble de abajo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    seleccionarGanadores, calcularPoolHash, ALGORITMO_SORTEO,
    type TicketParticipante,
} from '@/lib/utils/sorteo'

// ─── Doble de PostgREST con max-rows ──────────────────────────

const MAX_ROWS = 1000

type Fila = Record<string, unknown>

const comparar = (a: unknown, b: unknown): number => {
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

class ConsultaFalsa {
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

/** UPDATE ... WHERE ... [RETURNING], lo justo para las pruebas de escritura. */
class ActualizacionFalsa {
    private filtros: ((f: Fila) => boolean)[] = []
    private devolver = false

    constructor(private filas: Fila[], private cambios: Fila) { }

    eq(c: string, v: unknown) { this.filtros.push(f => f[c] === v); return this }
    neq(c: string, v: unknown) { this.filtros.push(f => f[c] !== v); return this }
    select(_cols?: string) { this.devolver = true; return this }

    private resolver() {
        const afectadas = this.filas.filter(f => this.filtros.every(p => p(f)))
        for (const fila of afectadas) Object.assign(fila, this.cambios)
        return { data: this.devolver ? afectadas : null, error: null }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(alCumplir: any, alFallar?: any) {
        return Promise.resolve(this.resolver()).then(alCumplir, alFallar)
    }
}

function crearBaseFalsa(db: Record<string, Fila[]>, maxRows = MAX_ROWS) {
    return {
        from(tabla: string) {
            return {
                select(_cols?: string, opciones?: { count?: string; head?: boolean }) {
                    return new ConsultaFalsa(
                        db[tabla] ?? [],
                        opciones?.head === true,
                        Boolean(opciones?.count),
                        maxRows,
                    )
                },
                update(cambios: Fila) {
                    return new ActualizacionFalsa(db[tabla] ?? [], cambios)
                },
            }
        },
    }
}

// ─── Datos ────────────────────────────────────────────────────

const SORTEO_ID = '11111111-1111-4111-8111-111111111111'
const EJECUCION_ID = '22222222-2222-4222-8222-222222222222'
const SEMILLA = 'ZZTEST-semilla-fija'
const TOTAL_BOLETOS = 2500

const idBoleto = (i: number) => `t-${String(i).padStart(6, '0')}`

/** 2500 boletos válidos, uno por cliente, dentro del rango. */
function boletos(): Fila[] {
    return Array.from({ length: TOTAL_BOLETOS }, (_, i) => ({
        id: idBoleto(i),
        numero: i + 1,
        cliente_id: `c-${String(i).padStart(6, '0')}`,
        sorteo_id: SORTEO_ID,
        estado: 'valido',
        emitido_at: '2026-07-15T12:00:00.000Z',
    }))
}

const poolCompleto: TicketParticipante[] = boletos().map(b => ({
    id: b.id as string,
    numero: b.numero as number,
    cliente_id: b.cliente_id as string,
}))

// ─── Mocks de módulo ──────────────────────────────────────────

let db: Record<string, Fila[]> = {}
let maxRows = MAX_ROWS

const perfilAdmin = { id: 'u-1', rol: 'admin', permisos: null }

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
        from(tabla: string) {
            const datos = tabla === 'profiles' ? [perfilAdmin] : (db[tabla] ?? [])
            return crearBaseFalsa({ [tabla]: datos }, maxRows).from(tabla)
        },
    }),
}))

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => ({
        from(tabla: string) {
            return crearBaseFalsa(db, maxRows).from(tabla)
        },
    }),
}))

const { previsualizarPool, verificarEjecucion, actualizarSorteo, marcarPremioEntregado } =
    await import('./sorteos')

beforeEach(() => {
    maxRows = MAX_ROWS
    db = {}
})

// ─── H1.a — leerPool ──────────────────────────────────────────

describe('H1 — leerPool no puede truncarse a 1000 boletos', () => {
    beforeEach(() => { db = { tickets: boletos() } })

    it('la vista previa cuenta los 2500 boletos, no los 1000 que cabe en una respuesta', async () => {
        const { boletos: n, clientes } = await previsualizarPool(
            SORTEO_ID, '2026-07-01', '2026-07-31',
        )

        // Con el código anterior: 1000 y 1000, sin ningún error.
        expect(n).toBe(TOTAL_BOLETOS)
        expect(clientes).toBe(TOTAL_BOLETOS)
    })

    it('incluye los boletos de número alto, que eran los que el corte dejaba fuera', async () => {
        // El `.order('numero')` ascendente hacía el corte determinista y
        // siempre en la misma dirección: entraban los 1000 más antiguos, y
        // todo boleto a partir del 1001 tenía probabilidad CERO de ganar.
        // Aquí se comprueba por la vía indirecta que la vista previa expone:
        // si los 2500 clientes distintos están, el nº 2500 está.
        const { clientes } = await previsualizarPool(SORTEO_ID, '2026-07-01', '2026-07-31')
        expect(clientes).toBeGreaterThan(MAX_ROWS)
    })

    it('si el servidor recorta por debajo del lote, aborta en vez de sortear sobre un pool amputado', async () => {
        maxRows = 400
        await expect(
            previsualizarPool(SORTEO_ID, '2026-07-01', '2026-07-31'),
        ).rejects.toThrow(/Lectura incompleta de los boletos participantes del sorteo/)
    })

    it('respeta los filtros: los anulados y los de fuera de rango no entran', async () => {
        const todos = boletos()
        todos[0].estado = 'anulado'
        todos[1].emitido_at = '2026-06-01T12:00:00.000Z'
        todos[2].sorteo_id = null
        db = { tickets: todos }

        const { boletos: n } = await previsualizarPool(SORTEO_ID, '2026-07-01', '2026-07-31')
        expect(n).toBe(TOTAL_BOLETOS - 3)
    })
})

// ─── H1.b — verificarEjecucion ────────────────────────────────

describe('H1 — verificarEjecucion relee TODOS los participantes', () => {
    beforeEach(() => {
        const resultado = seleccionarGanadores(poolCompleto, 3, SEMILLA)

        db = {
            tickets: boletos(),
            sorteo_ejecuciones: [{
                id: EJECUCION_ID,
                sorteo_id: SORTEO_ID,
                cantidad_ganadores: 3,
                semilla: SEMILLA,
                algoritmo: ALGORITMO_SORTEO,
                pool_count: TOTAL_BOLETOS,
                pool_hash: calcularPoolHash(poolCompleto.map(t => t.id)),
                vigente: true,
            }],
            sorteo_participantes: resultado.orden.map(o => ({
                ejecucion_id: EJECUCION_ID,
                ticket_id: o.ticketId,
                orden: o.orden,
                ticket: poolCompleto.find(t => t.id === o.ticketId)!,
            })),
            sorteo_ganadores: resultado.ganadores.map((g, i) => ({
                id: `g-${i}`,
                ejecucion_id: EJECUCION_ID,
                ticket_id: g.id,
                posicion: i + 1,
                ticket: { numero_formateado: `ZZ-${g.numero}` },
            })),
        }
    })

    it('verifica en verde un sorteo limpio de 2500 participantes', async () => {
        const r = await verificarEjecucion(EJECUCION_ID)

        // Con el código anterior (releyendo 1000 de 2500) esto era `false` y
        // el mensaje acusaba a una ejecución intachable. Es el falso positivo
        // que la Tarea 4 acababa de eliminar para el caso de RLS.
        expect(r.coincide).toBe(true)
        expect(r.poolIntacto).toBe(true)
        expect(r.faltanParticipantes).toBe(false)
        expect(r.mensaje).toMatch(/^Verificado\./)
        expect(r.ganadoresEsperados).toEqual(r.ganadoresGuardados)
        expect(r.ganadoresEsperados).toHaveLength(3)
    })

    it('aborta en vez de dar un veredicto si no puede leer los participantes enteros', async () => {
        maxRows = 400
        await expect(verificarEjecucion(EJECUCION_ID)).rejects.toThrow(
            /Lectura incompleta de los participantes guardados de la ejecución/,
        )
    })
})

// ─── H5 — el mensaje distingue "faltan filas" de "no cuadra" ──

describe('H5 — verificarEjecucion no acusa de fraude a un borrado en cascada', () => {
    it('dice que faltan participantes, no que los ganadores no coinciden', async () => {
        const resultado = seleccionarGanadores(poolCompleto, 3, SEMILLA)
        const hashOriginal = calcularPoolHash(poolCompleto.map(t => t.id))

        // Se borra un cliente: ON DELETE CASCADE arrastra su boleto y con él
        // la fila de sorteo_participantes. Quedan 2499 de 2500.
        const supervivientes = resultado.orden.slice(0, TOTAL_BOLETOS - 1)

        db = {
            sorteo_ejecuciones: [{
                id: EJECUCION_ID,
                sorteo_id: SORTEO_ID,
                cantidad_ganadores: 3,
                semilla: SEMILLA,
                algoritmo: ALGORITMO_SORTEO,
                pool_count: TOTAL_BOLETOS,
                pool_hash: hashOriginal,
                vigente: true,
            }],
            sorteo_participantes: supervivientes.map(o => ({
                ejecucion_id: EJECUCION_ID,
                ticket_id: o.ticketId,
                orden: o.orden,
                ticket: poolCompleto.find(t => t.id === o.ticketId)!,
            })),
            sorteo_ganadores: resultado.ganadores.map((g, i) => ({
                id: `g-${i}`,
                ejecucion_id: EJECUCION_ID,
                ticket_id: g.id,
                posicion: i + 1,
            })),
        }

        const r = await verificarEjecucion(EJECUCION_ID)

        expect(r.poolIntacto).toBe(false)
        expect(r.faltanParticipantes).toBe(true)
        expect(r.mensaje).not.toMatch(/Revisa esta ejecución/)
        expect(r.mensaje).toMatch(/NO indica que el sorteo se manipulara/)
        expect(r.mensaje).toContain(`Se registraron ${TOTAL_BOLETOS} boletos participantes`)
        expect(r.mensaje).toContain(`hoy quedan ${TOTAL_BOLETOS - 1}`)
    })
})

// ─── H2 — la congelación del prefijo y el sello del cerrado ───

describe('H2 — actualizarSorteo valida ultimo_numero y estado en el servidor', () => {
    const formulario = {
        nombre: 'Sorteo de prueba',
        descripcion: null,
        premio: null,
        fecha_inicio: '2026-07-01',
        fecha_fin: '2026-07-31',
        prefijo: 'NAV26',
        cantidad_ganadores_default: 1,
    }

    const sorteoEn = (extra: Fila) => ({
        id: SORTEO_ID,
        estado: 'borrador',
        prefijo: 'NAV26',
        ultimo_numero: 0,
        ...extra,
    })

    it('rechaza cambiar el prefijo si el sorteo ya emitió boletos', async () => {
        db = { sorteos: [sorteoEn({ ultimo_numero: 123 })] }

        // El diálogo lo impedía con un `disabled`, que no protege nada: esto
        // es un endpoint HTTP y acepta el payload que le manden.
        await expect(
            actualizarSorteo(SORTEO_ID, { ...formulario, prefijo: 'OTRO26' }),
        ).rejects.toThrow(/El prefijo no se puede cambiar/)

        expect(db.sorteos[0].prefijo).toBe('NAV26')
    })

    it('deja cambiar el prefijo mientras no se haya emitido ningún boleto', async () => {
        db = { sorteos: [sorteoEn({ ultimo_numero: 0 })] }

        await actualizarSorteo(SORTEO_ID, { ...formulario, prefijo: 'OTRO26' })

        expect(db.sorteos[0].prefijo).toBe('OTRO26')
    })

    it('deja editar los demás campos de un sorteo con boletos emitidos', async () => {
        db = { sorteos: [sorteoEn({ ultimo_numero: 123 })] }

        await actualizarSorteo(SORTEO_ID, { ...formulario, nombre: 'Nombre nuevo' })

        expect(db.sorteos[0].nombre).toBe('Nombre nuevo')
        expect(db.sorteos[0].prefijo).toBe('NAV26')
    })

    it('rechaza cualquier edición de un sorteo cerrado', async () => {
        db = { sorteos: [sorteoEn({ estado: 'cerrado' })] }

        await expect(
            actualizarSorteo(SORTEO_ID, { ...formulario, nombre: 'Retoque post mortem' }),
        ).rejects.toThrow(/Un sorteo cerrado no se puede editar/)

        expect(db.sorteos[0].nombre).toBeUndefined()
    })

    it('no escribe nada si el sorteo no existe', async () => {
        db = { sorteos: [] }
        await expect(actualizarSorteo(SORTEO_ID, formulario)).rejects.toThrow('Sorteo no encontrado')
    })
})

// ─── H4 — el interruptor de entrega no borra las notas ────────

describe('H4 — marcarPremioEntregado solo toca `notas` si se le pasan', () => {
    const GANADOR_ID = 'g-0'

    beforeEach(() => {
        db = {
            sorteo_ganadores: [{
                id: GANADOR_ID,
                ejecucion_id: EJECUCION_ID,
                entregado: false,
                entregado_at: null,
                notas: 'Entregado en mano al hijo del cliente',
                ejecucion: { sorteo_id: SORTEO_ID },
            }],
        }
    })

    it('conserva las notas al alternar el interruptor', async () => {
        await marcarPremioEntregado(GANADOR_ID, true)

        expect(db.sorteo_ganadores[0].entregado).toBe(true)
        // Antes esto era null: el único llamante invoca sin notas y la acción
        // escribía `notas: notas?.trim() || null` sin condición.
        expect(db.sorteo_ganadores[0].notas).toBe('Entregado en mano al hijo del cliente')
    })

    it('las conserva también al revertir la entrega', async () => {
        await marcarPremioEntregado(GANADOR_ID, false)

        expect(db.sorteo_ganadores[0].entregado).toBe(false)
        expect(db.sorteo_ganadores[0].entregado_at).toBeNull()
        expect(db.sorteo_ganadores[0].notas).toBe('Entregado en mano al hijo del cliente')
    })

    it('las sobreescribe cuando sí se pasan', async () => {
        await marcarPremioEntregado(GANADOR_ID, true, '  Recogido en oficina  ')
        expect(db.sorteo_ganadores[0].notas).toBe('Recogido en oficina')
    })

    it('las borra explícitamente con una cadena vacía', async () => {
        await marcarPremioEntregado(GANADOR_ID, true, '   ')
        expect(db.sorteo_ganadores[0].notas).toBeNull()
    })
})
