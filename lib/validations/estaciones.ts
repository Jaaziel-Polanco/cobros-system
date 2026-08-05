import { CODEPAGES } from '@/lib/escpos/codificacion'

/**
 * Ancho mínimo que garantiza que el número del boleto nunca se trunca:
 * el formato más largo posible ("{prefijo hasta 12}-SN-{6 dígitos}") mide
 * hasta 22 caracteres — ver escribirNumeroBoleto() en
 * lib/escpos/tirilla-ticket.ts, que degrada el tamaño de letra hasta
 * TAMANO.NORMAL (1 columna física por carácter) pero nunca por debajo.
 * Máximo generoso: nada real pasa de 80 columnas.
 */
export const ANCHO_COLS_MIN = 22
export const ANCHO_COLS_MAX = 80

/**
 * Valida ancho_cols y codepage.
 *
 * Reproducido en producción: ancho_cols = 0 hace que columnasEfectivas()
 * (lib/escpos/comandos.ts) divida por columnas 0 y CUALQUIER impresión de
 * esa sucursal revienta con "Invalid array length", no solo la de prueba.
 * ancho_cols = 4 no revienta, pero recorta el número del boleto, rompiendo
 * la invariante de la Tarea 2 de que el número nunca se trunca. Un
 * codepage mal escrito cae en silencio a cp850 (selectorCodepage() tiene
 * un `?? POR_DEFECTO`), así que un typo no avisa a nadie.
 *
 * Vive en un módulo aparte (no dentro de lib/actions/estaciones.ts) a
 * propósito: un archivo `'use server'` solo puede exportar funciones
 * async (es una restricción de compilación de Next.js), y esta es una
 * validación síncrona y pura que además conviene poder testear sin
 * arrastrar el runtime de Server Actions. `lib/actions/estaciones.ts` la
 * importa y la llama; el CHECK de la base
 * (20260730_08_estaciones_ancho_codepage.sql) cubre cualquier otra vía de
 * escritura que no pase por aquí.
 */
export function validarAnchoYCodepage(ancho_cols: number, codepage: string): void {
    if (!Number.isInteger(ancho_cols) || ancho_cols < ANCHO_COLS_MIN || ancho_cols > ANCHO_COLS_MAX) {
        throw new Error(
            `El ancho debe ser un número entero entre ${ANCHO_COLS_MIN} y ${ANCHO_COLS_MAX} columnas`,
        )
    }
    if (!(codepage in CODEPAGES)) {
        throw new Error(
            `Codepage no soportado: "${codepage}". Los válidos son ${Object.keys(CODEPAGES).join(', ')}`,
        )
    }
}
