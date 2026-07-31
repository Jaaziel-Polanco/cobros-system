/**
 * ESTAS PRUEBAS FALLAN CON EL CÓDIGO ANTERIOR A LA CORRECCIÓN.
 *
 * `getClientes()` traía la lista de `/clientes` con un `select` sin paginar.
 * En producción hay 1326 clientes activos y PostgREST devolvía 1000, sin
 * error y sin aviso: **326 clientes no aparecían en la pantalla de
 * clientes**. Y como el `select` iba ordenado por `created_at DESC`, el
 * recorte no era aleatorio: se perdían siempre los más antiguos, que son
 * justamente los de cartera más vieja. Un cliente que no aparece no se
 * gestiona y no se cobra.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { crearBaseFalsa, type Fila } from '@/lib/supabase/postgrest-falso'

const TOTAL = 1326          // el número real de producción
const INACTIVOS = 40

let db: Record<string, Fila[]> = {}
let maxRows = 1000

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => crearBaseFalsa(db, { get maxRows() { return maxRows } }),
}))

/** `created_at` decreciente con el índice: el 0 es el más nuevo. */
const creado = (i: number) => new Date(Date.UTC(2020, 0, 1) + (TOTAL - i) * 86_400_000).toISOString()

function clientes(): Fila[] {
    const filas: Fila[] = Array.from({ length: TOTAL }, (_, i) => ({
        // `id` desordenado respecto a `created_at` a propósito: la clave de
        // paginación y el orden de pantalla son cosas distintas, y la
        // prueba no debe pasar por coincidencia entre las dos.
        id: `c-${String((i * 7919) % TOTAL).padStart(5, '0')}-${i}`,
        nombre: `ZZTEST_${i}`,
        activo: true,
        created_at: creado(i),
    }))
    for (let i = 0; i < INACTIVOS; i++) {
        filas.push({ id: `x-${i}`, nombre: 'ZZTEST_inactivo', activo: false, created_at: creado(0) })
    }
    return filas
}

beforeEach(() => {
    db = { clientes: clientes() }
    maxRows = 1000
})

describe('getClientes', () => {
    it('devuelve los 1326 clientes activos, no los 1000 que cabían', async () => {
        const { getClientes } = await import('./clientes')

        expect((await getClientes()).length).toBe(TOTAL)
    })

    it('no cuela los inactivos', async () => {
        const { getClientes } = await import('./clientes')

        expect((await getClientes()).every(c => c.activo === true)).toBe(true)
    })

    it('mantiene el orden de pantalla: el más reciente primero', async () => {
        // Se pagina por `id`, así que las filas llegan en orden de `id`. El
        // orden de negocio se aplica sobre la lista ya completa; ordenar
        // cada lote por separado no ordenaría el conjunto.
        const { getClientes } = await import('./clientes')
        const lista = await getClientes()

        expect(lista[0].nombre).toBe('ZZTEST_0')
        expect(lista[TOTAL - 1].nombre).toBe(`ZZTEST_${TOTAL - 1}`)
        for (let i = 1; i < lista.length; i++) {
            expect(Date.parse(lista[i - 1].created_at)).toBeGreaterThanOrEqual(
                Date.parse(lista[i].created_at),
            )
        }
    })

    it('ABORTA si el servidor recorta por debajo del tamaño de lote', async () => {
        maxRows = 400
        const { getClientes } = await import('./clientes')

        await expect(getClientes()).rejects.toThrow(/clientes activos/i)
    })
})
