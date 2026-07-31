import { describe, it, expect } from 'vitest'
import {
    mulberry32,
    hashSemilla,
    barajarDeterminista,
    calcularPoolHash,
    seleccionarGanadores,
    ALGORITMO_SORTEO,
    type TicketParticipante,
} from './sorteo'

/** Genera un pool de prueba: `porCliente` boletos para cada uno de `clientes`. */
function pool(clientes: number, porCliente = 1): TicketParticipante[] {
    const items: TicketParticipante[] = []
    let n = 1
    for (let c = 1; c <= clientes; c++) {
        for (let k = 0; k < porCliente; k++) {
            items.push({ id: `t${n}`, numero: n, cliente_id: `c${c}` })
            n++
        }
    }
    return items
}

describe('ALGORITMO_SORTEO', () => {
    it('está versionado', () => {
        expect(ALGORITMO_SORTEO).toBe('mulberry32-fisher-yates-v1')
    })
})

describe('mulberry32', () => {
    it('produce la misma secuencia con la misma semilla', () => {
        const a = mulberry32(12345)
        const b = mulberry32(12345)
        const sa = [a(), a(), a(), a(), a()]
        const sb = [b(), b(), b(), b(), b()]
        expect(sa).toEqual(sb)
    })

    it('produce secuencias distintas con semillas distintas', () => {
        const a = mulberry32(1)
        const b = mulberry32(2)
        expect([a(), a(), a()]).not.toEqual([b(), b(), b()])
    })

    it('devuelve valores en el intervalo [0, 1)', () => {
        const r = mulberry32(999)
        for (let i = 0; i < 1000; i++) {
            const v = r()
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThan(1)
        }
    })
})

describe('hashSemilla', () => {
    it('es determinista', () => {
        expect(hashSemilla('abc')).toBe(hashSemilla('abc'))
    })

    it('distingue textos distintos', () => {
        expect(hashSemilla('abc')).not.toBe(hashSemilla('abd'))
    })

    it('devuelve un entero sin signo de 32 bits', () => {
        const h = hashSemilla('cualquier-cosa')
        expect(Number.isInteger(h)).toBe(true)
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThanOrEqual(0xffffffff)
    })
})

describe('barajarDeterminista', () => {
    it('conserva todos los elementos', () => {
        const items = [1, 2, 3, 4, 5, 6, 7, 8]
        const r = barajarDeterminista(items, mulberry32(7))
        expect([...r].sort((a, b) => a - b)).toEqual(items)
    })

    it('no muta el arreglo original', () => {
        const items = [1, 2, 3, 4, 5]
        barajarDeterminista(items, mulberry32(7))
        expect(items).toEqual([1, 2, 3, 4, 5])
    })

    it('da el mismo resultado con la misma semilla', () => {
        const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        expect(barajarDeterminista(items, mulberry32(42)))
            .toEqual(barajarDeterminista(items, mulberry32(42)))
    })

    it('realmente reordena con un pool grande', () => {
        const items = Array.from({ length: 100 }, (_, i) => i)
        expect(barajarDeterminista(items, mulberry32(3))).not.toEqual(items)
    })
})

describe('calcularPoolHash', () => {
    it('no depende del orden de entrada', () => {
        expect(calcularPoolHash(['b', 'a', 'c'])).toBe(calcularPoolHash(['a', 'b', 'c']))
    })

    it('cambia si cambia el conjunto', () => {
        expect(calcularPoolHash(['a', 'b'])).not.toBe(calcularPoolHash(['a', 'b', 'c']))
    })

    it('devuelve un SHA-256 en hexadecimal', () => {
        expect(calcularPoolHash(['a'])).toMatch(/^[0-9a-f]{64}$/)
    })
})

