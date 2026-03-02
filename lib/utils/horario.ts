const TIMEZONE = 'America/Santo_Domingo'

/**
 * Obtiene la hora actual en la zona horaria de RD (0-23).
 */
function getHoraRD(): number {
    return parseInt(
        new Date().toLocaleString('en-US', {
            timeZone: TIMEZONE,
            hour: 'numeric',
            hour12: false,
        }),
        10,
    )
}

/**
 * Verifica si la hora actual está dentro del horario laboral configurado.
 * Usa HORARIO_LABORAL_INICIO (default 8) y HORARIO_LABORAL_FIN (default 18).
 * Ejemplo: 8-18 = de 8:00 AM a 5:59 PM.
 */
export function estaEnHorarioLaboral(): boolean {
    const inicio = parseInt(process.env.HORARIO_LABORAL_INICIO ?? '8', 10)
    const fin = parseInt(process.env.HORARIO_LABORAL_FIN ?? '18', 10)
    const hora = getHoraRD()
    return hora >= inicio && hora < fin
}
