import { describe, it, expect } from 'vitest'
import { centrar, linea, dosColumnas, envolver } from './formato'

describe('centrar', () => {
    it('centra un texto corto en 48 columnas', () => {
        const r = centrar('ABC', 48)
        expect(r.length).toBe(48)
        expect(r.trim()).toBe('ABC')
        expect(r.indexOf('A')).toBe(22)
    })

    it('no rompe un texto que ocupa exactamente el ancho', () => {
        expect(centrar('X'.repeat(48), 48)).toBe('X'.repeat(48))
    })

    it('recorta lo que no cabe', () => {
        expect(centrar('X'.repeat(60), 48).length).toBe(48)
    })
})

describe('linea', () => {
    it('produce 48 guiones', () => {
        expect(linea(48)).toBe('-'.repeat(48))
    })

    it('acepta otro carácter', () => {
        expect(linea(10, '=')).toBe('=========='.slice(0, 10))
    })
})

describe('dosColumnas', () => {
    it('pega la etiqueta a la izquierda y el valor a la derecha', () => {
        const r = dosColumnas('Cliente', 'Juan', 48)
        expect(r.length).toBe(48)
        expect(r.startsWith('Cliente')).toBe(true)
        expect(r.endsWith('Juan')).toBe(true)
    })

    it('recorta la izquierda cuando juntas no caben', () => {
        const r = dosColumnas('X'.repeat(40), 'Y'.repeat(20), 48)
        expect(r.length).toBe(48)
        expect(r.endsWith('Y'.repeat(20))).toBe(true)
    })
})

describe('envolver', () => {
    it('deja intacto lo que cabe en una línea', () => {
        expect(envolver('corto', 48)).toEqual(['corto'])
    })

    it('parte por palabras sin exceder el ancho', () => {
        const lineas = envolver('uno dos tres cuatro cinco seis', 10)
        for (const l of lineas) expect(l.length).toBeLessThanOrEqual(10)
        expect(lineas.join(' ')).toBe('uno dos tres cuatro cinco seis')
    })

    it('parte una palabra más larga que el ancho', () => {
        const lineas = envolver('X'.repeat(25), 10)
        expect(lineas).toEqual(['X'.repeat(10), 'X'.repeat(10), 'X'.repeat(5)])
    })

    it('devuelve una línea vacía para texto vacío', () => {
        expect(envolver('', 48)).toEqual([''])
    })
})