describe('seleccionarGanadores', () => {
    it('devuelve exactamente la cantidad pedida', () => {
        const r = seleccionarGanadores(pool(50), 5, 'semilla-fija')
        expect(r.ganadores).toHaveLength(5)
        expect(r.ganadoresInsuficientes).toBe(false)
    })

    it('es reproducible: misma semilla, mismos ganadores', () => {
        const p = pool(50)
        const a = seleccionarGanadores(p, 5, 'semilla-fija')
        const b = seleccionarGanadores(p, 5, 'semilla-fija')
        expect(a.ganadores.map(g => g.id)).toEqual(b.ganadores.map(g => g.id))
        expect(a.orden).toEqual(b.orden)
    })

    it('cambia el resultado con otra semilla', () => {
        const p = pool(50)
        const a = seleccionarGanadores(p, 5, 'semilla-A')
        const b = seleccionarGanadores(p, 5, 'semilla-B')
        expect(a.ganadores.map(g => g.id)).not.toEqual(b.ganadores.map(g => g.id))
    })

    it('no depende del orden en que llegue el pool', () => {
        // Determinismo real: el resultado se ancla al número de boleto, no a
        // cómo la base de datos devolvió las filas.
        const p = pool(30)
        const desordenado = [...p].reverse()
        const a = seleccionarGanadores(p, 4, 'semilla-fija')
        const b = seleccionarGanadores(desordenado, 4, 'semilla-fija')
        expect(a.ganadores.map(g => g.id)).toEqual(b.ganadores.map(g => g.id))
    })

    it('nunca premia dos veces al mismo cliente', () => {
        // 10 clientes con 20 boletos cada uno: sin la regla, habría repetidos
        const r = seleccionarGanadores(pool(10, 20), 10, 'semilla-fija')
        const clientes = r.ganadores.map(g => g.cliente_id)
        expect(new Set(clientes).size).toBe(clientes.length)
    })

    it('avisa cuando hay menos clientes distintos que premios', () => {
        const r = seleccionarGanadores(pool(3, 10), 5, 'semilla-fija')
        expect(r.ganadores).toHaveLength(3)
        expect(r.ganadoresInsuficientes).toBe(true)
    })

    it('maneja un pool vacío sin lanzar', () => {
        const r = seleccionarGanadores([], 3, 'semilla-fija')
        expect(r.ganadores).toEqual([])
        expect(r.poolCount).toBe(0)
        expect(r.ganadoresInsuficientes).toBe(true)
    })

    it('registra el orden de todos los participantes exactamente una vez', () => {
        const p = pool(20)
        const r = seleccionarGanadores(p, 3, 'semilla-fija')

        expect(r.orden).toHaveLength(20)
        expect(new Set(r.orden.map(o => o.ticketId)).size).toBe(20)
        expect([...r.orden.map(o => o.orden)].sort((a, b) => a - b))
            .toEqual(Array.from({ length: 20 }, (_, i) => i))
    })

    it('los ganadores son los primeros elegibles del barajado', () => {
        const p = pool(20)
        const r = seleccionarGanadores(p, 3, 'semilla-fija')

        const posiciones = new Map(r.orden.map(o => [o.ticketId, o.orden]))
        const posGanadores = r.ganadores.map(g => posiciones.get(g.id)!)

        // Están en orden ascendente de posición
        expect(posGanadores).toEqual([...posGanadores].sort((a, b) => a - b))
    })

    it('calcula el hash y el conteo del pool', () => {
        const p = pool(15)
        const r = seleccionarGanadores(p, 2, 'semilla-fija')
        expect(r.poolCount).toBe(15)
        expect(r.poolHash).toBe(calcularPoolHash(p.map(t => t.id)))
    })

    it('rechaza una cantidad de ganadores no positiva', () => {
        expect(() => seleccionarGanadores(pool(10), 0, 's')).toThrow()
        expect(() => seleccionarGanadores(pool(10), -1, 's')).toThrow()
    })

    it('rechaza una semilla vacía', () => {
        expect(() => seleccionarGanadores(pool(10), 1, '')).toThrow()
    })
})
