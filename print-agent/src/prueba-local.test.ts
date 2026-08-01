import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import { codificar, construirTirillaPrueba } from './prueba-local'
import type { DestinoImpresora } from './tipos'

const WINDOWS: DestinoImpresora = { tipo_conexion: 'windows', ip: null, port: 9100, nombre: 'POS' }
const RED: DestinoImpresora = { tipo_conexion: 'red', ip: '10.0.0.5', port: 9100, nombre: null }

describe('codificar — sin dependencias en tiempo de ejecución', () => {
    // La tabla del agente se escribió a mano para no arrastrar iconv-lite a
    // producción. Estas pruebas la contrastan con iconv-lite, que sí está
    // disponible al desarrollar: si alguien toca la tabla y se equivoca en
    // un byte, aquí salta.
    for (const [nuestro, suyo] of [['cp850', 'cp850'], ['cp437', 'cp437'], ['cp858', 'cp858'], ['cp1252', 'win1252']]) {
        it(`coincide con iconv-lite en ${nuestro} para el castellano`, () => {
            const texto = 'Muñoz Peña áéíóú ñÑ üÜ ¿? ¡! Ç ç'
            expect(codificar(texto, nuestro)).toEqual(iconv.encode(texto, suyo))
        })
    }

    it('coincide también en las mayúsculas acentuadas donde la tabla las tiene', () => {
        for (const cp of ['cp850', 'cp858', 'cp1252']) {
            const suyo = cp === 'cp1252' ? 'win1252' : cp
            expect(codificar('ÁÉÍÓÚ', cp)).toEqual(iconv.encode('ÁÉÍÓÚ', suyo))
        }
    })

    it('en cp437, que no tiene Á Í Ó Ú, las degrada a la letra sin tilde', () => {
        // Igual que hace el servidor: mejor "MARIA" que un carácter basura.
        expect(codificar('ÁÍÓÚ', 'cp437').toString('latin1')).toBe('AIOU')
        expect(codificar('É', 'cp437')).toEqual(Buffer.from([0x90]))
    })

    it('NUNCA emite UTF-8: la impresora lee un byte por carácter', () => {
        // Con Buffer.from('ñ') saldrían 2 bytes y en el papel se leería "Ã±".
        expect(codificar('ñ', 'cp850')).toHaveLength(1)
        expect(codificar('Muñoz', 'cp850')).toHaveLength(5)
    })

    it('lo que no cabe en ninguna tabla acaba en "?", no en basura', () => {
        expect(codificar('日本', 'cp850')).toEqual(Buffer.from([0x3f, 0x3f]))
    })
})

