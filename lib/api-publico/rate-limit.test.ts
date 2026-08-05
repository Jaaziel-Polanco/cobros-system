import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * El módulo mantiene estado en un Map a nivel de módulo (ventanas, y el
 * contador global comparte la misma estructura bajo la clave '__global__').
 * Para que las pruebas no se contaminen entre sí, cada una recarga el
 * módulo desde cero con vi.resetModules() + import() dinámico, en vez de
 * confiar en claves "unicas" para aislarse.
 */
async function cargarModulo() {
    return await import('./rate-limit')
}

beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    delete process.env.TRUST_PROXY_HEADERS
})

afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.TRUST_PROXY_HEADERS
})

describe('permitir', () => {
    it('permite peticiones hasta el límite y corta la que lo excede', async () => {
        const { permitir } = await cargarModulo()
        expect(permitir('clienteA', 3, 60_000)).toBe(true)
        expect(permitir('clienteA', 3, 60_000)).toBe(true)
        expect(permitir('clienteA', 3, 60_000)).toBe(true)
        expect(permitir('clienteA', 3, 60_000)).toBe(false)
    })

    it('lleva cupos independientes por clave', async () => {
        const { permitir } = await cargarModulo()
        expect(permitir('clienteA', 1, 60_000)).toBe(true)
        expect(permitir('clienteA', 1, 60_000)).toBe(false)
        // Clave distinta: cupo propio, no contaminado por clienteA.
        expect(permitir('clienteB', 1, 60_000)).toBe(true)
    })

    it('la ventana expira y reinicia el cupo', async () => {
        const { permitir } = await cargarModulo()
        const base = 1_000_000_000

        vi.spyOn(Date, 'now').mockReturnValue(base)
        expect(permitir('clienteA', 1, 60_000)).toBe(true)
        expect(permitir('clienteA', 1, 60_000)).toBe(false)

        // Un instante dentro de la misma ventana: sigue cortado.
        vi.spyOn(Date, 'now').mockReturnValue(base + 30_000)
        expect(permitir('clienteA', 1, 60_000)).toBe(false)

        // Pasada la ventana (60_000 ms): el cupo se reinicia.
        vi.spyOn(Date, 'now').mockReturnValue(base + 60_001)
        expect(permitir('clienteA', 1, 60_000)).toBe(true)
    })
})

describe('permitirGlobal', () => {
    it('usa un único contador agregado, sin importar la clave por IP', async () => {
        const { permitir, permitirGlobal } = await cargarModulo()

        // Tres IPs distintas, cada una muy por debajo de su propio cupo...
        expect(permitir('ip-1', 10, 60_000)).toBe(true)
        expect(permitir('ip-2', 10, 60_000)).toBe(true)
        expect(permitir('ip-3', 10, 60_000)).toBe(true)

        // ...pero permitirGlobal no recibe ninguna clave: cuenta sus propias
        // llamadas de forma independiente de lo que haya pasado con permitir().
        expect(permitirGlobal(3, 60_000)).toBe(true)
        expect(permitirGlobal(3, 60_000)).toBe(true)
        expect(permitirGlobal(3, 60_000)).toBe(true)
        expect(permitirGlobal(3, 60_000)).toBe(false)
    })

    it('sigue frenando aunque la clave por IP cambie en cada petición (simula X-Forwarded-For falsificado)', async () => {
        const { permitir, permitirGlobal } = await cargarModulo()

        // Un atacante que manda una IP distinta en cada petición nunca agota
        // su propio cupo por clave...
        for (let i = 0; i < 6; i++) {
            expect(permitir(`ip-falsa-${i}`, 1, 60_000)).toBe(true)
        }

        // ...pero el tope global sí vio las 6 llamadas (una por cada
        // permitirGlobal que la ruta real haría junto a cada permitir()) y
        // corta en el límite, sin que le importe la clave.
        for (let i = 0; i < 5; i++) {
            expect(permitirGlobal(5, 60_000)).toBe(true)
        }
        expect(permitirGlobal(5, 60_000)).toBe(false)
    })
})

describe('ipDe', () => {
    it('NO lee X-Forwarded-For ni X-Real-IP cuando TRUST_PROXY_HEADERS no está activo (por defecto)', async () => {
        delete process.env.TRUST_PROXY_HEADERS
        const { ipDe } = await cargarModulo()

        const req = new Request('http://localhost/api/tickets/x/pdf', {
            headers: { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' },
        })

        expect(ipDe(req)).toBe('sin-proxy')
    })

    it('tampoco lee las cabeceras si TRUST_PROXY_HEADERS tiene un valor distinto de "true"', async () => {
        process.env.TRUST_PROXY_HEADERS = 'yes'
        const { ipDe } = await cargarModulo()

        const req = new Request('http://localhost/api/tickets/x/pdf', {
            headers: { 'x-forwarded-for': '1.2.3.4' },
        })

        expect(ipDe(req)).toBe('sin-proxy')
    })

    it('lee X-Forwarded-For (primer valor de la lista) cuando TRUST_PROXY_HEADERS="true"', async () => {
        process.env.TRUST_PROXY_HEADERS = 'true'
        const { ipDe } = await cargarModulo()

        const req = new Request('http://localhost/api/tickets/x/pdf', {
            headers: { 'x-forwarded-for': '1.2.3.4, 9.9.9.9' },
        })

        expect(ipDe(req)).toBe('1.2.3.4')
    })

    it('con TRUST_PROXY_HEADERS="true" cae a X-Real-IP si no hay X-Forwarded-For, y a "desconocida" si no hay ninguna', async () => {
        process.env.TRUST_PROXY_HEADERS = 'true'
        const { ipDe } = await cargarModulo()

        const conRealIp = new Request('http://localhost/api/tickets/x/pdf', {
            headers: { 'x-real-ip': '8.8.8.8' },
        })
        expect(ipDe(conRealIp)).toBe('8.8.8.8')

        const sinNada = new Request('http://localhost/api/tickets/x/pdf')
        expect(ipDe(sinNada)).toBe('desconocida')
    })
})
