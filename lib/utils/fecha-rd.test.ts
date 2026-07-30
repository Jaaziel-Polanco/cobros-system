import { describe, it, expect } from 'vitest'
import { rangoRDaUTC, formatearFechaHoraRD, formatearFechaRD, TZ_RD } from './fecha-rd'

describe('TZ_RD', () => {
    it('apunta a la zona horaria de República Dominicana', () => {
        expect(TZ_RD).toBe('America/Santo_Domingo')
    })
})

describe('rangoRDaUTC', () => {
    it('convierte el inicio del día RD al instante UTC correcto', () => {
        // RD es UTC-4 todo el año: 00:00 del 29 en RD son las 04:00 UTC del 29
        const { desdeISO } = rangoRDaUTC('2026-07-29', '2026-07-29')
        expect(desdeISO).toBe('2026-07-29T04:00:00.000Z')
    })

    it('convierte el final del día RD al instante UTC correcto', () => {
        // 23:59:59.999 del 29 en RD son las 03:59:59.999 UTC del 30
        const { hastaISO } = rangoRDaUTC('2026-07-29', '2026-07-29')
        expect(hastaISO).toBe('2026-07-30T03:59:59.999Z')
    })

    it('incluye un boleto emitido a las 9 PM hora RD en el día correcto', () => {
        // 2026-07-30T01:30:00Z son las 9:30 PM del 29 en RD
        const emitido = new Date('2026-07-30T01:30:00.000Z')
        const { desdeISO, hastaISO } = rangoRDaUTC('2026-07-29', '2026-07-29')

        expect(emitido >= new Date(desdeISO)).toBe(true)
        expect(emitido <= new Date(hastaISO)).toBe(true)
    })

    it('excluye un boleto emitido a las 00:30 hora RD del día siguiente', () => {
        // 2026-07-30T04:30:00Z son las 00:30 AM del 30 en RD
        const emitido = new Date('2026-07-30T04:30:00.000Z')
        const { hastaISO } = rangoRDaUTC('2026-07-29', '2026-07-29')

        expect(emitido > new Date(hastaISO)).toBe(true)
    })

    it('soporta rangos de varios días', () => {
        const { desdeISO, hastaISO } = rangoRDaUTC('2026-07-01', '2026-07-31')
        expect(desdeISO).toBe('2026-07-01T04:00:00.000Z')
        expect(hastaISO).toBe('2026-08-01T03:59:59.999Z')
    })
})

describe('formatearFechaHoraRD', () => {
    it('muestra la fecha en hora RD, no en UTC', () => {
        // Este instante ya es día 30 en UTC pero sigue siendo día 29 en RD
        expect(formatearFechaHoraRD('2026-07-30T01:30:00.000Z')).toContain('29/07/2026')
    })
})

describe('formatearFechaRD', () => {
    it('formatea solo la fecha en hora RD', () => {
        expect(formatearFechaRD('2026-07-30T01:30:00.000Z')).toBe('29/07/2026')
    })
})
