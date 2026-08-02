import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RespuestaHello, RespuestaPoll } from './api'
import type { Config } from './config'
import type { TrabajoImpresion } from './tipos'

/**
 * El bucle con una impresora y un servidor de mentira.
 *
 * Lo que se prueba aquí es la promesa de la pausa, que es una promesa
 * fuerte: **en pausa no se reclama ni un boleto**. Si el bucle llamara a
 * `poll` estando pausado, el servidor marcaría esos trabajos como
 * 'reclamado' y quedarían colgados 90 s aunque nadie los imprimiera — o
 * peor, se imprimirían en una impresora a la que le están cambiando el
 * papel. Toda la utilidad de la pausa depende de esta línea.
 */

const imprimirMock = vi.fn<(...args: unknown[]) => Promise<void>>()
vi.mock('./impresora', () => ({
    imprimir: (...args: unknown[]) => imprimirMock(...args),
}))

const SALUDO: RespuestaHello = {
    estacion: 'Caja 1',
    sucursal: 'Santiago',
    impresora: { tipo_conexion: 'windows', ip: null, port: 9100, nombre: 'POS' },
    ancho_cols: 48,
    codepage: 'cp850',
}

function cfg(): Config {
    return {
        apiUrl: 'http://servidor:3000',
        token: 'un-token-de-estacion-larguito',
        pollEsperaMs: 25_000,
        logLevel: 'error',
        modoSimulador: '',
        uiPuerto: 9110,
    }
}

function boleto(id: string): TrabajoImpresion {
    // "hola" en base64: contenido válido, para que llegue a imprimirse.
    return { id, payload_escpos: 'aG9sYQ==', es_copia: false }
}

/** Un servidor de mentira que apunta todo lo que se le pide. */
function apiFalsa(colaDeRespuestas: RespuestaPoll[] = []) {
    const polls: number[] = []
    const acks: { id: string; ok: boolean; error?: string }[] = []

    return {
        polls,
        acks,
        poll: vi.fn(async () => {
            polls.push(Date.now())
            return colaDeRespuestas.shift() ?? { jobs: [] }
        }),
        ack: vi.fn(async (jobId: string, ok: boolean, error?: string) => {
            acks.push({ id: jobId, ok, error })
            return { estado: ok ? 'impreso' : 'pendiente' }
        }),
    }
}

/** Sin esperas de verdad: el bucle da sus vueltas al instante. */
const sinEsperar = () => Promise.resolve()

beforeEach(async () => {
    imprimirMock.mockReset()
    imprimirMock.mockResolvedValue(undefined)
    const { reiniciarPausa } = await import('./pausa')
    const { reiniciarEstado } = await import('./estado')
    reiniciarPausa()
    reiniciarEstado()
})

