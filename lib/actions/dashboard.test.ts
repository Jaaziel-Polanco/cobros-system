/**
 * ESTAS PRUEBAS FALLAN CON EL CÓDIGO ANTERIOR A LA CORRECCIÓN.
 *
 * Las dos lecturas del panel iban sin paginar y alimentan **cifras**:
 *
 *  - `deudas` activas → el `reduce` de la cartera total y los cuatro
 *    conteos por etapa. Un total de dinero calculado sobre una lista
 *    recortada no es un número aproximado: es un número falso, presentado
 *    en grande, que nadie va a cuestionar porque no viene con ningún aviso.
 *    769 deudas hoy; a partir de 1000 la cartera queda subestimada.
 *  - `envios_log` del día → "Enviados hoy" y el recuento de errores. El
 *    máximo histórico en un día es de 841: el margen es de un mal día.
 *
 * La comprobación importante no es el número de filas, es que el DINERO
 * cuadre. Por eso las deudas de abajo no valen todas lo mismo: las que el
 * recorte se comía valen mucho más que las demás, así que un total corto no
 * puede pasar por bueno "por poco".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { crearBaseFalsa, type Fila } from '@/lib/supabase/postgrest-falso'

const TOTAL_DEUDAS = 1200
const SALDO_NORMAL = 1000
const SALDO_GORDO = 500_000
const GORDAS_DESDE = 1000        // las que quedaban fuera del recorte

let db: Record<string, Fila[]> = {}
let maxRows = 1000

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => crearBaseFalsa(db, { get maxRows() { return maxRows } }),
}))

function deudas(): Fila[] {
    return Array.from({ length: TOTAL_DEUDAS }, (_, i) => ({
        id: `d-${String(i).padStart(5, '0')}`,
        estado: 'activo',
        pausado: false,
        etapa: i % 2 === 0 ? 'preventivo' : 'mora_alta',
        saldo_pendiente: i >= GORDAS_DESDE ? SALDO_GORDO : SALDO_NORMAL,
        monto_original: 1,
    }))
}

function envios(): Fila[] {
    const hoy = new Date().toISOString()
    return [
        ...Array.from({ length: 900 }, (_, i) => ({
            id: `e-${String(i).padStart(5, '0')}`, estado: 'enviado', sent_at: hoy,
        })),
        ...Array.from({ length: 200 }, (_, i) => ({
            id: `f-${String(i).padStart(5, '0')}`, estado: 'error', sent_at: hoy,
        })),
        // De ayer: no deben contarse.
        { id: 'z-1', estado: 'enviado', sent_at: '2020-01-01T00:00:00.000Z' },
    ]
}

beforeEach(() => {
    db = { deudas: deudas(), envios_log: envios() }
    maxRows = 1000
})

describe('getDashboardData', () => {
    it('la cartera total suma TODAS las deudas activas, no las 1000 primeras', async () => {
        const { getDashboardData } = await import('./dashboard')
        const stats = await getDashboardData()

        const esperado = GORDAS_DESDE * SALDO_NORMAL
            + (TOTAL_DEUDAS - GORDAS_DESDE) * SALDO_GORDO

        expect(stats.totalCartera).toBe(esperado)
        expect(stats.activas).toBe(TOTAL_DEUDAS)
    })

    it('los conteos por etapa cuadran con el total', async () => {
        const { getDashboardData } = await import('./dashboard')
        const { byEtapa } = await getDashboardData()

        expect(byEtapa.preventivo + byEtapa.mora_alta).toBe(TOTAL_DEUDAS)
        expect(byEtapa.preventivo).toBe(TOTAL_DEUDAS / 2)
    })

    it('cuenta los 1100 envíos del día, no los 1000 que cabían', async () => {
        const { getDashboardData } = await import('./dashboard')
        const stats = await getDashboardData()

        expect(stats.totalEnviosHoy).toBe(1100)
        expect(stats.enviados).toBe(900)
        expect(stats.erroresHoy).toBe(200)
    })

    it('ABORTA si el servidor recorta por debajo del tamaño de lote', async () => {
        // Para un panel, un error a la vista es preferible a una cartera
        // equivocada que nadie va a cuestionar.
        maxRows = 400
        const { getDashboardData } = await import('./dashboard')

        await expect(getDashboardData()).rejects.toThrow()
    })
})
