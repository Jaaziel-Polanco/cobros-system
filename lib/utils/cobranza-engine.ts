import { EtapaCobranza } from '@/lib/types'

/**
 * Calcula la etapa de cobranza en función de los días de atraso.
 */
export function getEtapaCobranza(diasAtraso: number): EtapaCobranza {
    if (diasAtraso <= 0) return 'preventivo'
    if (diasAtraso <= 15) return 'mora_temprana'
    if (diasAtraso <= 30) return 'mora_alta'
    return 'recuperacion'
}

/**
 * Retorna el intervalo mínimo en horas entre envíos según la etapa.
 *
 * Preventivo: 24h (un recordatorio por día como máximo dentro de la ventana de días antes).
 *   La ventana de preventivo ya controla cuándo se PUEDE enviar; el intervalo solo evita duplicados
 *   el mismo día. Antes era 7 días (168h) lo que bloqueaba envíos semanales tras un pago.
 *
 * Mora temprana / mora alta: config.frecuencia_mora_h (default 48h).
 * Recuperación: config.frecuencia_recuperacion_h (default 72h).
 */
export function getIntervaloEnvio(
    etapa: EtapaCobranza,
    config: { frecuencia_mora_h: number; frecuencia_recuperacion_h: number }
): number {
    switch (etapa) {
        case 'preventivo':
            return 24
        case 'mora_temprana':
        case 'mora_alta':
            return config.frecuencia_mora_h
        case 'recuperacion':
            return config.frecuencia_recuperacion_h
        default:
            return 9999
    }
}

/**
 * Calcula los días de atraso desde la fecha de corte.
 */
export function calcularDiasAtraso(fechaCorte: string): number {
    const corte = new Date(fechaCorte + 'T00:00:00')
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const diff = Math.floor((hoy.getTime() - corte.getTime()) / (1000 * 60 * 60 * 24))
    return Math.max(0, diff)
}

/** Shape mínimo que usa el cron / envíos (embed de Supabase o fila suelta). */
export interface ConfiguracionRecordatorioEnvio {
    dias_antes_vencimiento: number
    frecuencia_mora_h: number
    frecuencia_recuperacion_h: number
}

const DEFAULT_DIAS_ANTES_PREVENTIVO = 3
const DEFAULT_FREC_MORA_H = 48
const DEFAULT_FREC_RECUPERACION_H = 72

/**
 * Supabase puede devolver `configuracion_recordatorio(*)` como objeto o como array de una fila.
 * Sin esto, `config.dias_antes_vencimiento` puede ser undefined y el preventivo se comporta mal.
 * Si no hay fila embebida, se usan los mismos defaults que al crear la deuda.
 */
export function normalizarConfiguracionRecordatorio(embed: unknown): ConfiguracionRecordatorioEnvio {
    const row = Array.isArray(embed) ? embed[0] : embed
    if (!row || typeof row !== 'object') {
        return {
            dias_antes_vencimiento: DEFAULT_DIAS_ANTES_PREVENTIVO,
            frecuencia_mora_h: DEFAULT_FREC_MORA_H,
            frecuencia_recuperacion_h: DEFAULT_FREC_RECUPERACION_H,
        }
    }
    const o = row as Record<string, unknown>
    const dias = Number(o.dias_antes_vencimiento)
    const mora = Number(o.frecuencia_mora_h)
    const rec = Number(o.frecuencia_recuperacion_h)
    return {
        dias_antes_vencimiento:
            Number.isFinite(dias) && dias >= 0 ? dias : DEFAULT_DIAS_ANTES_PREVENTIVO,
        frecuencia_mora_h:
            Number.isFinite(mora) && mora > 0 ? mora : DEFAULT_FREC_MORA_H,
        frecuencia_recuperacion_h:
            Number.isFinite(rec) && rec > 0 ? rec : DEFAULT_FREC_RECUPERACION_H,
    }
}

/**
 * Verifica si un preventivo debe enviarse basado en dias_antes_vencimiento.
 * Solo envía si faltan <= N días para la fecha de corte (o ya venció).
 * Regla de negocio: SIEMPRE aplica en cron e intentarEnvioInmediato (no hay excepción por “primer envío”).
 */
export function debeEnviarPreventivo(
    fechaCorte: string,
    diasAntes: number | null | undefined
): boolean {
    const n = Number(diasAntes)
    const dias =
        Number.isFinite(n) && n >= 0 ? n : DEFAULT_DIAS_ANTES_PREVENTIVO
    const corte = new Date(fechaCorte + 'T00:00:00')
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const diasParaVencer = Math.floor((corte.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
    return diasParaVencer <= dias
}

/**
 * Verifica si se debe enviar un recordatorio dado el último envío.
 */
export function debeEnviar(
    ultimoEnvioAt: string | null,
    intervaloHoras: number
): boolean {
    if (!ultimoEnvioAt) return true
    const ultimo = new Date(ultimoEnvioAt)
    const ahora = new Date()
    const diffHoras = (ahora.getTime() - ultimo.getTime()) / (1000 * 60 * 60)
    return diffHoras >= intervaloHoras
}

/**
 * Etiquetas legibles por etapa.
 */
export const ETAPA_LABELS: Record<EtapaCobranza, string> = {
    preventivo: 'Preventivo',
    mora_temprana: 'Mora Temprana',
    mora_alta: 'Mora Alta',
    recuperacion: 'Recuperación',
    saldado: 'Saldado',
}
