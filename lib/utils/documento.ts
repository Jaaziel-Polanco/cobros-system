/**
 * Enmascarado de documentos de identidad (cédula / RNC).
 *
 * Vive aquí, y no junto al PDF donde nació, porque lo necesitan dos caminos
 * muy distintos: el PDF que se manda por WhatsApp
 * (lib/pdf/ticket-document.tsx) y la tirilla ESC/POS que sale por la
 * impresora (lib/escpos/tirilla-ticket.ts). El módulo del PDF arrastra
 * `@react-pdf/renderer`, así que importarlo desde el camino de impresión
 * habría metido el motor de PDF entero en las rutas de la cola de
 * impresión, que se ejecutan en cada sondeo del agente.
 *
 * Que los dos usen la MISMA función es la razón de fondo: si el papel y el
 * PDF enmascararan distinto, el mismo boleto revelaría más por una vía que
 * por la otra, y nadie se enteraría hasta verlos lado a lado.
 */

/**
 * Deja visibles solo los dos últimos dígitos, conservando la puntuación.
 *
 *   "001-1234567-8"  ->  "***-******7-8"
 *   "40233459698"    ->  "*********98"
 *
 * Devuelve `null` para valores vacíos, para que quien llame decida si
 * omitir la línea entera.
 */
export function enmascararDocumento(valor: string | null | undefined): string | null {
    if (!valor) return null

    const totalDigitos = (valor.match(/\d/g) ?? []).length
    // Con 2 dígitos o menos no queda nada que ocultar más allá de "los
    // últimos dos": se devuelve tal cual, sin asteriscos.
    if (totalDigitos <= 2) return valor

    const primerDigitoVisible = totalDigitos - 2
    let vistos = 0
    let resultado = ''
    for (const c of valor) {
        if (/\d/.test(c)) {
            resultado += vistos < primerDigitoVisible ? '*' : c
            vistos++
        } else {
            resultado += c
        }
    }
    return resultado
}
