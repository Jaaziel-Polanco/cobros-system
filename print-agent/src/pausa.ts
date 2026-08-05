/**
 * La pausa del agente: dejar de reclamar boletos sin apagar nada.
 *
 * Para qué sirve
 * ──────────────
 * Cambiar el rollo de papel, destrabar la impresora, moverla de sitio.
 * Hasta ahora la única opción era parar el servicio de Windows —que casi
 * nadie en una tienda sabe hacer, y que además apaga esta misma página, la
 * única herramienta que tiene delante— o dejar que los boletos fallen
 * mientras tanto.
 *
 * Qué hace exactamente
 * ────────────────────
 * En pausa, el bucle **no llama a `poll`**. Y no llamar a `poll` es la
 * única forma correcta de hacer esto: los trabajos no se reclaman, así que
 * se quedan en `pendiente` en el servidor, con sus intentos intactos, y
 * salen solos en cuanto se reanude. Cualquier otra variante —reclamarlos y
 * guardarlos aquí, reclamarlos y descartarlos— convertiría la pausa en una
 * forma nueva de perder boletos.
 *
 * Efecto secundario que hay que conocer: sin `poll` tampoco hay latido, así
 * que en la pantalla **Estaciones** del sistema esta caja va a aparecer
 * como desconectada al cabo de un rato. Es incómodo pero es la verdad —no
 * está tomando trabajos— y se prefiere a lo contrario: mandar un latido
 * artificial dejaría la estación en verde mientras los boletos se
 * acumulan, que es exactamente el tipo de fallo silencioso que este módulo
 * lleva tiempo persiguiendo.
 *
 * Por qué NO se guarda en disco
 * ─────────────────────────────
 * La pausa vive solo en memoria a propósito. Si alguien la deja puesta y se
 * va a su casa, reiniciar el agente —o simplemente prender la PC al día
 * siguiente— la quita. La alternativa (guardarla en el `.env`) haría que
 * una caja pudiera amanecer en pausa sin que nadie recuerde por qué, y una
 * tienda que no puede cobrar al abrir es mucho peor que una pausa que se
 * pierde.
 */

/** Cada cuánto se vuelve a apuntar en `agente.log` que sigue en pausa.
 *
 *  El cartel de la página solo lo ve quien la tiene abierta. Quien mira el
 *  registro por teléfono, media hora después, necesita encontrarse con que
 *  esta caja lleva parada desde las 10:15 — y no con un silencio que se
 *  parece demasiado al de un agente muerto. */
export const MINUTOS_ENTRE_AVISOS = 5

export interface EstadoPausa {
    pausado: boolean
    /** ISO del momento en que se pausó, o null. */
    desde: string | null
    /** Minutos completos que lleva pausado. 0 si no lo está. */
    minutos: number
}

const pausa = {
    desde: null as number | null,
    /** Última vez que se dejó constancia en el registro. */
    ultimoAviso: 0,
}

export function estaPausado(): boolean {
    return pausa.desde !== null
}

export function estadoPausa(ahora = Date.now()): EstadoPausa {
    if (pausa.desde === null) return { pausado: false, desde: null, minutos: 0 }
    return {
        pausado: true,
        desde: new Date(pausa.desde).toISOString(),
        minutos: Math.max(0, Math.floor((ahora - pausa.desde) / 60_000)),
    }
}

/** Pausar dos veces no reinicia el contador: seguiría llevando el mismo
 *  rato parado, y el cartel debe decir la verdad sobre desde cuándo. */
export function pausar(ahora = Date.now()): EstadoPausa {
    if (pausa.desde === null) {
        pausa.desde = ahora
        pausa.ultimoAviso = 0
    }
    return estadoPausa(ahora)
}

export function reanudar(ahora = Date.now()): EstadoPausa {
    pausa.desde = null
    pausa.ultimoAviso = 0
    return estadoPausa(ahora)
}

/**
 * ¿Toca dejar constancia en `agente.log` de que sigue en pausa?
 *
 * Devuelve `true` la primera vez y después una vez cada
 * `MINUTOS_ENTRE_AVISOS`. Anotarlo en cada vuelta del bucle (una por
 * segundo) llenaría el registro de ruido y taparía justo lo que se está
 * buscando cuando se abre.
 */
export function tocaAvisarEnRegistro(ahora = Date.now()): boolean {
    if (pausa.desde === null) return false
    if (ahora - pausa.ultimoAviso < MINUTOS_ENTRE_AVISOS * 60_000) return false
    pausa.ultimoAviso = ahora
    return true
}

/** Solo para las pruebas: deja el módulo como recién cargado. */
export function reiniciarPausa(): void {
    pausa.desde = null
    pausa.ultimoAviso = 0
}
