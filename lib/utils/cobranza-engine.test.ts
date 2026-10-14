import { describe, it, expect } from 'vitest'
import { normalizarTelefono, fechaCorteValida, URGENCIA_ETAPA } from './cobranza-engine'

describe('normalizarTelefono', () => {
    it('reduce a la misma clave los formatos con que se escribe un número dominicano', () => {
        // En producción el mismo número aparece registrado en clientes
        // distintos con formatos distintos; si no casan, el anti-duplicado
        // por teléfono no ve que es la misma persona.
        const formatos = ['809-555-1234', '(809) 555 1234', '8095551234', '+1 809 555 1234', '18095551234']
        expect(new Set(formatos.map(normalizarTelefono))).toEqual(new Set(['8095551234']))
    })

    it('no confunde números de 10 cifras que empiezan por 1 con el prefijo de país', () => {
        expect(normalizarTelefono('1234567890')).toBe('1234567890')
    })

    it('devuelve null cuando no hay un número usable', () => {
        expect(normalizarTelefono(null)).toBeNull()
        expect(normalizarTelefono(undefined)).toBeNull()
        expect(normalizarTelefono('')).toBeNull()
        expect(normalizarTelefono('n/a')).toBeNull()
        expect(normalizarTelefono('12345')).toBeNull()
    })
})

describe('fechaCorteValida', () => {
    it('acepta fechas normales', () => {
        expect(fechaCorteValida('2026-10-15')).toBe(true)
        expect(fechaCorteValida('2025-01-31')).toBe(true)
    })

    it('rechaza el año mal tecleado que hay en producción (0026 en vez de 2026)', () => {
        // Con 0026-01-30 el motor calcula 730 742 días de atraso y la
        // plantilla de recuperación se lo dice al cliente.
        expect(fechaCorteValida('0026-01-30')).toBe(false)
        expect(fechaCorteValida('0026-12-30')).toBe(false)
    })

    it('rechaza años absurdos hacia adelante y lo que no es una fecha', () => {
        expect(fechaCorteValida('2226-01-30')).toBe(false)
        expect(fechaCorteValida('2026-02-31')).toBe(false)
        expect(fechaCorteValida('no-es-fecha')).toBe(false)
        expect(fechaCorteValida(null)).toBe(false)
    })
})

describe('URGENCIA_ETAPA', () => {
    it('ordena de menos a más urgente', () => {
        expect(URGENCIA_ETAPA.preventivo).toBeLessThan(URGENCIA_ETAPA.mora_temprana)
        expect(URGENCIA_ETAPA.mora_temprana).toBeLessThan(URGENCIA_ETAPA.mora_alta)
        expect(URGENCIA_ETAPA.mora_alta).toBeLessThan(URGENCIA_ETAPA.recuperacion)
    })
})
