import iconv from 'iconv-lite'

/**
 * Codepages soportados por las impresoras ESC/POS.
 * `escT` es el valor de n en el comando `ESC t n` que selecciona la tabla.
 */
export const CODEPAGES: Record<string, { escT: number; iconv: string }> = {
    cp437:  { escT: 0,  iconv: 'cp437' },
    cp850:  { escT: 2,  iconv: 'cp850' },
    cp858:  { escT: 19, iconv: 'cp858' },
    cp1252: { escT: 16, iconv: 'win1252' },
}

const POR_DEFECTO = CODEPAGES.cp850

function resolver(codepage: string) {
    return CODEPAGES[codepage] ?? POR_DEFECTO
}

/** ¿Sobrevive este carácter a una ida y vuelta por el codepage? */
function representable(ch: string, iconvName: string): boolean {
    return iconv.decode(iconv.encode(ch, iconvName), iconvName) === ch
}

/**
 * Sustituye los caracteres que el codepage no puede representar.
 * Primero intenta quitarles los diacríticos ('ā' → 'a'); si eso tampoco
 * funciona, los reemplaza por '?'.
 *
 * NOTA (no resuelto, exposición baja): este `for...of` itera por punto de
 * código, así que un carácter astral (fuera del plano básico, como la
 * mayoría de los emoji) se procesa como una sola unidad aquí, pero
 * `texto.length` —que es lo que usan `centrar` y `dosColumnas` de
 * `formato.ts` para calcular el relleno— lo cuenta como 2 (un par
 * subrogado UTF-16), mientras que tras el fold se convierte en 1 solo byte
 * ('?'). Un nombre de cliente con un emoji desalinearía esa línea en una
 * columna. No es habitual en nombres reales y no se arregla aquí; si
 * aparece una línea torcida en producción, empezar a mirar por aquí.
 */
function folder(texto: string, iconvName: string): string {
    let salida = ''
    for (const ch of texto) {
        if (representable(ch, iconvName)) {
            salida += ch
            continue
        }
        const plano = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
        salida += plano && plano !== ch && representable(plano, iconvName) ? plano : '?'
    }
    return salida
}

/**
 * Convierte texto a los bytes que espera la impresora.
 *
 * Nunca uses `Buffer.from(texto)` para esto: emite UTF-8, y la impresora
 * interpreta un codepage de un byte. Un apellido como "Muñoz" saldría como
 * "MuÃ±oz" en el papel.
 */
export function aBytes(texto: string, codepage: string): Buffer {
    const cfg = resolver(codepage)
    return iconv.encode(folder(texto, cfg.iconv), cfg.iconv)
}

/** Valor de n para `ESC t n` según el codepage. */
export function selectorCodepage(codepage: string): number {
    return resolver(codepage).escT
}
