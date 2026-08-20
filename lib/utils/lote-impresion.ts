/**
 * Decisiones puras de la impresión por lotes.
 *
 * Viven fuera de `lib/actions/impresion-lote.ts` porque un archivo
 * `'use server'` solo puede exportar funciones asíncronas: ahí dentro esto
 * no se podría probar sin una base de datos delante. Y la primera de las dos
 * es la que impide imprimir boletos ajenos, así que tener que montar
 * Supabase para comprobarla sería justo la excusa para no comprobarla.
 */

/** Tope de ids que se aceptan del navegador en una sola petición. */
export const MAX_IDS_RECIBIDOS = 10_000

export type SeleccionLote =
    | { modo: 'todos' }
    | { modo: 'seleccion'; ticketIds: string[] }

/**
 * Qué boletos se van a encolar de verdad.
 *
 * `delSorteo` son los boletos que pertenecen al sorteo, leídos en el
 * servidor. `seleccion` viene del navegador.
 *
 * **El cruce no es una validación cosmética.** La inserción de los trabajos
 * va con el cliente admin, que no pasa por RLS, porque un lote de sorteo
 * cruza carteras por definición y la policy de INSERT de `print_jobs` exige
 * que el boleto sea del agente. Sin este filtro, cualquiera con permiso de
 * imprimir podría mandar ids inventados en la petición y sacar por su
 * impresora el boleto de cualquier cliente del sistema —con su nombre y su
 * cédula enmascarada— sin pasar por ninguna comprobación.
 *
 * `modo: 'todos'` ignora cualquier id: se resuelve entero en el servidor.
 * Así «todos» son todos, y no «los que el navegador tenía cargados».
 */
export function resolverObjetivoDelLote(
    delSorteo: ReadonlySet<string>,
    seleccion: SeleccionLote,
): string[] {
    if (seleccion.modo === 'todos') return [...delSorteo]

    if (seleccion.ticketIds.length > MAX_IDS_RECIBIDOS) {
        throw new Error('Demasiados boletos en una sola petición')
    }

    // El Set deduplica: un id repetido en la petición no debe encolar dos
    // trabajos ni contar dos veces en el resumen.
    const pedidos = new Set(seleccion.ticketIds)
    return [...pedidos].filter(id => delSorteo.has(id))
}

export type DestinoBoleto = 'encolar' | 'copia' | 'anulado' | 'ya-en-cola'

/**
 * Qué hacer con un boleto del lote.
 *
 * El orden de las comprobaciones importa: un boleto anulado que además
 * tuviera un trabajo en vuelo debe contarse una sola vez, y como anulado,
 * que es la razón por la que no se va a imprimir.
 */
export function destinoDelBoleto(boleto: {
    anulado: boolean
    enCola: boolean
    vecesImpreso: number
}): DestinoBoleto {
    if (boleto.anulado) return 'anulado'
    if (boleto.enCola) return 'ya-en-cola'
    // Un boleto se imprime al emitirse, así que casi todo lo que se
    // reimprime en lote sale marcado `***** COPIA *****`.
    return boleto.vecesImpreso > 0 ? 'copia' : 'encolar'
}
