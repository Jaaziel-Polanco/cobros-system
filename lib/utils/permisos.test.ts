import { describe, it, expect } from 'vitest'
import { getPermisos, tienePermiso } from './permisos'
import { DEFAULT_PERMISOS_AGENTE } from '@/lib/types'

describe('getPermisos', () => {
    it('da todos los permisos al admin, aunque su columna esté vacía', () => {
        const permisos = getPermisos({ rol: 'admin', permisos: null })
        for (const clave of Object.keys(DEFAULT_PERMISOS_AGENTE)) {
            expect(permisos[clave as keyof typeof permisos]).toBe(true)
        }
    })

    it('usa los valores por defecto cuando el agente no tiene permisos guardados', () => {
        const permisos = getPermisos({ rol: 'agente', permisos: null })
        expect(permisos).toEqual(DEFAULT_PERMISOS_AGENTE)
    })

    it('rellena con los valores por defecto las claves que faltan', () => {
        // Un agente guardado antes de que existieran los permisos de boletos
        const permisos = getPermisos({
            rol: 'agente',
            permisos: { ver_logs: true, ver_webhooks: false } as never,
        })
        expect(permisos.ver_tickets).toBe(DEFAULT_PERMISOS_AGENTE.ver_tickets)
        expect(permisos.ver_logs).toBe(true)
        expect(permisos.ver_webhooks).toBe(false)
    })

    it('respeta un false explícito por encima del valor por defecto', () => {
        const permisos = getPermisos({
            rol: 'agente',
            permisos: { ver_tickets: false } as never,
        })
        expect(permisos.ver_tickets).toBe(false)
    })
})

describe('tienePermiso', () => {
    it('devuelve true para el admin en cualquier permiso', () => {
        expect(tienePermiso({ rol: 'admin', permisos: null }, 'realizar_sorteo')).toBe(true)
    })

    it('devuelve false para un agente sin el permiso', () => {
        expect(tienePermiso({ rol: 'agente', permisos: null }, 'realizar_sorteo')).toBe(false)
    })
})
