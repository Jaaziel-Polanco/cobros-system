import { describe, it, expect } from 'vitest'
import { SEP, filasDeSalida, primeraLineaUtil } from './powershell'

/**
 * Lo que se prueba aquí es el ANÁLISIS de lo que escupe PowerShell, no
 * PowerShell. Es la parte que se rompe de verdad: en la PC de una tienda no
 * hay forma de ver qué salió mal, así que el análisis tiene que aguantar
 * salida sucia sin inventarse datos ni tirar la página entera.
 */

describe('filasDeSalida', () => {
    it('parte una línea normal en sus campos', () => {
        const salida = `P${SEP}POS${SEP}Normal${SEP}USB001${SEP}Generic / Text Only${SEP}1${SEP}0\n`
        expect(filasDeSalida(salida, 'P', 6)).toEqual([
            ['POS', 'Normal', 'USB001', 'Generic / Text Only', '1', '0'],
        ])
    })

    it('ignora el ruido que PowerShell mete alrededor', () => {
        // Un aviso de módulo, una línea en blanco, una tabla de otra cosa.
        const salida = [
            'AVISO: el módulo PrintManagement se cargó con retraso',
            '',
            `P${SEP}POS${SEP}Normal${SEP}USB001${SEP}Driver${SEP}0${SEP}0`,
            'Name       PrinterStatus',
            '----       -------------',
            `P${SEP}PDF${SEP}Normal${SEP}PORTPROMPT:${SEP}Driver${SEP}1${SEP}0`,
        ].join('\r\n')

        expect(filasDeSalida(salida, 'P', 6).map(f => f[0])).toEqual(['POS', 'PDF'])
    })

    it('descarta una fila a medias en vez de enseñarla incompleta', () => {
        // Media fila enseñada como si fuera entera es peor que una menos:
        // el controlador de una acabaría leyéndose como el puerto de otra.
        const salida = `P${SEP}POS${SEP}Normal\nP${SEP}PDF${SEP}Normal${SEP}p${SEP}d${SEP}0${SEP}0`
        expect(filasDeSalida(salida, 'P', 6).map(f => f[0])).toEqual(['PDF'])
    })

    it('NO recorta los campos: un espacio al final es el fallo que hay que ver', () => {
        // Windows distingue "POS " de "POS". Si el análisis limpiara los
        // espacios, el fallo más difícil de ver a ojo se volvería invisible
        // también aquí, que es el único sitio donde se podía cazar.
        const salida = `P${SEP}POS ${SEP}Normal${SEP}USB001${SEP}Driver${SEP}0${SEP}0`
        expect(filasDeSalida(salida, 'P', 6)[0][0]).toBe('POS ')
    })

    it('aguanta finales de línea de Windows y de Unix', () => {
        const fila = `P${SEP}A${SEP}Normal${SEP}p${SEP}d${SEP}0${SEP}0`
        expect(filasDeSalida(`${fila}\r\n${fila}\n${fila}`, 'P', 6)).toHaveLength(3)
    })

    it('no confunde marcas distintas', () => {
        const salida = `T${SEP}1${SEP}a${SEP}b${SEP}c${SEP}d${SEP}e${SEP}f\n`
            + `P${SEP}POS${SEP}Normal${SEP}p${SEP}d${SEP}0${SEP}0`
        expect(filasDeSalida(salida, 'P', 6)).toHaveLength(1)
        expect(filasDeSalida(salida, 'T', 7)).toHaveLength(1)
    })

    it('con una salida vacía devuelve una lista vacía, sin romperse', () => {
        expect(filasDeSalida('', 'P', 7)).toEqual([])
        expect(filasDeSalida('\r\n\r\n', 'P', 7)).toEqual([])
    })
})

describe('primeraLineaUtil', () => {
    it('se queda con el mensaje y tira el rastro de PowerShell', () => {
        const error = [
            'Get-Printer : No se encontró la impresora especificada.',
            'En línea: 1 Carácter: 1',
            '+ Get-Printer -Name POS',
            '+ ~~~~~~~~~~~~~~~~~~~~~',
            '    + CategoryInfo          : ObjectNotFound',
            '    + FullyQualifiedErrorId : ...',
        ].join('\r\n')

        expect(primeraLineaUtil(error)).toBe('Get-Printer : No se encontró la impresora especificada.')
    })

    it('devuelve vacío cuando no hay nada que decir', () => {
        expect(primeraLineaUtil('')).toBe('')
        expect(primeraLineaUtil('\n   \n')).toBe('')
    })
})
