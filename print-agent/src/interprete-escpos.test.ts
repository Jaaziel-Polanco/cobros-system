import { describe, it, expect } from 'vitest'
import { interpretarEscPos } from './interprete-escpos'

// Comandos ESC/POS crudos, replicando lo que emite lib/escpos del servidor.
const ESC_INIT = Buffer.from([0x1b, 0x40])
const ESC_CODEPAGE_850 = Buffer.from([0x1b, 0x74, 0x02])
const ESC_ALINEAR = (n: number) => Buffer.from([0x1b, 0x61, n])
const ESC_TAMANO = (n: number) => Buffer.from([0x1b, 0x21, n])
const GS_CORTAR = Buffer.from([0x1d, 0x56, 0x00])
const SALTO = Buffer.from('\n')

function comandoQR(datos: string): Buffer {
    const bytes = Buffer.from(datos, 'utf8')
    const longitud = bytes.length + 3
    const pL = longitud & 0xff
    const pH = (longitud >> 8) & 0xff
    return Buffer.concat([
        Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
        Buffer.from([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
        bytes,
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
    ])
}

describe('interpretarEscPos', () => {
    it('decodifica texto en CP850, incluida la ñ', () => {
        // 0xa4 = 'ñ' en CP850
        const bytes = Buffer.concat([
            ESC_INIT, ESC_CODEPAGE_850,
            Buffer.from([0x4d, 0x75, 0xa4, 0x6f, 0x7a]), SALTO, // "Muñoz"
        ])
        const { lienzo } = interpretarEscPos(bytes, 20)
        expect(lienzo).toContain('Muñoz')
    })

    it('centra el texto cuando la alineación es 1', () => {
        const bytes = Buffer.concat([
            ESC_INIT, ESC_CODEPAGE_850, ESC_ALINEAR(1),
            Buffer.from('ABC'), SALTO,
        ])
        const { lienzo } = interpretarEscPos(bytes, 20)
        const linea = lienzo.split('\n').find(l => l.includes('ABC'))!
        // El texto no debe pegarse al borde izquierdo
        expect(linea.indexOf('ABC')).toBeGreaterThan(3)
    })

    it('marca el texto en negrita', () => {
        const bytes = Buffer.concat([
            ESC_INIT, ESC_CODEPAGE_850, ESC_TAMANO(0x08),
            Buffer.from('FUERTE'), SALTO,
        ])
        const { lienzo } = interpretarEscPos(bytes, 30)
        expect(lienzo).toContain('**FUERTE**')
    })

    it('duplica el ancho de los caracteres en tamaño doble', () => {
        const bytes = Buffer.concat([
            ESC_INIT, ESC_CODEPAGE_850, ESC_TAMANO(0x30),
            Buffer.from('X'), SALTO,
        ])
        const { lienzo } = interpretarEscPos(bytes, 30)
        expect(lienzo).toContain('XX')
    })

    it('detecta el corte de papel', () => {
        const bytes = Buffer.concat([ESC_INIT, Buffer.from('hola'), SALTO, GS_CORTAR])
        const { cortado, lienzo } = interpretarEscPos(bytes, 20)
        expect(cortado).toBe(true)
        expect(lienzo).toContain('corte')
    })

    it('extrae el contenido del código QR', () => {
        const bytes = Buffer.concat([
            ESC_INIT, comandoQR('http://192.168.1.50:3000/t/abc123'), SALTO,
        ])
        const { qrs, lienzo } = interpretarEscPos(bytes, 48)
        expect(qrs).toEqual(['http://192.168.1.50:3000/t/abc123'])
        expect(lienzo).toContain('[QR]')
        expect(lienzo).toContain('abc123')
    })

    it('no revienta con un flujo vacío', () => {
        expect(() => interpretarEscPos(Buffer.alloc(0), 48)).not.toThrow()
    })
})