describe('en pausa NO se reclama ni un boleto', () => {
    it('no llama a poll mientras está pausado', async () => {
        const { bucleDeImpresion } = await import('./bucle')
        const { pausar } = await import('./pausa')
        const api = apiFalsa()

        pausar()
        await bucleDeImpresion({ api, cfg: cfg(), saludo: SALUDO, maxVueltas: 25, esperar: sinEsperar })

        expect(api.poll).not.toHaveBeenCalled()
        expect(api.ack).not.toHaveBeenCalled()
        expect(imprimirMock).not.toHaveBeenCalled()
    })

    it('al reanudar vuelve a pedir trabajos y los imprime', async () => {
        const { bucleDeImpresion } = await import('./bucle')
        const { pausar, reanudar } = await import('./pausa')
        const api = apiFalsa([{ jobs: [boleto('job-1')] }])

        pausar()
        await bucleDeImpresion({ api, cfg: cfg(), saludo: SALUDO, maxVueltas: 5, esperar: sinEsperar })
        expect(api.poll).not.toHaveBeenCalled()

        reanudar()
        await bucleDeImpresion({ api, cfg: cfg(), saludo: SALUDO, maxVueltas: 1, esperar: sinEsperar })

        expect(api.poll).toHaveBeenCalledTimes(1)
        expect(imprimirMock).toHaveBeenCalledTimes(1)
        expect(api.acks).toEqual([{ id: 'job-1', ok: true, error: undefined }])
    })

    it('si la pausa llega a mitad del lote, el resto vuelve a la cola SIN imprimirse', async () => {
        // Un poll trae hasta 5 boletos. Sin esta comprobación, pulsar
        // «Pausar» mientras sale el primero mandaría los otros cuatro a una
        // impresora a la que le están cambiando el rollo: el spooler los
        // acepta, el sistema los marca impresos y no sale ninguno.
        const { bucleDeImpresion } = await import('./bucle')
        const { pausar } = await import('./pausa')
        const api = apiFalsa([{ jobs: [boleto('a'), boleto('b'), boleto('c')] }])

        // Se pausa justo después de imprimir el primero.
        imprimirMock.mockImplementationOnce(async () => { pausar() })

        await bucleDeImpresion({ api, cfg: cfg(), saludo: SALUDO, maxVueltas: 3, esperar: sinEsperar })

        expect(imprimirMock).toHaveBeenCalledTimes(1)
        expect(api.acks[0]).toEqual({ id: 'a', ok: true, error: undefined })
        // Los otros dos se devuelven, no se dan por impresos ni por error.
        expect(api.acks[1].id).toBe('b')
        expect(api.acks[1].ok).toBe(false)
        expect(api.acks[1].error).toMatch(/pausa/i)
        expect(api.acks[2].id).toBe('c')
        expect(api.acks[2].ok).toBe(false)
        // Y no vuelve a pedir más mientras siga pausado.
        expect(api.poll).toHaveBeenCalledTimes(1)
    })

    it('un boleto devuelto por la pausa se apunta como «devuelto», no como error', async () => {
        // Llamarlo error mandaría a alguien a buscar una avería que no
        // existe; llamarlo impreso sería mentir sobre papel que no salió.
        const { bucleDeImpresion } = await import('./bucle')
        const { pausar } = await import('./pausa')
        const { instantanea } = await import('./estado')
        const api = apiFalsa([{ jobs: [boleto('a'), boleto('b')] }])

        imprimirMock.mockImplementationOnce(async () => { pausar() })
        await bucleDeImpresion({ api, cfg: cfg(), saludo: SALUDO, maxVueltas: 2, esperar: sinEsperar })

        const resultados = instantanea().actividad.map(a => ({ id: a.id, r: a.resultado }))
        expect(resultados).toContainEqual({ id: 'b', r: 'devuelto' })
        expect(resultados).toContainEqual({ id: 'a', r: 'impreso' })
    })
})

describe('el bucle sigue haciendo lo de siempre', () => {
    it('imprime y confirma un boleto normal', async () => {
        const { bucleDeImpresion } = await import('./bucle')
        const api = apiFalsa([{ jobs: [boleto('job-1')] }])

        await bucleDeImpresion({ api, cfg: cfg(), saludo: SALUDO, maxVueltas: 1, esperar: sinEsperar })

        expect(imprimirMock).toHaveBeenCalledTimes(1)
        expect(api.acks).toEqual([{ id: 'job-1', ok: true, error: undefined }])
    })

    it('un fallo de impresión se reporta como fallo, no como impreso', async () => {
        const { bucleDeImpresion } = await import('./bucle')
        const api = apiFalsa([{ jobs: [boleto('job-1')] }])
        imprimirMock.mockRejectedValueOnce(new Error('La impresora está apagada'))

        await bucleDeImpresion({ api, cfg: cfg(), saludo: SALUDO, maxVueltas: 1, esperar: sinEsperar })

        expect(api.acks[0].ok).toBe(false)
        expect(api.acks[0].error).toMatch(/apagada/)
    })

    it('un payload que no es base64 se descarta sin tocar la impresora', async () => {
        const { bucleDeImpresion } = await import('./bucle')
        const api = apiFalsa([{ jobs: [{ id: 'malo', payload_escpos: 'no-es-base64!!', es_copia: false }] }])

        await bucleDeImpresion({ api, cfg: cfg(), saludo: SALUDO, maxVueltas: 1, esperar: sinEsperar })

        expect(imprimirMock).not.toHaveBeenCalled()
        expect(api.acks[0].ok).toBe(false)
    })

    it('una respuesta con jobs que no es un arreglo no tumba el bucle ni manda acks', async () => {
        const { bucleDeImpresion } = await import('./bucle')
        const api = apiFalsa([{ jobs: 'algo' as unknown as TrabajoImpresion[] }])

        await bucleDeImpresion({ api, cfg: cfg(), saludo: SALUDO, maxVueltas: 1, esperar: sinEsperar })

        expect(api.ack).not.toHaveBeenCalled()
    })

    it('un poll que falla no tumba el bucle: reintenta en la siguiente vuelta', async () => {
        const { bucleDeImpresion } = await import('./bucle')
        const api = apiFalsa()
        api.poll.mockRejectedValueOnce(new Error('fetch failed'))

        await bucleDeImpresion({ api, cfg: cfg(), saludo: SALUDO, maxVueltas: 3, esperar: sinEsperar })

        expect(api.poll).toHaveBeenCalledTimes(3)
    })
})
