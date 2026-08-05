/**
 * ESTAS PRUEBAS FALLAN CON EL CÓDIGO ANTERIOR A LA CORRECCIÓN.
 *
 * El código viejo, repetido en el cron de recordatorios y en
 * `getDeudasConPagosPendientes`, era:
 *
 *     .from('pagos').select('deuda_id, created_at')
 *       .in('deuda_id', deudaIds)
 *       .order('created_at', { ascending: false })
 *     → quedarse con la primera aparición de cada deuda_id
 *
 * Correcto sobre una respuesta completa. El problema es que PostgREST
 * recorta a 1000 filas sin error ni cabecera, y con ese `order` se queda con
 * los 1000 pagos más recientes DEL CONJUNTO ENTERO. Una deuda cuyo último
 * pago sea más antiguo que el pago nº 1000 no sale "con fecha vieja": no
 * sale. Y "no sale del mapa" significa, aguas abajo, **no ha pagado nunca**.
 *
 * El escenario de abajo es el de producción en miniatura: muchos pagos
 * recientes de unas pocas deudas acaparando el cupo, y una deuda que pagó
 * ayer pero cuyo pago queda fuera de la ventana.
 */
import { describe, it, expect } from 'vitest'
import { crearBaseFalsa, type Fila } from './postgrest-falso'
import { leerUltimoPagoPorDeuda, type ClienteLector } from './ultimo-pago'

const DEUDAS_CHARLATANAS = 20
const PAGOS_POR_CHARLATANA = 80        // 1600 pagos recientes: llenan el cupo
const DEUDA_SILENCIOSA = 'd-silenciosa'

const iso = (dia: number) => new Date(Date.UTC(2026, 0, dia)).toISOString()

/**
 * 1600 pagos recientes repartidos entre 20 deudas + 1 pago único, más
 * antiguo que todos ellos, de una deuda que sí pagó. Total: 1601 filas,
 * por encima del tope de 1000.
 */
function pagos(): Fila[] {
    const filas: Fila[] = []
    let n = 0
    for (let d = 0; d < DEUDAS_CHARLATANAS; d++) {
        for (let p = 0; p < PAGOS_POR_CHARLATANA; p++) {
            filas.push({
                id: `p-${String(n++).padStart(6, '0')}`,
                deuda_id: `d-${String(d).padStart(3, '0')}`,
                // Días 100 en adelante: todos más recientes que el silencioso.
                created_at: iso(100 + p),
            })
        }
    }
    filas.push({
        id: 'p-999999',
        deuda_id: DEUDA_SILENCIOSA,
        created_at: iso(1),   // el más antiguo de todos
    })
    return filas
}

const TODAS_LAS_DEUDAS = [
    ...Array.from({ length: DEUDAS_CHARLATANAS }, (_, d) => `d-${String(d).padStart(3, '0')}`),
    DEUDA_SILENCIOSA,
    'd-sin-pagos',
]

const cliente = (db: Record<string, Fila[]>, maxRows?: number) =>
    crearBaseFalsa(db, { maxRows }) as unknown as ClienteLector

describe('leerUltimoPagoPorDeuda', () => {
    it('encuentra el último pago de una deuda aunque queden 1601 pagos por delante', async () => {
        // Con el código viejo esta deuda NO aparecía en el mapa: su único
        // pago es el más antiguo de los 1601 y el corte se queda con los
        // 1000 más recientes. Aguas abajo se leía como "no ha pagado".
        const mapa = await leerUltimoPagoPorDeuda(cliente({ pagos: pagos() }), TODAS_LAS_DEUDAS)

        expect(mapa.get(DEUDA_SILENCIOSA)).toBe(iso(1))
    })

    it('no pierde ninguna de las deudas que tienen pagos', async () => {
        const mapa = await leerUltimoPagoPorDeuda(cliente({ pagos: pagos() }), TODAS_LAS_DEUDAS)

        // 20 charlatanas + la silenciosa. Con el código viejo salían menos.
        expect(mapa.size).toBe(DEUDAS_CHARLATANAS + 1)
    })

    it('devuelve el pago MÁS RECIENTE de cada deuda, no uno cualquiera', async () => {
        // La paginación por keyset trae las filas ordenadas por `id`, no por
        // fecha: si el mapa se llenara con "la primera que llegue" —como
        // hacía el código viejo, que se fiaba del `order` de PostgREST— se
        // quedaría con el pago más antiguo. Se compara fecha a fecha.
        const mapa = await leerUltimoPagoPorDeuda(cliente({ pagos: pagos() }), TODAS_LAS_DEUDAS)

        const ultimoEsperado = iso(100 + PAGOS_POR_CHARLATANA - 1)
        for (let d = 0; d < DEUDAS_CHARLATANAS; d++) {
            expect(mapa.get(`d-${String(d).padStart(3, '0')}`)).toBe(ultimoEsperado)
        }
    })

    it('las deudas sin ningún pago siguen sin aparecer en el mapa', async () => {
        const mapa = await leerUltimoPagoPorDeuda(cliente({ pagos: pagos() }), TODAS_LAS_DEUDAS)

        expect(mapa.has('d-sin-pagos')).toBe(false)
    })

    it('no hace ninguna consulta si no hay deudas', async () => {
        const mapa = await leerUltimoPagoPorDeuda(cliente({ pagos: pagos() }), [])

        expect(mapa.size).toBe(0)
    })

    it('ABORTA si el servidor recorta por debajo del tamaño de lote', async () => {
        // La defensa que de verdad cierra el agujero: si `max-rows` cayera
        // por debajo del lote, el primer lote llegaría corto y un bucle
        // ingenuo terminaría creyendo haber leído todo. El contraste contra
        // el conteo exacto lo impide. Prefiere lanzar a devolver un mapa
        // parcial, porque un mapa parcial aquí manda WhatsApp de cobro a
        // gente que ya pagó.
        await expect(
            leerUltimoPagoPorDeuda(cliente({ pagos: pagos() }, 400), TODAS_LAS_DEUDAS),
        ).rejects.toThrow(/pagos/i)
    })
})
