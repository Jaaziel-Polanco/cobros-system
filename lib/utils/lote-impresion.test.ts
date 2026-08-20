import { describe, it, expect } from 'vitest'
import {
    resolverObjetivoDelLote, destinoDelBoleto, MAX_IDS_RECIBIDOS,
} from './lote-impresion'

const DEL_SORTEO = new Set(['a', 'b', 'c'])

describe('resolverObjetivoDelLote', () => {

    describe('el cruce que impide imprimir boletos ajenos', () => {
        /**
         * La prueba que justifica que esta función exista. Los trabajos se
         * insertan con el cliente admin, sin RLS: si un id inventado en la
         * petición llegara hasta el INSERT, saldría por la impresora el
         * boleto de un cliente de otra cartera.
         */
        it('descarta los ids que no pertenecen al sorteo', () => {
            const objetivo = resolverObjetivoDelLote(DEL_SORTEO, {
                modo: 'seleccion',
                ticketIds: ['a', 'ajeno-de-otra-cartera', 'c'],
            })
            expect(objetivo.sort()).toEqual(['a', 'c'])
            expect(objetivo).not.toContain('ajeno-de-otra-cartera')
        })

        it('devuelve vacío si NINGUNO de los ids es del sorteo', () => {
            expect(resolverObjetivoDelLote(DEL_SORTEO, {
                modo: 'seleccion',
                ticketIds: ['x', 'y', 'z'],
            })).toEqual([])
        })

        it('no se deja engañar por un id vacío o raro', () => {
            expect(resolverObjetivoDelLote(DEL_SORTEO, {
                modo: 'seleccion',
                ticketIds: ['', '   ', 'A'],
            })).toEqual([])
        })
    })

    describe('duplicados', () => {
        it('un id repetido encola un solo trabajo', () => {
            // Sin deduplicar, el mismo boleto saldría dos veces en papel y
            // el resumen mentiría sobre cuántos se encolaron.
            expect(resolverObjetivoDelLote(DEL_SORTEO, {
                modo: 'seleccion',
                ticketIds: ['a', 'a', 'a', 'b'],
            }).sort()).toEqual(['a', 'b'])
        })
    })

    describe('modo todos', () => {
        it('ignora por completo lo que mande el navegador', () => {
            // No hay `ticketIds` en este modo justamente para que «todos»
            // no pueda significar «los que el navegador tenía cargados».
            expect(resolverObjetivoDelLote(DEL_SORTEO, { modo: 'todos' }).sort())
                .toEqual(['a', 'b', 'c'])
        })

        it('devuelve vacío si el sorteo no tiene boletos', () => {
            expect(resolverObjetivoDelLote(new Set(), { modo: 'todos' })).toEqual([])
        })
    })

    describe('tope de seguridad', () => {
        it('rechaza una petición absurdamente grande', () => {
            const muchos = Array.from({ length: MAX_IDS_RECIBIDOS + 1 }, (_, i) => `id-${i}`)
            expect(() => resolverObjetivoDelLote(DEL_SORTEO, {
                modo: 'seleccion', ticketIds: muchos,
            })).toThrow(/Demasiados boletos/)
        })

        it('acepta justo el tope', () => {
            const justos = Array.from({ length: MAX_IDS_RECIBIDOS }, (_, i) => `id-${i}`)
            expect(() => resolverObjetivoDelLote(DEL_SORTEO, {
                modo: 'seleccion', ticketIds: justos,
            })).not.toThrow()
        })
    })
})

describe('destinoDelBoleto', () => {
    it('encola sin marca un boleto nunca impreso', () => {
        expect(destinoDelBoleto({ anulado: false, enCola: false, vecesImpreso: 0 }))
            .toBe('encolar')
    })

    it('marca como copia lo que ya se imprimió', () => {
        // Es el caso normal al reimprimir un sorteo entero: el boleto se
        // imprime al emitirse, así que veces_impreso ya es 1.
        expect(destinoDelBoleto({ anulado: false, enCola: false, vecesImpreso: 1 }))
            .toBe('copia')
    })

    it('salta lo que ya está en cola', () => {
        expect(destinoDelBoleto({ anulado: false, enCola: true, vecesImpreso: 0 }))
            .toBe('ya-en-cola')
    })

    it('salta los anulados', () => {
        expect(destinoDelBoleto({ anulado: true, enCola: false, vecesImpreso: 0 }))
            .toBe('anulado')
    })

    it('un anulado que además está en cola cuenta como anulado, no dos veces', () => {
        // Si contara por las dos, el resumen sumaría más boletos de los que
        // hay y nadie podría cuadrar el papel con la pantalla.
        expect(destinoDelBoleto({ anulado: true, enCola: true, vecesImpreso: 3 }))
            .toBe('anulado')
    })
})
