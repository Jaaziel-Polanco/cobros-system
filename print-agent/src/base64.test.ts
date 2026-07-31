import { describe, it, expect } from 'vitest'
import { decodificarBase64Estricto } from './base64'

describe('decodificarBase64Estricto', () => {
    it('descodifica un base64 válido', () => {
        const original = Buffer.from([0x1b, 0x40, 0x41, 0x42, 0xa4])
        const b64 = original.toString('base64')
        expect(decodificarBase64Estricto(b64)).toEqual(original)
    })

    it('rechaza caracteres fuera del alfabeto base64', () => {
        expect(decodificarBase64Estricto('QUJD!!!!')).toBeNull()
    })

    it('rechaza una longitud que no es múltiplo de 4', () => {
        expect(decodificarBase64Estricto('QUJDQQ')).toBeNull()
    })

    it('rechaza una cadena con bits de relleno no canónicos (mismo alfabeto y longitud, pero corrupta)', () => {
        // 'AB==' pasa el alfabeto y la longitud, pero los 4 bits de
        // relleno del último bloque no son cero: Buffer.from la
        // descodifica igual (byte 0x00) y la vuelve a codificar como
        // 'AA==', que no coincide con la cadena original. Es justo el
        // tipo de corrupción silenciosa que este chequeo existe para
        // atrapar antes de mandarla a la impresora.
        expect(decodificarBase64Estricto('AB==')).toBeNull()
    })

    it('rechaza cadena vacía, null, undefined y no-strings', () => {
        expect(decodificarBase64Estricto('')).toBeNull()
        expect(decodificarBase64Estricto(null)).toBeNull()
        expect(decodificarBase64Estricto(undefined)).toBeNull()
        expect(decodificarBase64Estricto(42)).toBeNull()
    })
})