describe('construirTirillaPrueba', () => {
    it('empieza inicializando la impresora y termina cortando el papel', () => {
        const { bytes } = construirTirillaPrueba({
            estacion: 'Caja 1', sucursal: 'Santiago', destino: WINDOWS,
            cols: 48, codepage: 'cp850',
        })

        expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]))         // ESC @
        expect(bytes.subarray(2, 5)).toEqual(Buffer.from([0x1b, 0x74, 2]))      // ESC t 2 (cp850)
        expect(bytes.subarray(-3)).toEqual(Buffer.from([0x1d, 0x56, 0x00]))     // GS V 0
    })

    it('selecciona la tabla de caracteres que dijo el servidor, no una fija', () => {
        const cp437 = construirTirillaPrueba({
            estacion: null, sucursal: null, destino: WINDOWS, cols: 48, codepage: 'cp437',
        })
        expect(cp437.bytes.subarray(2, 5)).toEqual(Buffer.from([0x1b, 0x74, 0]))
    })

    it('dice a qué estación y a qué impresora pertenece la hoja', () => {
        const { vistaPrevia } = construirTirillaPrueba({
            estacion: 'Caja 1', sucursal: 'Santiago', destino: WINDOWS,
            cols: 48, codepage: 'cp850',
        })

        expect(vistaPrevia).toContain('Caja 1')
        expect(vistaPrevia).toContain('Santiago')
        expect(vistaPrevia).toContain('Windows «POS»')
        expect(vistaPrevia).toContain('48 columnas')
        expect(vistaPrevia).toContain('cp850')
    })

    it('deja claro en el papel que la hoja NO pasó por el servidor', () => {
        // Quien la encuentre en el mostrador tiene que poder distinguirla de
        // la página de prueba que se manda desde el sistema.
        const { vistaPrevia } = construirTirillaPrueba({
            estacion: 'Caja 1', sucursal: 'Santiago', destino: RED, cols: 48, codepage: 'cp850',
        })
        expect(vistaPrevia).toContain('No pasa por el servidor')
        expect(vistaPrevia).toContain('red 10.0.0.5:9100')
    })

    it('funciona con el servidor caído, que es justo cuando hace falta', () => {
        const { vistaPrevia, bytes } = construirTirillaPrueba({
            estacion: null, sucursal: null, destino: WINDOWS, cols: 48, codepage: 'cp850',
        })
        expect(bytes.length).toBeGreaterThan(100)
        expect(vistaPrevia).toContain('(el servidor no ha contestado)')
    })

    it('respeta el ancho del papel angosto', () => {
        const { vistaPrevia } = construirTirillaPrueba({
            estacion: 'Caja 1', sucursal: 'Santiago', destino: WINDOWS,
            cols: 32, codepage: 'cp850',
        })
        for (const linea of vistaPrevia.split('\n')) {
            expect(linea.length).toBeLessThanOrEqual(40)
        }
        expect(vistaPrevia).toContain('='.repeat(32))
        expect(vistaPrevia).not.toContain('='.repeat(33))
    })

    // Esta es la prueba que de verdad protege la hoja, y nació de un fallo
    // real: la tabla de caracteres no tenía « ni », así que la línea que
    // dice qué impresora se está usando salía impresa como «Windows ?POS?»
    // — el dato más importante de la hoja, ilegible. Las pruebas de
    // `codificar` no lo vieron porque comprobaban letras elegidas a mano.
    // Esta recorre el TEXTO REAL de la hoja: si alguien añade mañana una
    // comilla tipográfica o una flecha bonita, salta aquí y no en el papel.
    for (const codepage of ['cp850', 'cp858', 'cp437', 'cp1252']) {
        it(`no pierde ni un carácter de la hoja en ${codepage}`, () => {
            const { vistaPrevia, bytes } = construirTirillaPrueba({
                estacion: 'Impresión Carr mella', sucursal: 'Sucursal Carr.Mella',
                destino: WINDOWS, cols: 48, codepage,
            })

            // Un '?' en los bytes solo puede venir de un '?' del texto. Si
            // hay más, es que algún carácter se degradó sin que nadie lo
            // decidiera.
            const interrogantesEnTexto = (vistaPrevia.match(/\?/g) ?? []).length
            const interrogantesEnBytes = bytes.filter(b => b === 0x3f).length

            expect(interrogantesEnBytes).toBe(interrogantesEnTexto)
        })
    }

    it('el nombre de la impresora sale legible, con sus comillas angulares', () => {
        const { bytes } = construirTirillaPrueba({
            estacion: 'Caja 1', sucursal: 'Santiago', destino: WINDOWS,
            cols: 48, codepage: 'cp850',
        })
        expect(codificar('Windows «POS»', 'cp850')).toEqual(iconv.encode('Windows «POS»', 'cp850'))
        expect(bytes.includes(Buffer.from([0xae, 0x50, 0x4f, 0x53, 0xaf]))).toBe(true)
    })

    it('la fecha sale en hora local y no depende de los datos de idioma de Node', () => {
        const { vistaPrevia } = construirTirillaPrueba({
            estacion: 'Caja 1', sucursal: 'Santiago', destino: WINDOWS,
            cols: 48, codepage: 'cp850',
            ahora: new Date(2026, 7, 1, 9, 5),
        })
        expect(vistaPrevia).toContain('01/08/2026 09:05')
    })
})
