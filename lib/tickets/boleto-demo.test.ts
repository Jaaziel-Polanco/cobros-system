/**
 * El boleto de ejemplo es lo que se pega en el formulario de revisión de
 * plantillas de WhatsApp, donde Meta pide un enlace de muestra y advierte
 * «do not use real customer information». Estas pruebas fijan las dos
 * propiedades de las que depende eso: que el enlace sea estable y que
 * nunca lleve datos de una persona real.
 */
import { describe, it, expect } from 'vitest'
import {
    NUMERO_DEMO,
    TOKEN_DEMO,
    construirTicketDePrueba,
    elegirSorteoDemo,
    CFG_TICKET_POR_DEFECTO,
    type SorteoDePrueba,
} from './boleto-demo'
import type { ConfiguracionTicket } from '@/lib/types'

const CFG: ConfiguracionTicket = {
    ...CFG_TICKET_POR_DEFECTO,
    nombre_comercial: 'Inversiones Héctor Cordero',
    rnc: '132966562',
    telefono: '8296190004',
    prefijo_numeracion: 'BOL',
}

const ACTIVO = {
    id: 's-act', nombre: 'El activo', premio: 'iPhone', fecha_fin: '2026-12-04',
    prefijo: 'ACT', estado: 'activo', created_at: '2026-01-01T00:00:00.000Z',
}
const BORRADOR = {
    id: 's-bor', nombre: 'El borrador', premio: null, fecha_fin: '2027-01-01',
    prefijo: 'BOR', estado: 'borrador', created_at: '2026-08-01T00:00:00.000Z',
}

describe('el enlace de ejemplo', () => {
    it('es un token corto y estable, no uno aleatorio', () => {
        // Si cambiara, la URL que Meta ya aprobó dejaría de funcionar.
        expect(TOKEN_DEMO).toBe('demo')
    })

    it('no puede chocar con un boleto real', () => {
        // Los tokens reales son 32 bytes en base64url: ~43 caracteres.
        expect(TOKEN_DEMO.length).toBeLessThan(20)
        expect(construirTicketDePrueba(CFG, null).token_publico).toBe(TOKEN_DEMO)
    })

    it('el número 0 no lo puede tener ningún boleto emitido', () => {
        // La numeración de cada sorteo arranca en 1.
        expect(NUMERO_DEMO).toBe(0)
        expect(construirTicketDePrueba(CFG, null).numero).toBe(0)
    })
})

describe('no lleva datos de ninguna persona real', () => {
    it('el cliente es inventado y el negocio es el de verdad', () => {
        const t = construirTicketDePrueba(CFG, ACTIVO)

        expect(t.snapshot.cliente.nombre).toBe('Juan')
        expect(t.snapshot.cliente.apellido).toBe('Pérez')
        expect(t.snapshot.cliente.id).toMatch(/^0{8}-0{4}-0{4}-0{4}-0{11}1$/)
        expect(t.snapshot.negocio.nombre_comercial).toBe('Inversiones Héctor Cordero')
        expect(t.snapshot.negocio.rnc).toBe('132966562')
    })

    it('no queda registrado: no tiene pago, ni deuda, ni quien lo emitió', () => {
        const t = construirTicketDePrueba(CFG, ACTIVO)

        expect(t.pago_id).toBeNull()
        expect(t.deuda_id).toBeNull()
        expect(t.emitido_por).toBeNull()
    })
})

describe('elegirSorteoDemo', () => {
    it('prefiere el activo aunque el borrador sea más nuevo', () => {
        expect(elegirSorteoDemo([BORRADOR, ACTIVO])?.prefijo).toBe('ACT')
    })

    it('sin activo, cae al borrador', () => {
        expect(elegirSorteoDemo([BORRADOR])?.prefijo).toBe('BOR')
    })

    it('sin nada usable devuelve null, y el boleto usa la numeración SN', () => {
        expect(elegirSorteoDemo([])).toBeNull()
        expect(elegirSorteoDemo(null)).toBeNull()
        expect(elegirSorteoDemo(undefined)).toBeNull()
        expect(elegirSorteoDemo([{ estado: 'cerrado' } as unknown as SorteoDePrueba]))
            .toBeNull()

        expect(construirTicketDePrueba(CFG, null).numero_formateado)
            .toBe('BOL-SN-000000')
    })

    it('con sorteo, el número usa su prefijo', () => {
        expect(construirTicketDePrueba(CFG, elegirSorteoDemo([ACTIVO]))
            .numero_formateado).toBe('ACT-000000')
    })
})
