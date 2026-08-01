import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import net from 'node:net'
import { explicarFalloDeRed, probarConexionTcp } from './diagnostico'
import { reiniciarEstado } from './estado'
import type { Config } from './config'

// `listarImpresorasWindows` lanza PowerShell: en una prueba no hay Windows
// (ni debe haberlo), así que se sustituye. Lo que se comprueba aquí es que
// el diagnóstico traduce bien cada situación a algo que se pueda leer en un
// mostrador, no que PowerShell funcione.
const listarMock = vi.fn<() => Promise<string[]>>()
vi.mock('./impresora-windows', () => ({
    listarImpresorasWindows: () => listarMock(),
    imprimirWindows: () => Promise.resolve(),
}))

const originalFetch = globalThis.fetch

function cfg(): Config {
    return {
        apiUrl: 'http://servidor:3000',
        token: 'un-token-de-estacion-larguito',
        pollEsperaMs: 25_000,
        logLevel: 'info',
        modoSimulador: '',
        uiPuerto: 9110,
    }
}

function respuesta(cuerpo: unknown, status = 200) {
    return Promise.resolve(new Response(JSON.stringify(cuerpo), {
        status, headers: { 'Content-Type': 'application/json' },
    }))
}

const HELLO_WINDOWS = {
    estacion: 'Caja 1',
    sucursal: 'Santiago',
    impresora: { tipo_conexion: 'windows', ip: null, port: 9100, nombre: 'POS' },
    ancho_cols: 48,
    codepage: 'cp850',
}

beforeEach(() => {
    reiniciarEstado()
    listarMock.mockReset()
})
afterEach(() => { globalThis.fetch = originalFetch })

async function correr() {
    const { ejecutarDiagnostico } = await import('./diagnostico')
    const r = await ejecutarDiagnostico(cfg())
    return Object.fromEntries(r.puntos.map(p => [p.clave, p]))
}

describe('servidor y token', () => {
    it('con todo bien, dice a qué estación y sucursal pertenece este token', async () => {
        globalThis.fetch = vi.fn(() => respuesta(HELLO_WINDOWS)) as never
        listarMock.mockResolvedValue(['POS'])

        const p = await correr()
        expect(p.servidor.nivel).toBe('ok')
        expect(p.token.nivel).toBe('ok')
        // Es la única forma de darse cuenta de que se instaló el token de la otra tienda.
        expect(p.token.resumen).toContain('Caja 1')
        expect(p.token.resumen).toContain('Santiago')
        expect(p.token.queHacer).toMatch(/ESTA tienda/)
    })

    it('un 401 culpa al token, no a la red: el servidor contestó', async () => {
        globalThis.fetch = vi.fn(() => respuesta({ error: 'Token inválido' }, 401)) as never
        listarMock.mockResolvedValue(['POS'])

        const p = await correr()
        expect(p.servidor.nivel).toBe('ok')
        expect(p.token.nivel).toBe('error')
        expect(p.token.queHacer).toMatch(/Regenerar token/)
    })

    it('si no se llega al servidor, no se inventa un veredicto sobre el token', async () => {
        globalThis.fetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as never
        listarMock.mockResolvedValue(['POS'])

        const p = await correr()
        expect(p.servidor.nivel).toBe('error')
        expect(p.servidor.resumen).toContain('http://servidor:3000')
        expect(p.token.nivel).toBe('desconocido')
    })

    it('nunca deja el token dentro del texto que se enseña en pantalla', async () => {
        globalThis.fetch = vi.fn(() =>
            respuesta({ error: 'Petición inválida: un-token-de-estacion-larguito' }, 400),
        ) as never
        listarMock.mockResolvedValue([])

        const p = await correr()
        expect(JSON.stringify(p)).not.toContain('un-token-de-estacion-larguito')
    })
})

