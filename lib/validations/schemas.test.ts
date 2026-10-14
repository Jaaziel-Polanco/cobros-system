import { describe, it, expect } from 'vitest'
import { DeudaSchema } from './schemas'

const valida = {
    cliente_id: '11111111-1111-4111-8111-111111111111',
    montos_activos: false,
    frecuencia_pago: 'mensual',
    fecha_corte: '2026-10-30',
    es_deuda_existente: false,
    dias_antes_vencimiento: 3,
    frecuencia_mora_h: 48,
    frecuencia_recuperacion_h: 72,
}

describe('DeudaSchema — fecha_corte', () => {
    it('acepta una fecha normal', () => {
        expect(DeudaSchema.safeParse(valida).success).toBe(true)
    })

    it('rechaza el año mal tecleado (0026), que el cron convertía en 730 000 días de atraso', () => {
        const r = DeudaSchema.safeParse({ ...valida, fecha_corte: '0026-01-30' })

        expect(r.success).toBe(false)
        expect(JSON.stringify(r.error?.issues)).toMatch(/fecha_corte/)
    })
})
