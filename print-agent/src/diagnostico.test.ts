import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import net from 'node:net'
import { explicarFalloDeRed, probarConexionTcp } from './diagnostico'
import { reiniciarEstado } from './estado'
import type { Config } from './config'
import type { ImpresoraInstalada } from './impresora-windows'

// `listarImpresorasWindows` lanza PowerShell: en una prueba no hay Windows
// (ni debe haberlo), así que se sustituye. Lo que se comprueba aquí es que
// el diagnóstico traduce bien cada situación a algo que se pueda leer en un
// mostrador, no que PowerShell funcione.
const listarMock = vi.fn<() => Promise<ImpresoraInstalada[]>>()
vi.mock('./impresora-windows', () => ({
    listarImpresorasWindows: () => listarMock(),
    imprimirWindows: () => Promise.resolve(),
}))

/** Una impresora instalada y sana, para no repetir el objeto entero. */
function instalada(
    nombre: string,
    cambios: Partial<ImpresoraInstalada> = {},
): ImpresoraInstalada {
    return {
        nombre,
        estado: 'lista',
        estadoCrudo: 'Normal',
        estadoTexto: 'Lista para imprimir',
        puerto: 'USB001',
        controlador: 'Generic / Text Only',
        predeterminada: false,
        enCola: 0,
        ...cambios,
    }
}

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

async function correrEntero() {
    const { ejecutarDiagnostico } = await import('./diagnostico')
    return ejecutarDiagnostico(cfg())
}

