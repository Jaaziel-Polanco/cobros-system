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
 */
export function getIntervaloEnvio(
    etapa: EtapaCobranza,
    config: { frecuencia_mora_h: number; frecuencia_recuperacion_h: number }
): number {
    switch (etapa) {
        case 'preventivo':
            return 24 * 7
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

/**
 * Verifica si un preventivo debe enviarse basado en dias_antes_vencimiento.
 * Solo envía si faltan <= N días para la fecha de corte (o ya venció).
 */
export function debeEnviarPreventivo(fechaCorte: string, diasAntes: number): boolean {
    const corte = new Date(fechaCorte + 'T00:00:00')
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const diasParaVencer = Math.floor((corte.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
    return diasParaVencer <= diasAntes
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
