/**
 * ESTAS PRUEBAS FALLAN CON EL CÓDIGO ANTERIOR A LA CORRECCIÓN.
 *
 * `enviarPendientesSinNotificacion()` cruzaba las deudas activas contra
 * `envios_log` para quedarse con las que nunca habían recibido nada:
 *
 *     .from('envios_log').select('deuda_id')
 *       .in('deuda_id', deudaIds).eq('tipo_destino', 'cliente')
 *     → Set(...) → "si NO estás en el conjunto, te mando"
 *
 * Filtrada así, en producción esa consulta devuelve **20 403 filas**,
 * cortadas a 1000 sin error ni cabecera. Y la lógica es por negación: un
 * conjunto recortado significa cientos de deudas que sí fueron notificadas
 * apareciendo como si nunca lo hubieran sido, y una segunda andanada de
 * WhatsApp a esos clientes. Es el único sitio del barrido donde el truncado
 * se traduce directamente en mensajes duplicados.
 *
 * Hoy no la llama nadie —está sin conectar—, y por eso no ha hecho daño.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { crearBaseFalsa, type Fila } from '@/lib/supabase/postgrest-falso'

const DEUDAS = 60
const ENVIOS_POR_DEUDA = 30      // 1770 filas: bien por encima del tope
const NUNCA_NOTIFICADA = 'd-virgen'

let db: Record<string, Fila[]> = {}
let maxRows = 1000

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => crearBaseFalsa(db, { get maxRows() { return maxRows } }),
}))

function datos(): Record<string, Fila[]> {
    const deudas: Fila[] = [
        ...Array.from({ length: DEUDAS }, (_, i) => ({
            id: `d-${String(i).padStart(3, '0')}`,
            estado: 'activo', pausado: false, etapa: 'mora_alta',
        })),
        { id: NUNCA_NOTIFICADA, estado: 'activo', pausado: false, etapa: 'mora_alta' },
    ]

    const envios_log: Fila[] = []
    let n = 0
    for (let d = 0; d < DEUDAS; d++) {
        for (let e = 0; e < ENVIOS_POR_DEUDA; e++) {
            envios_log.push({
                id: `e-${String(n++).padStart(6, '0')}`,
                deuda_id: `d-${String(d).padStart(3, '0')}`,
                tipo_destino: 'cliente',
            })
        }
    }
    return { deudas, envios_log }
}

/**
 * `fetch` sustituido por un espía que además revienta si alguien lo llama.
 * No hay ningún webhook en la base falsa, así que `intentarEnvioInmediato`
 * sale antes de llegar a la red; esto es el cinturón, por si eso cambiara.
 */
let espiaFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
    db = datos()
    maxRows = 1000
    espiaFetch = vi.fn(() => { throw new Error('La prueba no debe tocar la red') })
    vi.stubGlobal('fetch', espiaFetch)
})

afterEach(() => { vi.unstubAllGlobals() })

describe('enviarPendientesSinNotificacion', () => {
    it('sólo intenta escribir a la deuda que nunca recibió nada', async () => {
        // Con el código viejo, las 1770 filas de `envios_log` se recortaban a
        // 1000 y decenas de las 60 deudas ya notificadas quedaban fuera del
        // conjunto → segunda notificación a clientes que ya la tenían.
        // `enviados` cuenta los intentos, y con la lectura completa sólo
        // puede haber uno: la deuda virgen.
        const { enviarPendientesSinNotificacion } = await import('./envios')

        expect(await enviarPendientesSinNotificacion()).toEqual({ enviados: 1, errores: 0 })
    })

    it('ante una lectura incompleta no intenta NADA', async () => {
        // El fallo caro aquí es el mensaje duplicado, no el que falta: si la
        // lista de envíos previos no se puede leer entera, se aborta en vez
        // de escribir a ciegas.
        maxRows = 400
        const { enviarPendientesSinNotificacion } = await import('./envios')

        expect(await enviarPendientesSinNotificacion()).toEqual({ enviados: 0, errores: 0 })
        expect(espiaFetch).not.toHaveBeenCalled()
    })
})
