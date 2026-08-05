import { describe, it, expect } from 'vitest'
import { validarAnchoYCodepage, ANCHO_COLS_MIN, ANCHO_COLS_MAX } from './estaciones'

describe('validarAnchoYCodepage', () => {
    it('rechaza ancho_cols = 0 (Invalid array length en columnasEfectivas)', () => {
        expect(() => validarAnchoYCodepage(0, 'cp850')).toThrow()
    })

    it('rechaza ancho_cols = 4 (trunca el número del boleto)', () => {
        expect(() => validarAnchoYCodepage(4, 'cp850')).toThrow()
    })

    it(`rechaza ancho_cols = ${ANCHO_COLS_MIN - 1} (justo debajo del mínimo)`, () => {
        expect(() => validarAnchoYCodepage(ANCHO_COLS_MIN - 1, 'cp850')).toThrow()
    })

    it(`rechaza ancho_cols = ${ANCHO_COLS_MAX + 1} (justo sobre el máximo)`, () => {
        expect(() => validarAnchoYCodepage(ANCHO_COLS_MAX + 1, 'cp850')).toThrow()
    })

    it('rechaza un ancho no entero', () => {
        expect(() => validarAnchoYCodepage(48.5, 'cp850')).toThrow()
    })

    it(`acepta los límites ${ANCHO_COLS_MIN} y ${ANCHO_COLS_MAX}`, () => {
        expect(() => validarAnchoYCodepage(ANCHO_COLS_MIN, 'cp850')).not.toThrow()
        expect(() => validarAnchoYCodepage(ANCHO_COLS_MAX, 'cp850')).not.toThrow()
    })

    it('rechaza un codepage inventado', () => {
        expect(() => validarAnchoYCodepage(48, 'utf8-inventado')).toThrow()
    })

    it('acepta exactamente los 4 codepages de lib/escpos/codificacion.ts', () => {
        for (const cp of ['cp437', 'cp850', 'cp858', 'cp1252']) {
            expect(() => validarAnchoYCodepage(48, cp)).not.toThrow()
        }
    })
})
