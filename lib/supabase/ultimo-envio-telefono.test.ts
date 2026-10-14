/**
 * El anti-duplicado por deuda no ve que dos deudas son la misma persona: en
 * producción hay teléfonos registrados como clientes distintos, y números que
 * ya habían recibido un mensaje manual por OTRA deuda iban a recibir otro del
 * cron. Este mapa es la vista por teléfono que lo impide.
 */
import { describe, it, expect } from 'vitest'
import { crearBaseFalsa, type Fila } from './postgrest-falso'
import { leerUltimoEnvioPorTelefono, type ClienteLector } from './ultimo-envio-telefono'

const DESDE = '2026-10-10T00:00:00.000Z'
const iso = (horas: number) => new Date(Date.parse(DESDE) + horas * 36e5).toISOString()

const envio = (id: string, sentAt: string, telefono: string | null, tipo = 'cliente'): Fila => ({
    id, sent_at: sentAt, tipo_destino: tipo, cliente: telefono === null ? null : { telefono },
})

const cliente = (envios: Fila[], maxRows?: number) =>
    crearBaseFalsa({ envios_log: envios }, { maxRows }) as unknown as ClienteLector

describe('leerUltimoEnvioPorTelefono', () => {
    it('junta en un solo número los envíos a clientes distintos con el mismo teléfono', async () => {
        const mapa = await leerUltimoEnvioPorTelefono(cliente([
            envio('e1', iso(1), '809-555-1234'),
            envio('e2', iso(5), '+1 809 555 1234'),
            envio('e3', iso(3), '(809) 555 1234'),
        ]), DESDE)

        expect([...mapa.entries()]).toEqual([['8095551234', iso(5)]])
    })

    it('ignora lo anterior a la ventana, los envíos a referencias y los clientes sin teléfono', async () => {
        const mapa = await leerUltimoEnvioPorTelefono(cliente([
            envio('e1', iso(-1), '8095550001'),
            envio('e2', iso(2), '8095550002', 'referencia'),
            envio('e3', iso(2), null),
            envio('e4', iso(2), 'sin número'),
            envio('e5', iso(2), '8095550005'),
        ]), DESDE)

        expect([...mapa.keys()]).toEqual(['8095550005'])
    })

    it('lee la ventana entera aunque pase de 1000 envíos', async () => {
        // Un día de cron de julio llegaba a 435 envíos por corrida; la
        // ventana es de hasta 7 días. Sin paginar, el corte silencioso de
        // PostgREST dejaría teléfonos fuera y les volvería a escribir.
        const envios = Array.from({ length: 1500 }, (_, i) =>
            envio(`e${String(i).padStart(5, '0')}`, iso(1 + (i % 50)), `809${String(1000000 + i)}`))

        const mapa = await leerUltimoEnvioPorTelefono(cliente(envios), DESDE)

        expect(mapa.size).toBe(1500)
    })

    it('ABORTA si el servidor recorta por debajo del tamaño de lote', async () => {
        const envios = Array.from({ length: 50 }, (_, i) =>
            envio(`e${String(i).padStart(5, '0')}`, iso(1), `809${String(1000000 + i)}`))

        await expect(leerUltimoEnvioPorTelefono(cliente(envios, 10), DESDE)).rejects.toThrow(/envíos/i)
    })
})
