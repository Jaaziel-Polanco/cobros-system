/**
 * ESTAS PRUEBAS FALLAN CON EL CÓDIGO ANTERIOR A LA CORRECCIÓN.
 *
 * `getDeudasConPagosPendientes()` tenía el mismo `select` de `pagos` sin
 * paginar que el cron: `.in('deuda_id', …)` ordenado por `created_at DESC`,
 * quedándose con la primera aparición de cada deuda. Recortado a 1000 filas
 * en silencio, se queda con los 1000 pagos más recientes del conjunto, no
 * con el último de cada deuda, y toda deuda cuyo último pago caiga fuera de
 * esa ventana desaparece del mapa.
 *
 * Aquí el efecto es que la deuda le aparece al agente en "pagos pendientes"
 * habiendo cobrado, y con `ultimoPago: null` — o sea, no como "pagó hace
 * tiempo" sino como si no hubiera pagado nunca.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { crearBaseFalsa, type Fila } from '@/lib/supabase/postgrest-falso'

const AGENTE = 'u-agente'
const CHARLATANAS = 20
const PAGOS_POR_CHARLATANA = 80
const DEUDA_QUE_PAGO = 'd-que-pago'
const DEUDA_MOROSA = 'd-morosa'

const haceDias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const enDias = (n: number) =>
    new Date(Date.now() + n * 86_400_000).toISOString().split('T')[0]

let db: Record<string, Fila[]> = {}
let maxRows = 1000

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/actions/envios', () => ({ intentarEnvioInmediato: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: AGENTE } } }) },
        ...crearBaseFalsa(db, { get maxRows() { return maxRows } }),
    }),
}))

function deuda(id: string): Fila {
    return {
        id,
        agente_id: AGENTE,
        estado: 'activo',
        pausado: false,
        etapa: 'preventivo',
        // Vence mañana: entra en la ventana de "próximo a vencer".
        fecha_corte: enDias(1),
        frecuencia_pago: 'mensual',
        cliente: null,
        agente: null,
        configuracion: { dias_antes_vencimiento: 3 },
    }
}

function datos(): Record<string, Fila[]> {
    const deudas = [
        ...Array.from({ length: CHARLATANAS }, (_, i) => deuda(`d-${String(i).padStart(3, '0')}`)),
        deuda(DEUDA_QUE_PAGO),
        deuda(DEUDA_MOROSA),
    ]

    const pagos: Fila[] = []
    let n = 0
    for (let d = 0; d < CHARLATANAS; d++) {
        for (let p = 0; p < PAGOS_POR_CHARLATANA; p++) {
            pagos.push({
                id: `p-${String(n++).padStart(6, '0')}`,
                deuda_id: `d-${String(d).padStart(3, '0')}`,
                created_at: haceDias(1 + p * 0.01),
            })
        }
    }
    // Pagó hace 10 días —dentro del umbral de 25 de la frecuencia mensual—
    // pero su pago queda fuera de la ventana de los 1000 más recientes.
    pagos.push({ id: 'p-999999', deuda_id: DEUDA_QUE_PAGO, created_at: haceDias(10) })

    return { deudas, pagos }
}

beforeEach(() => {
    db = datos()
    maxRows = 1000
})

describe('getDeudasConPagosPendientes', () => {
    it('NO lista como pendiente a quien pagó hace 10 días', async () => {
        const { getDeudasConPagosPendientes } = await import('./deudas')
        const pendientes = await getDeudasConPagosPendientes()

        expect(pendientes.map(d => d.id)).not.toContain(DEUDA_QUE_PAGO)
    })

    it('sí lista a la que nunca ha pagado', async () => {
        const { getDeudasConPagosPendientes } = await import('./deudas')
        const pendientes = await getDeudasConPagosPendientes()

        expect(pendientes.map(d => d.id)).toEqual([DEUDA_MOROSA])
    })

    it('ABORTA si el servidor recorta por debajo del tamaño de lote', async () => {
        maxRows = 400
        const { getDeudasConPagosPendientes } = await import('./deudas')

        await expect(getDeudasConPagosPendientes()).rejects.toThrow(/pagos/i)
    })
})
