import { describe, it, expect } from 'vitest'
import { aBytes, CODEPAGES } from './codificacion'

describe('CODEPAGES', () => {
    it('define cp850 con su selector ESC t', () => {
        expect(CODEPAGES.cp850).toEqual({ escT: 2, iconv: 'cp850' })
    })
})

describe('aBytes', () => {
    it('codifica ASCII sin cambios', () => {
        expect(aBytes('HOLA', 'cp850')).toEqual(Buffer.from([0x48, 0x4f, 0x4c, 0x41]))
    })

    it('codifica la eñe minúscula como 0xA4 en CP850', () => {
        // Sin esto, la impresora recibiría UTF-8 (0xC3 0xB1) e imprimiría basura
        expect(aBytes('ñ', 'cp850')).toEqual(Buffer.from([0xa4]))
    })

    it('codifica la eñe mayúscula como 0xA5 en CP850', () => {
        expect(aBytes('Ñ', 'cp850')).toEqual(Buffer.from([0xa5]))
    })

    it('codifica la a acentuada como 0xA0 en CP850', () => {
        expect(aBytes('á', 'cp850')).toEqual(Buffer.from([0xa0]))
    })

    it('codifica un apellido real completo, byte a byte', () => {
        // "Muñoz García" en CP850: la ñ es 0xA4 y la í es 0xA1.
        // Se compara el buffer entero, no solo la presencia de esos dos
        // bytes: así la prueba también detecta que se corrompa cualquier
        // otro carácter, o que cambie la longitud.
        expect(aBytes('Muñoz García', 'cp850')).toEqual(Buffer.from([
            0x4d, 0x75, 0xa4, 0x6f, 0x7a, 0x20,
            0x47, 0x61, 0x72, 0x63, 0xa1, 0x61,
        ]))
    })

    it('quita los diacríticos de los caracteres que el codepage no admite', () => {
        // 'ā' (macrón) no existe en CP850: debe caer a 'a', no a '?'
        expect(aBytes('ā', 'cp850')).toEqual(Buffer.from([0x61]))
    })

    it('sustituye por ? lo que no se puede representar de ninguna forma', () => {
        expect(aBytes('😀', 'cp850').toString('latin1')).toContain('?')
    })

    it('cae a cp850 si le pasan un codepage desconocido', () => {
        expect(aBytes('ñ', 'inexistente')).toEqual(Buffer.from([0xa4]))
    })
})
