import { describe, it, expect } from 'vitest'
import { leerTodasLasFilas, TAMANO_LOTE } from './paginacion'

/**
 * Simulador de PostgREST con `max-rows`.
 *
 * La propiedad que importa reproducir, y la razón de ser de todo el helper:
 * cuando el servidor recorta, NO devuelve error ni cabecera. Devuelve menos
 * filas y `error: null`. Aquí ocurre exactamente eso.
 */
function servidor(filas: { id: string }[], maxRows = TAMANO_LOTE) {
    const ordenadas = [...filas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    let lotesPedidos = 0

    return {
        get lotesPedidos() { return lotesPedidos },
        lote(cursor: string | null, limite: number) {
            lotesPedidos++
            const restantes = cursor
                ? ordenadas.filter(f => f.id > cursor)
                : ordenadas
            const cuantas = Math.min(limite, maxRows)
            return Promise.resolve({ data: restantes.slice(0, cuantas), error: null })
        },
        contar() {
            return Promise.resolve({ count: ordenadas.length, error: null })
        },
    }
}

const filasDe = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(6, '0')}` }))

describe('leerTodasLasFilas', () => {
    it('trae las 2500 filas aunque el servidor recorte cada respuesta a 1000', async () => {
        const s = servidor(filasDe(2500))

        const filas = await leerTodasLasFilas({ etiqueta: 'prueba', lote: s.lote, contar: s.contar })

        expect(filas).toHaveLength(2500)
        expect(new Set(filas.map(f => f.id)).size).toBe(2500)
        // 1000 + 1000 + 500: el tercero llega corto y cierra el bucle
        expect(s.lotesPedidos).toBe(3)
    })

    it('devuelve las filas ordenadas por la clave a través de los lotes, no solo dentro de cada uno', async () => {
        const s = servidor(filasDe(2500))
        const filas = await leerTodasLasFilas({ etiqueta: 'prueba', lote: s.lote, contar: s.contar })
        const ids = filas.map(f => f.id)
        expect(ids).toEqual([...ids].sort())
    })

    it('no pide un segundo lote cuando todo cabe en el primero', async () => {
        const s = servidor(filasDe(12))
        const filas = await leerTodasLasFilas({ etiqueta: 'prueba', lote: s.lote, contar: s.contar })
        expect(filas).toHaveLength(12)
        expect(s.lotesPedidos).toBe(1)
    })

    it('tolera la tabla vacía', async () => {
        const s = servidor([])
        await expect(
            leerTodasLasFilas({ etiqueta: 'prueba', lote: s.lote, contar: s.contar }),
        ).resolves.toEqual([])
    })

    it('funciona en el límite exacto del tope del servidor', async () => {
        const s = servidor(filasDe(TAMANO_LOTE))
        const filas = await leerTodasLasFilas({ etiqueta: 'prueba', lote: s.lote, contar: s.contar })
        expect(filas).toHaveLength(TAMANO_LOTE)
        // El primer lote llega lleno: hay que preguntar otra vez para saber
        // que no hay más. Si no lo hiciera, 1000 filas exactas serían
        // indistinguibles de 1000 recortadas.
        expect(s.lotesPedidos).toBe(2)
    })

    // ── Las defensas contra el truncado silencioso ──

    it('FALLA RUIDOSAMENTE si el servidor recorta por debajo del tamaño de lote', async () => {
        // El caso que convierte la paginación por keyset en insuficiente por
        // sí sola: si `max-rows` baja a 400 y seguimos pidiendo lotes de 1000,
        // el primer lote llega "corto" y el bucle creería haber terminado.
        // Solo el contraste contra el conteo exacto lo detecta.
        const s = servidor(filasDe(2500), 400)

        await expect(
            leerTodasLasFilas({ etiqueta: 'los boletos', lote: s.lote, contar: s.contar }),
        ).rejects.toThrow(/Lectura incompleta de los boletos/)
    })

    it('no devuelve NUNCA un resultado parcial: prefiere lanzar', async () => {
        const s = servidor(filasDe(2500), 400)
        const resultado = await leerTodasLasFilas({
            etiqueta: 'x', lote: s.lote, contar: s.contar,
        }).catch(() => 'lanzó' as const)
        expect(resultado).toBe('lanzó')
    })

    it('falla si el conteo no cuadra con lo leído', async () => {
        const filas = filasDe(50)
        await expect(leerTodasLasFilas({
            etiqueta: 'x',
            lote: (cursor, limite) => Promise.resolve({
                data: (cursor ? filas.filter(f => f.id > cursor) : filas).slice(0, limite),
                error: null,
            }),
            contar: () => Promise.resolve({ count: 80, error: null }),
        })).rejects.toThrow(/se leyeron 50 filas pero la base dice que hay 80/)
    })

    it('reintenta cuando el desfase es transitorio y acaba devolviendo todo', async () => {
        const filas = filasDe(50)
        let vueltas = 0
        const resultado = await leerTodasLasFilas({
            etiqueta: 'x',
            lote: (cursor, limite) => Promise.resolve({
                data: (cursor ? filas.filter(f => f.id > cursor) : filas).slice(0, limite),
                error: null,
            }),
            contar: () => {
                vueltas++
                // El primer conteo no cuadra (escritura concurrente); el segundo sí.
                return Promise.resolve({ count: vueltas === 1 ? 51 : 50, error: null })
            },
        })
        expect(resultado).toHaveLength(50)
        expect(vueltas).toBe(2)
    })

    it('falla si el conteo no es exacto (count nulo)', async () => {
        await expect(leerTodasLasFilas({
            etiqueta: 'x',
            lote: () => Promise.resolve({ data: [], error: null }),
            contar: () => Promise.resolve({ count: null, error: null }),
        })).rejects.toThrow(/no devolvió un conteo exacto/)
    })

    it('falla si la clave de paginación no viene en las filas', async () => {
        // Un `select` que olvide la columna del cursor dejaría el cursor
        // clavado en null: el mismo primer lote una y otra vez.
        await expect(leerTodasLasFilas({
            etiqueta: 'x',
            clave: 'ticket_id',
            lote: () => Promise.resolve({ data: [{ otra_cosa: 1 }], error: null }),
            contar: () => Promise.resolve({ count: 1, error: null }),
        })).rejects.toThrow(/clave de paginación "ticket_id" no viene en las filas/)
    })

    it('falla si una fila llega dos veces (el orden no es estable)', async () => {
        await expect(leerTodasLasFilas({
            etiqueta: 'x',
            tamanoLote: 2,
            lote: () => Promise.resolve({ data: [{ id: 'a' }, { id: 'a' }], error: null }),
            contar: () => Promise.resolve({ count: 2, error: null }),
        })).rejects.toThrow(/llegó dos veces/)
    })

    it('propaga el error de la consulta con la etiqueta puesta', async () => {
        await expect(leerTodasLasFilas({
            etiqueta: 'los participantes',
            lote: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
            contar: () => Promise.resolve({ count: 0, error: null }),
        })).rejects.toThrow('No se pudo leer los participantes: boom')
    })

    it('propaga el error del conteo', async () => {
        await expect(leerTodasLasFilas({
            etiqueta: 'los participantes',
            lote: () => Promise.resolve({ data: [], error: null }),
            contar: () => Promise.resolve({ count: null, error: { message: 'sin permiso' } }),
        })).rejects.toThrow(/No se pudo contar los participantes[\s\S]*sin permiso/)
    })
})