describe('servidor y token', () => {
    it('con todo bien, dice a qué estación y sucursal pertenece este token', async () => {
        globalThis.fetch = vi.fn(() => respuesta(HELLO_WINDOWS)) as never
        listarMock.mockResolvedValue([instalada('POS')])

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
        listarMock.mockResolvedValue([instalada('POS')])

        const p = await correr()
        expect(p.servidor.nivel).toBe('ok')
        expect(p.token.nivel).toBe('error')
        expect(p.token.queHacer).toMatch(/Regenerar token/)
    })

    it('si no se llega al servidor, no se inventa un veredicto sobre el token', async () => {
        globalThis.fetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as never
        listarMock.mockResolvedValue([instalada('POS')])

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

    it('en verde cuando el nombre coincide exacto y Windows la da por lista', async () => {
        listarMock.mockResolvedValue([instalada('Microsoft Print to PDF'), instalada('POS')])
        const p = await correr()
        expect(p.impresora.nivel).toBe('ok')
    })

    it('cuando no existe, ENSEÑA las que sí hay en este PC', async () => {
        listarMock.mockResolvedValue([instalada('POS-58'), instalada('Microsoft Print to PDF')])
        const r = await correrEntero()
        const p = Object.fromEntries(r.puntos.map(x => [x.clave, x]))

        expect(p.impresora.nivel).toBe('error')
        expect(p.impresora.resumen).toContain('POS')
        expect(r.impresoras?.map(i => i.nombre)).toEqual(['POS-58', 'Microsoft Print to PDF'])
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
        listarMock.mockResolvedValue([instalada('POS')])

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
        listarMock.mockResolvedValue([instalada('POS')])

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
        const r = await correrEntero()
        const p = Object.fromEntries(r.puntos.map(x => [x.clave, x]))

        expect(p.impresora.nivel).toBe('desconocido')
        expect(p.impresora.queHacer).toMatch(/prueba de impresión/)
        // «No se pudo preguntar» NO es «no hay impresoras»: la página tiene
        // que poder distinguirlo, así que se manda null y no [].
        expect(r.impresoras).toBeNull()
        expect(r.errorImpresoras).toMatch(/PowerShell/)
    })

    it('la lista viaja SIEMPRE, también cuando todo está en verde', async () => {
        // Antes solo aparecía si algo fallaba, y era justo cuando menos
        // falta hacía: quien está montando la estación necesita copiar el
        // nombre exacto precisamente cuando todavía no hay ningún error.
        listarMock.mockResolvedValue([instalada('POS'), instalada('Microsoft Print to PDF')])
        const r = await correrEntero()

        expect(r.puntos.find(p => p.clave === 'impresora')?.nivel).toBe('ok')
        expect(r.impresoras).toHaveLength(2)
        expect(r.impresoraPedida).toBe('POS')
    })
})

describe('«no existe» y «existe pero no puede imprimir» son dos fallos distintos', () => {
    beforeEach(() => { globalThis.fetch = vi.fn(() => respuesta(HELLO_WINDOWS)) as never })

    it('una impresora EN PAUSA sale en rojo, no en verde por tener el nombre bien', async () => {
        // Este es el caso que antes se perdía entero: el nombre coincide,
        // así que salía «todo bien», y sin embargo el spooler acepta los
        // boletos, el sistema los marca impresos y no sale ni un papel.
        listarMock.mockResolvedValue([instalada('POS', {
            estado: 'pausa', estadoCrudo: 'Paused',
            estadoTexto: 'EN PAUSA. Windows le acepta los boletos pero no imprime',
        })])

        const p = await correr()
        expect(p.impresora.nivel).toBe('error')
        expect(p.impresora.resumen).toMatch(/existe/)
        expect(p.impresora.resumen).toMatch(/PAUSA/)
        // Y no se puede confundir con «no existe»: lo que hay que hacer es
        // otra cosa completamente distinta.
        expect(p.impresora.queHacer).not.toMatch(/no existe/)
        expect(p.impresora.queHacer).toMatch(/reanud/i)
    })

    it('una impresora sin conexión culpa a la impresora, no al nombre', async () => {
        listarMock.mockResolvedValue([instalada('POS', {
            estado: 'sin-conexion', estadoCrudo: 'Offline', estadoTexto: 'Sin conexión',
        })])

        const p = await correr()
        expect(p.impresora.nivel).toBe('error')
        expect(p.impresora.resumen).toMatch(/sin conexión/i)
        expect(p.impresora.queHacer).toMatch(/nombre está bien/)
    })

    it('sin papel o atascada también es rojo, con el motivo de Windows', async () => {
        listarMock.mockResolvedValue([instalada('POS', {
            estado: 'error', estadoCrudo: 'PaperOut', estadoTexto: 'Se quedó sin papel',
        })])

        const p = await correr()
        expect(p.impresora.nivel).toBe('error')
        expect(p.impresora.resumen).toMatch(/sin papel/i)
    })

    it('la pausa manda por encima de una diferencia de mayúsculas', async () => {
        // Las mayúsculas son un aviso porque no impiden imprimir. La pausa
        // sí lo impide, así que es lo que hay que enseñar.
        globalThis.fetch = vi.fn(() => respuesta({
            ...HELLO_WINDOWS,
            impresora: { ...HELLO_WINDOWS.impresora, nombre: 'pos' },
        })) as never
        listarMock.mockResolvedValue([instalada('POS', {
            estado: 'pausa', estadoCrudo: 'Paused', estadoTexto: 'EN PAUSA',
        })])

        const p = await correr()
        expect(p.impresora.nivel).toBe('error')
        expect(p.impresora.resumen).toMatch(/PAUSA/)
    })

    it('un estado que Windows describe raro es aviso, no error: nada dice que esté roto', async () => {
        listarMock.mockResolvedValue([instalada('POS', {
            estado: 'desconocido', estadoCrudo: 'AlgoQueNadieHaVisto',
            estadoTexto: 'Windows dice «AlgoQueNadieHaVisto»',
        })])

        const p = await correr()
        expect(p.impresora.nivel).toBe('aviso')
    })

    it('menciona los trabajos que ya están esperando en la cola de esa impresora', async () => {
        listarMock.mockResolvedValue([instalada('POS', {
            estado: 'pausa', estadoCrudo: 'Paused', estadoTexto: 'EN PAUSA', enCola: 3,
        })])

        const p = await correr()
        expect(p.impresora.queHacer).toContain('3 trabajo')
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
