/**
 * El PDF de la prueba tiene que ser un PDF de verdad.
 *
 * La suite de `lib/actions/webhooks-prueba.test.ts` sustituye
 * `generarTicketPdf` por un doble, así que comprueba el cableado pero no
 * que el boleto ficticio sea renderizable. Aquí se renderiza de verdad, con
 * el mismo `TicketDocument` de producción: si al boleto de prueba le
 * faltara un campo del snapshot, o si el PDF dejara de generarse, sale aquí
 * y no el día que alguien pulse «Enviar prueba».
 */
import { describe, it, expect } from 'vitest'
import { generarTicketPdf } from '@/lib/pdf/ticket-document'
import {
    CFG_TICKET_POR_DEFECTO,
    construirPayloadPruebaTicket,
    construirTicketDePrueba,
    payloadParaMostrar,
    telefonoDePrueba,
    TELEFONO_PRUEBA_FALLBACK,
    type SorteoDePrueba,
} from './payload-prueba'
import type { ConfiguracionTicket } from '@/lib/types'

const CFG: ConfiguracionTicket = {
    ...CFG_TICKET_POR_DEFECTO,
    nombre_comercial: 'Inversiones Héctor Cordero',
    rnc: '132966562',
    direccion: 'Av. Libertad No. 92',
    telefono: '8296190004',
    url_terminos: 'https://ejemplo.test/terminos',
    modo_adjunto: 'ambos',
}

const SORTEO: SorteoDePrueba = {
    id: 's-1',
    nombre: 'FINANCIA, PAGA Y GANA',
    premio: 'iPhone 13 Pro Max',
    fecha_fin: '2026-12-04',
    prefijo: 'SPG126',
}

describe('el boleto de prueba genera un PDF real', () => {
    it('produce un PDF válido y no vacío', async () => {
        const ticket = construirTicketDePrueba(CFG, SORTEO)
        const pdf = await generarTicketPdf(ticket)

        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
        expect(pdf.length).toBeGreaterThan(1000)
    }, 30_000)

    it('el base64 del payload se decodifica al mismo PDF', async () => {
        const ticket = construirTicketDePrueba(CFG, SORTEO)
        const pdf = await generarTicketPdf(ticket)

        const payload = construirPayloadPruebaTicket({
            ticket,
            cfg: CFG,
            plantillaContenido: null,
            base64: pdf.toString('base64'),
            urlPublica: 'https://ejemplo.test/t/xxx',
        })

        expect(payload.adjunto).not.toBeNull()
        const vuelto = Buffer.from(payload.adjunto!.base64, 'base64')
        expect(vuelto.equals(pdf)).toBe(true)
    }, 30_000)

    it('sobrevive a una configuración vacía, que es la del primer arranque', async () => {
        const ticket = construirTicketDePrueba(CFG_TICKET_POR_DEFECTO, null)
        const pdf = await generarTicketPdf(ticket)

        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
        expect(ticket.numero_formateado).toBe('BOL-SN-000000')
    }, 30_000)
})

describe('detalles que deciden a quién le llega la prueba', () => {
    it('usa el teléfono del negocio cuando está configurado', () => {
        expect(telefonoDePrueba(CFG)).toBe('8296190004')
    })

    it('cae al número de reserva si el del negocio no sirve', () => {
        expect(telefonoDePrueba({ telefono: '809' })).toBe(TELEFONO_PRUEBA_FALLBACK)
        expect(telefonoDePrueba({ telefono: null })).toBe(TELEFONO_PRUEBA_FALLBACK)
        expect(telefonoDePrueba(null)).toBe(TELEFONO_PRUEBA_FALLBACK)
    })

    it('el número 0 no lo puede tener ningún boleto real', () => {
        expect(construirTicketDePrueba(CFG, SORTEO).numero).toBe(0)
    })
})

describe('payloadParaMostrar', () => {
    it('elide el base64 y reporta su tamaño', () => {
        const ticket = construirTicketDePrueba(CFG, SORTEO)
        const base64 = Buffer.from('x'.repeat(3000)).toString('base64')
        const payload = construirPayloadPruebaTicket({
            ticket, cfg: CFG, plantillaContenido: null, base64, urlPublica: null,
        })

        const { payload: vista, adjunto } = payloadParaMostrar(payload)

        expect(adjunto?.caracteres_base64).toBe(base64.length)
        expect(adjunto?.bytes_pdf).toBe(3000)
        expect(JSON.stringify(vista)).not.toContain(base64)
        expect(JSON.stringify(vista).length).toBeLessThan(base64.length)
    })

    it('deja intacto un payload de cobranza, que no tiene adjunto', () => {
        const payload = {
            evento: 'recordatorio_cobranza' as const,
            _test: true as const,
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { payload: vista, adjunto } = payloadParaMostrar(payload as any)
        expect(adjunto).toBeNull()
        expect(vista).toBe(payload)
    })
})
