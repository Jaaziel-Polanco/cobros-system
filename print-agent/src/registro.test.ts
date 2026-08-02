import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
    LINEAS_MAXIMAS, VENTANA_BYTES, leerFinalDelRegistro, nombreDeDescarga, ultimasLineas,
} from './registro'

let carpeta: string
let ruta: string

beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-log-'))
    ruta = path.join(carpeta, 'agente.log')
})
afterEach(() => { fs.rmSync(carpeta, { recursive: true, force: true }) })

describe('ultimasLineas', () => {
    it('se queda con el final, que es lo que interesa de un registro', () => {
        expect(ultimasLineas('a\nb\nc\nd', 2)).toEqual(['c', 'd'])
    })

    it('no se queja si se piden más líneas de las que hay', () => {
        expect(ultimasLineas('a\nb', 50)).toEqual(['a', 'b'])
    })

    it('quita el salto final del archivo en vez de enseñar una línea vacía', () => {
        expect(ultimasLineas('a\nb\n', 10)).toEqual(['a', 'b'])
        expect(ultimasLineas('a\r\nb\r\n', 10)).toEqual(['a', 'b'])
    })

    it('descarta la primera línea cuando el texto viene cortado por el principio', () => {
        // Al leer solo el final del archivo, esa primera línea casi siempre
        // está partida por la mitad: media línea de registro enseñada como
        // si fuera entera confunde más de lo que informa.
        expect(ultimasLineas('SO Trabajo x impreso\nb\nc', 10, true)).toEqual(['b', 'c'])
        expect(ultimasLineas('a\nb\nc', 10, false)).toEqual(['a', 'b', 'c'])
    })

    it('con el texto vacío no devuelve una línea fantasma', () => {
        expect(ultimasLineas('', 10)).toEqual([])
    })
})

describe('leerFinalDelRegistro', () => {
    it('devuelve las últimas líneas y el tamaño real del archivo', async () => {
        fs.writeFileSync(ruta, 'uno\ndos\ntres\n', 'utf8')
        const r = await leerFinalDelRegistro(ruta, 2)

        expect(r.existe).toBe(true)
        expect(r.lineas).toEqual(['dos', 'tres'])
        expect(r.bytes).toBe(fs.statSync(ruta).size)
        expect(r.hayMas).toBe(false)
    })

    it('con el archivo ausente no lanza: no hay registro y punto', async () => {
        const r = await leerFinalDelRegistro(path.join(carpeta, 'no-existe.log'))
        expect(r).toEqual({ existe: false, bytes: 0, lineas: [], hayMas: false })
    })

    it('NO lee el archivo entero cuando es grande', async () => {
        // El registro rota a los 5 MB. Cargarlo en memoria para enseñar 200
        // líneas es tirar tiempo del proceso que tiene que estar imprimiendo.
        const relleno = 'x'.repeat(200)
        const lineas: string[] = []
        for (let i = 0; i < 4_000; i++) lineas.push(`linea ${i} ${relleno}`)
        fs.writeFileSync(ruta, lineas.join('\n') + '\n', 'utf8')

        const r = await leerFinalDelRegistro(ruta, 5)

        expect(fs.statSync(ruta).size).toBeGreaterThan(VENTANA_BYTES)
        expect(r.hayMas).toBe(true)
        expect(r.lineas[r.lineas.length - 1]).toContain('linea 3999')
        expect(r.lineas).toHaveLength(5)
    })

    it('un archivo vacío no es un error', async () => {
        fs.writeFileSync(ruta, '', 'utf8')
        const r = await leerFinalDelRegistro(ruta)
        expect(r.existe).toBe(true)
        expect(r.lineas).toEqual([])
    })

    it('no deja que un número disparatado de líneas se convierta en un problema', async () => {
        fs.writeFileSync(ruta, 'uno\ndos\n', 'utf8')
        const r = await leerFinalDelRegistro(ruta, 999_999_999)
        expect(r.lineas).toEqual(['uno', 'dos'])
        expect(LINEAS_MAXIMAS).toBeLessThan(999_999_999)
    })
})

describe('nombreDeDescarga', () => {
    it('lleva la fecha dentro: en el chat de soporte acaban quince', () => {
        const nombre = nombreDeDescarga(new Date(2026, 7, 2, 9, 5))
        expect(nombre).toBe('agente-20260802-0905.log')
    })
})