describe('impresora de Windows — el punto que más ayuda', () => {
    beforeEach(() => { globalThis.fetch = vi.fn(() => respuesta(HELLO_WINDOWS)) as never })

    it('en verde cuando el nombre coincide exacto', async () => {
        listarMock.mockResolvedValue(['Microsoft Print to PDF', 'POS'])
        const p = await correr()
        expect(p.impresora.nivel).toBe('ok')
    })

    it('cuando no existe, ENSEÑA las que sí hay en este PC', async () => {
        listarMock.mockResolvedValue(['POS-58', 'Microsoft Print to PDF'])
        const p = await correr()

        expect(p.impresora.nivel).toBe('error')
        expect(p.impresora.resumen).toContain('POS')
        expect(p.impresora.lista).toEqual(['POS-58', 'Microsoft Print to PDF'])
    })

    it('NO da por roto lo que Windows acepta: una diferencia de mayúsculas es un aviso', async () => {
        // Comprobado contra OpenPrinter en Windows 11: "pos" abre la
        // impresora "POS" sin problema, así que los boletos salen. Marcarlo
        // en rojo mandaría a alguien a arreglar algo que funciona, y la
        // próxima vez que haya un rojo de verdad no se lo va a creer.
        globalThis.fetch = vi.fn(() => respuesta({
            ...HELLO_WINDOWS,
            impresora: { ...HELLO_WINDOWS.impresora, nombre: 'pos' },
        })) as never
        listarMock.mockResolvedValue(['POS'])

        const p = await correr()
        expect(p.impresora.nivel).toBe('aviso')
        expect(p.impresora.resumen).toContain('«pos»')
        expect(p.impresora.resumen).toContain('«POS»')
        expect(p.impresora.resumen).toMatch(/imprime bien/)
    })

    it('un espacio de más SÍ es un error: Windows los distingue', async () => {
        globalThis.fetch = vi.fn(() => respuesta({
            ...HELLO_WINDOWS,
            impresora: { ...HELLO_WINDOWS.impresora, nombre: 'POS ' },
        })) as never
        listarMock.mockResolvedValue(['POS'])

        const p = await correr()
        expect(p.impresora.nivel).toBe('error')
        expect(p.impresora.resumen).toMatch(/espacios/)
    })

    it('compararNombreImpresora distingue los tres casos que importan', async () => {
        const { compararNombreImpresora } = await import('./diagnostico')
        expect(compararNombreImpresora('POS', 'POS')).toBe('exacto')
        expect(compararNombreImpresora('pos', 'POS')).toBe('solo-mayusculas')
        expect(compararNombreImpresora('POS ', 'POS')).toBe('espacios')
        expect(compararNombreImpresora(' pos', 'POS')).toBe('espacios')
        expect(compararNombreImpresora('POS-58', 'POS')).toBe('ninguno')
    })

    it('sin ninguna impresora instalada, apunta a la cuenta del servicio', async () => {
        listarMock.mockResolvedValue([])
        const p = await correr()

        expect(p.impresora.nivel).toBe('error')
        expect(p.impresora.queHacer).toMatch(/NSSM|misma cuenta/)
    })

    it('si no se puede preguntar a Windows, lo dice sin acusar a la impresora', async () => {
        listarMock.mockRejectedValue(new Error('PowerShell no está disponible'))
        const p = await correr()

        expect(p.impresora.nivel).toBe('desconocido')
        expect(p.impresora.queHacer).toMatch(/prueba de impresión/)
    })
})

describe('impresora de red', () => {
    it('en verde si el ip:puerto acepta conexión', async () => {
        const falsa = net.createServer()
        const puerto = await new Promise<number>(r => {
            falsa.listen(0, '127.0.0.1', () => r((falsa.address() as net.AddressInfo).port))
        })

        globalThis.fetch = vi.fn(() => respuesta({
            ...HELLO_WINDOWS,
            impresora: { tipo_conexion: 'red', ip: '127.0.0.1', port: puerto, nombre: null },
        })) as never

        const p = await correr()
        expect(p.impresora.nivel).toBe('ok')
        await new Promise<void>(r => falsa.close(() => r()))
    })

    it('en rojo, con el motivo, si no hay nada al otro lado', async () => {
        globalThis.fetch = vi.fn(() => respuesta({
            ...HELLO_WINDOWS,
            impresora: { tipo_conexion: 'red', ip: '127.0.0.1', port: 1, nombre: null },
        })) as never

        const p = await correr()
        expect(p.impresora.nivel).toBe('error')
        expect(p.impresora.resumen).toContain('127.0.0.1:1')
    })
})

describe('explicarFalloDeRed — «fetch failed» no le sirve a nadie en un mostrador', () => {
    it('saca el motivo real de donde Node lo esconde', () => {
        const falloDeFetch = (codigo: string) =>
            Object.assign(new TypeError('fetch failed'), { cause: { code: codigo } })

        expect(explicarFalloDeRed(falloDeFetch('ECONNREFUSED'))).toMatch(/apagado|nada escuchando/)
        expect(explicarFalloDeRed(falloDeFetch('ENOTFOUND'))).toMatch(/no existe|resolver/)
        expect(explicarFalloDeRed(falloDeFetch('ETIMEDOUT'))).toMatch(/a tiempo/)
        expect(explicarFalloDeRed(falloDeFetch('EHOSTUNREACH'))).toMatch(/no llega/)

        for (const codigo of ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT']) {
            expect(explicarFalloDeRed(falloDeFetch(codigo))).not.toContain('fetch failed')
        }
    })

    it('reconoce el corte por tiempo del propio agente', () => {
        expect(explicarFalloDeRed(Object.assign(new Error('abortado'), { name: 'AbortError' })))
            .toMatch(/a tiempo/)
    })

    it('ante algo que no conoce, no se inventa nada: repite el mensaje', () => {
        expect(explicarFalloDeRed(new Error('algo rarísimo'))).toBe('algo rarísimo')
    })

    it('lo enseña en el diagnóstico en vez del «fetch failed» pelado', async () => {
        globalThis.fetch = vi.fn(() =>
            Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })),
        ) as never
        listarMock.mockResolvedValue([])

        const p = await correr()
        expect(p.servidor.resumen).not.toContain('fetch failed')
        expect(p.servidor.resumen).toContain('http://servidor:3000')
    })
})

describe('probarConexionTcp', () => {
    it('no manda ni un byte a la impresora: solo abre y cierra', async () => {
        const recibidos: Buffer[] = []
        const falsa = net.createServer(socket => { socket.on('data', d => recibidos.push(d)) })
        const puerto = await new Promise<number>(r => {
            falsa.listen(0, '127.0.0.1', () => r((falsa.address() as net.AddressInfo).port))
        })

        expect(await probarConexionTcp('127.0.0.1', puerto)).toEqual({ ok: true })
        expect(recibidos).toHaveLength(0)

        await new Promise<void>(r => falsa.close(() => r()))
    })

    it('devuelve el motivo en vez de lanzar cuando no se conecta', async () => {
        const r = await probarConexionTcp('127.0.0.1', 1, 1_000)
        expect(r.ok).toBe(false)
    })
})
