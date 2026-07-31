/**
 * Utilidades de fecha ancladas a la zona horaria de República Dominicana.
 *
 * Todo cálculo de fechas de negocio (rangos de sorteo, "hoy", fechas impresas)
 * debe pasar por aquí. RD es UTC-4 todo el año, pero el desplazamiento se
 * calcula dinámicamente con Intl en lugar de asumirse, para que el código
 * siga siendo correcto si eso cambiara.
 */

export const TZ_RD = 'America/Santo_Domingo'

/**
 * Desplazamiento de RD respecto a UTC, en minutos, para un instante dado.
 * Devuelve un número negativo (RD va por detrás de UTC).
 */
function offsetMinutosRD(instante: Date): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ_RD,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })

    const partes: Record<string, string> = {}
    for (const parte of dtf.formatToParts(instante)) {
        if (parte.type !== 'literal') partes[parte.type] = parte.value
    }

    const comoSiFueraUTC = Date.UTC(
        Number(partes.year),
        Number(partes.month) - 1,
        Number(partes.day),
        Number(partes.hour),
        Number(partes.minute),
        Number(partes.second),
    )

    const instanteSinMs = Math.floor(instante.getTime() / 1000) * 1000
    return (comoSiFueraUTC - instanteSinMs) / 60_000
}

/**
 * Convierte una hora de pared de RD al instante UTC equivalente.
 * Itera dos veces para converger si el desplazamiento cambiara en la frontera.
 */
function instanteRDaUTC(
    fecha: string,
    hora: number,
    minuto: number,
    segundo: number,
    ms: number,
): Date {
    const [anio, mes, dia] = fecha.split('-').map(Number)
    const comoUTC = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo, ms)

    let t = comoUTC
    for (let i = 0; i < 2; i++) {
        t = comoUTC - offsetMinutosRD(new Date(t)) * 60_000
    }
    return new Date(t)
}

/** Fecha de hoy en RD, en formato 'YYYY-MM-DD'. */
export function hoyRD(): string {
    // 'en-CA' produce YYYY-MM-DD de forma estable
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ_RD,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date())
}

/**
 * Convierte un rango de fechas RD (inclusivo en ambos extremos) al rango de
 * instantes UTC que hay que usar al consultar columnas `timestamptz`.
 */
export function rangoRDaUTC(
    desde: string,
    hasta: string,
): { desdeISO: string; hastaISO: string } {
    return {
        desdeISO: instanteRDaUTC(desde, 0, 0, 0, 0).toISOString(),
        hastaISO: instanteRDaUTC(hasta, 23, 59, 59, 999).toISOString(),
    }
}

/** Formatea un instante ISO como 'DD/MM/YYYY hh:mm a. m.' en hora RD. */
export function formatearFechaHoraRD(iso: string): string {
    return new Intl.DateTimeFormat('es-DO', {
        timeZone: TZ_RD,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    }).format(new Date(iso))
}

/**
 * Formatea una fecha de calendario ('YYYY-MM-DD', columnas DATE como
 * `sorteos.fecha_inicio` o `sorteo_ejecuciones.rango_desde`) como
 * 'DD/MM/YYYY'.
 *
 * Deliberadamente sin pasar por `Date`: una columna DATE no es un instante,
 * y `new Date('2026-07-25')` se interpreta como medianoche UTC, que en hora
 * RD (UTC-4) es el 24/07 a las 20:00. Formatearla como si fuera un instante
 * la mueve un día hacia atrás — en un sorteo, eso es mostrar un rango de
 * fechas que no es el que se usó para elegir a los ganadores.
 */
export function formatearFechaCalendario(fecha: string): string {
    const [anio, mes, dia] = fecha.split('-')
    if (!anio || !mes || !dia) return fecha
    return `${dia}/${mes}/${anio}`
}

/** Formatea un instante ISO como 'DD/MM/YYYY' en hora RD. */
export function formatearFechaRD(iso: string): string {
    return new Intl.DateTimeFormat('es-DO', {
        timeZone: TZ_RD,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(new Date(iso))
}
