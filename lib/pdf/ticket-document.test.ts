import { describe, it, expect } from 'vitest'
import { enmascararDocumento } from './ticket-document'

describe('enmascararDocumento', () => {
    it('deja visibles solo los dos últimos dígitos cuando no hay separadores', () => {
        expect(enmascararDocumento('40233459698')).toBe('*********98')
    })

    it('conserva los guiones en su posición y enmascara por dígitos, no por caracteres', () => {
        // Los dos últimos DÍGITOS son "7" y "8" (el "8" final es su propio
        // grupo de un solo dígito); los guiones no cuentan ni se mueven.
        expect(enmascararDocumento('001-1234567-8')).toBe('***-******7-8')
    })

    it('devuelve null para null, undefined o cadena vacía', () => {
        expect(enmascararDocumento(null)).toBeNull()
        expect(enmascararDocumento(undefined)).toBeNull()
        expect(enmascararDocumento('')).toBeNull()
    })

    it('funciona igual sin separadores (RNC de 9 dígitos, por ejemplo)', () => {
        expect(enmascararDocumento('130123456')).toBe('*******56')
    })

    it('con 2 dígitos o menos no hay nada que ocultar más allá de "los últimos dos": se devuelve tal cual', () => {
        // Comportamiento decidido explícitamente: enmascarar aquí no aportaría
        // privacidad (ya son los "últimos dos" completos) y además rompería
        // el formato original sin necesidad.
        expect(enmascararDocumento('12')).toBe('12')
        expect(enmascararDocumento('5')).toBe('5')
        expect(enmascararDocumento('1-2')).toBe('1-2')
    })
})
