import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ClienteApi } from './api'

const originalFetch = globalThis.fetch

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
})

function respuesta(cuerpo: unknown, status = 200) {
    return Promise.resolve(new Response(JSON.stringify(cuerpo), {
        status, headers: { 'Content-Type': 'application/json' },
    }))
}

describe('ClienteApi.hello', () => {
    it('devuelve los datos de la estación con el destino de impresión', async () => {
        globalThis.fetch = vi.fn(() => respuesta({
            estacion: 'Caja 1',
            sucursal: 'Santiago',
            impresora: { tipo_conexion: 'red', ip: '10.0.0.5', port: 9100, nombre: null },
            ancho_cols: 48,
            codepage: 'cp850',
        })) as never

        const api = new ClienteApi('http://x', 'tok', 25_000)
        const r = await api.hello()

        expect(r.impresora.tipo_conexion).toBe('red')
        expect(r.impresora.ip).toBe('10.0.0.5')
    })

    it('trae impresora_nombre para estaciones tipo windows', async () => {
        globalThis.fetch = vi.fn(() => respuesta({
            estacion: 'Caja 2',
            sucursal: 'Santiago',
            impresora: { tipo_conexion: 'windows', ip: null, port: 9100, nombre: 'POS-80' },
            ancho_cols: 48,
            codepage: 'cp850',
        })) as never

        const api = new ClienteApi('http://x', 'tok', 25_000)
        const r = await api.hello()

        expect(r.impresora.tipo_conexion).toBe('windows')
        expect(r.impresora.nombre).toBe('POS-80')
    })
})

describe('ClienteApi.poll', () => {
    it('devuelve la lista de trabajos', async () => {
        globalThis.fetch = vi.fn(() =>
            respuesta({ jobs: [{ id: 'j1', payload_escpos: 'QUJD', es_copia: false }] }),
        ) as never

        const api = new ClienteApi('http://x', 'tok', 25_000)
        const r = await api.poll()

        expect(r.jobs).toHaveLength(1)
        expect(r.jobs[0].id).toBe('j1')
    })

    it('devuelve lista vacía cuando no hay trabajos', async () => {
        globalThis.fetch = vi.fn(() => respuesta({ jobs: [] })) as never

        const api = new ClienteApi('http://x', 'tok', 25_000)
        expect((await api.poll()).jobs).toEqual([])
    })

    it('lanza con mensaje claro si el token es inválido', async () => {
        globalThis.fetch = vi.fn(() => respuesta({ error: 'Token inválido' }, 401)) as never

        const api = new ClienteApi('http://x', 'tok-malo', 25_000)
        await expect(api.poll()).rejects.toThrow(/401/)
    })

    it('NUNCA deja el token en el mensaje de error, aunque el servidor haga eco del cuerpo', async () => {
        // Un servidor que registra/devuelve la petición (proxy, error 400
        // verboso, etc.) puede citar el cuerpo enviado, que incluye el
        // token. El mensaje de error termina en el log del agente: el
        // token no puede aparecer ahí de ninguna forma.
        const tokenSecreto = 'secreto-super-privado-de-la-estacion'
        globalThis.fetch = vi.fn(() =>
            respuesta({ error: `Petición inválida: {"token":"${tokenSecreto}","version":"1.1.0"}` }, 400),
        ) as never

        const api = new ClienteApi('http://x', tokenSecreto, 25_000)
        let mensaje = ''
        try {
            await api.poll()
        } catch (e) {
            mensaje = (e as Error).message
        }
        expect(mensaje).not.toContain(tokenSecreto)
        expect(mensaje).toContain('TOKEN OCULTO')
    })

    it('lanza si la respuesta no es JSON válido', async () => {
        globalThis.fetch = vi.fn(() =>
            Promise.resolve(new Response('no soy json', { status: 200 })),
        ) as never

        const api = new ClienteApi('http://x', 'tok', 25_000)
        await expect(api.poll()).rejects.toThrow()
    })
})

describe('ClienteApi.ack', () => {
    it('envía ok true en el cuerpo, sin el token', async () => {
        const espia = vi.fn(() => respuesta({ estado: 'impreso' }))
        globalThis.fetch = espia as never

        await new ClienteApi('http://x', 'tok', 25_000).ack('j1', true)

        const cuerpo = JSON.parse((espia.mock.calls[0][1] as RequestInit).body as string)
        expect(cuerpo).toMatchObject({ jobId: 'j1', ok: true })
        expect(cuerpo).not.toHaveProperty('token')
    })

    it('envía el mensaje de error cuando la impresión falló', async () => {
        const espia = vi.fn(() => respuesta({ estado: 'pendiente' }))
        globalThis.fetch = espia as never

        await new ClienteApi('http://x', 'tok', 25_000).ack('j1', false, 'impresora apagada')

        const cuerpo = JSON.parse((espia.mock.calls[0][1] as RequestInit).body as string)
        expect(cuerpo).toMatchObject({ ok: false, error: 'impresora apagada' })
    })
})

describe('ClienteApi — token en la cabecera, no en el cuerpo', () => {
    it('manda el token como "Authorization: Bearer <token>" y nunca en el cuerpo JSON', async () => {
        const espia = vi.fn(() => respuesta({ estado: 'impreso' }))
        globalThis.fetch = espia as never

        await new ClienteApi('http://x', 'secreto-de-estacion', 25_000).ack('j1', true)

        const [, init] = espia.mock.calls[0] as [string, RequestInit]
        const cabeceras = init.headers as Record<string, string>
        expect(cabeceras.Authorization).toBe('Bearer secreto-de-estacion')

        const cuerpoCrudo = init.body as string
        expect(cuerpoCrudo).not.toContain('secreto-de-estacion')
    })
})

describe('calcularBackoff', () => {
    it('crece con los fallos consecutivos y se topa en 30 s', async () => {
        const { calcularBackoff } = await import('./api')
        expect(calcularBackoff(0)).toBe(1_000)
        expect(calcularBackoff(1)).toBe(2_000)
        expect(calcularBackoff(2)).toBe(4_000)
        expect(calcularBackoff(10)).toBe(30_000)
    })
})
