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
 * Orden de urgencia de las etapas: cuando a un mismo teléfono le tocan varias
 * deudas en una corrida, se le escribe sólo por la más urgente.
 */
export const URGENCIA_ETAPA: Record<EtapaCobranza, number> = {
    saldado: 0,
    preventivo: 1,
    mora_temprana: 2,
    mora_alta: 3,
    recuperacion: 4,
}

/**
 * Clave para reconocer el mismo teléfono escrito de formas distintas.
 *
 * En producción un mismo número aparece en clientes distintos (registros
 * duplicados) y con formatos distintos; el anti-duplicado por teléfono sólo
 * funciona si todos caen en la misma clave. Se quedan los dígitos y se quita
 * el prefijo de país `1` de los números de 11 cifras (+1 809/829/849…).
 * Devuelve `null` si no queda un número usable.
 */
export function normalizarTelefono(telefono: string | null | undefined): string | null {
    const digitos = (telefono ?? '').replace(/\D/g, '')
    const sinPais = digitos.length === 11 && digitos.startsWith('1') ? digitos.slice(1) : digitos
    return sinPais.length >= 7 ? sinPais : null
}

/**
 * `fecha_corte` utilizable: una fecha real (AAAA-MM-DD) entre 2000 y 2100.
 *
 * En producción hay deudas con el año tecleado como `0026`: el motor les
 * calcula 730 000 días de atraso y la plantilla se los dice al cliente.
 */
export function fechaCorteValida(fecha: unknown): boolean {
    if (typeof fecha !== 'string') return false
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
    if (!m) return false
    const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (anio < 2000 || anio > 2100) return false
    const d = new Date(Date.UTC(anio, mes - 1, dia))
    return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
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
