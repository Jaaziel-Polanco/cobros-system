/**
 * Secuencias ESC/POS. Los valores están tomados del servicio de referencia
 * que ya funciona contra las impresoras 2Connect de la empresa
 * (printer-service/services/escpos.ts), ampliados con codepage y QR.
 */

/** Valores de n para `ESC ! n` (modo de impresión). */
export const TAMANO = {
    NORMAL: 0x00,
    NEGRITA: 0x08,
    DOBLE: 0x11,      // doble ancho y doble alto
    MAXIMO: 0x30,     // cuádruple, para el número del boleto
} as const

export const CMD = {
    /** `ESC @` — reinicia la impresora. Siempre primero. */
    INIT: Buffer.from([0x1b, 0x40]),

    /** `ESC t n` — selecciona la tabla de caracteres. */
    codepage: (n: number) => Buffer.from([0x1b, 0x74, n]),

    /** `ESC 3 n` — interlineado en puntos. 30 ≈ 4 mm, igual que la referencia. */
    interlineado: (n: number) => Buffer.from([0x1b, 0x33, n]),

    /** `ESC a n` — 0 izquierda, 1 centro, 2 derecha. */
    alinear: (n: 0 | 1 | 2) => Buffer.from([0x1b, 0x61, n]),

    /** `ESC ! n` — modo de impresión. Usa las constantes de TAMANO. */
    tamano: (n: number) => Buffer.from([0x1b, 0x21, n]),

    /** `GS V 0` — corte total del papel. */
    CORTAR: Buffer.from([0x1d, 0x56, 0x00]),

    SALTO: Buffer.from('\n', 'latin1'),
} as const

/**
 * `GS ( k` — imprime un código QR.
 * Modelo 2, corrección de errores M. `tamano` va de 1 a 16.
 */
export function comandoQR(datos: string, tamano = 6): Buffer {
    const bytes = Buffer.from(datos, 'utf8')
    const longitud = bytes.length + 3
    const pL = longitud & 0xff
    const pH = (longitud >> 8) & 0xff

    return Buffer.concat([
        // Seleccionar modelo 2
        Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
        // Tamaño del módulo
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, tamano]),
        // Nivel de corrección de errores: 0x31 = M
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
        // Guardar los datos en el búfer del símbolo
        Buffer.from([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
        bytes,
        // Imprimir el símbolo guardado
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
    ])
}
