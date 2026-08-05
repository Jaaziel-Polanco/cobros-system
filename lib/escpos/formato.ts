/** Helpers de maquetación para papel de ancho fijo (48 columnas a 80 mm). */

export function linea(cols: number, char = '-'): string {
    return char.repeat(cols)
}

export function centrar(texto: string, cols: number): string {
    if (texto.length >= cols) return texto.slice(0, cols)
    const izquierda = Math.floor((cols - texto.length) / 2)
    return ' '.repeat(izquierda) + texto + ' '.repeat(cols - texto.length - izquierda)
}

/** Etiqueta pegada a la izquierda y valor pegado a la derecha. */
export function dosColumnas(izq: string, der: string, cols: number): string {
    // Si el valor por sí solo ya excede el ancho del papel, se recorta y se
    // descarta la etiqueta por completo. Se prioriza el valor (cédula, monto,
    // número de boleto) sobre la etiqueta porque es el dato que importa; dejar
    // que la línea se desborde no es una opción, porque la impresora la
    // envolvería o la cortaría a su antojo, no como decide este código.
    if (der.length > cols) return der.slice(0, cols)

    const disponible = Math.max(0, cols - der.length - 1)
    const izqRecortado = izq.slice(0, disponible)
    const relleno = cols - izqRecortado.length - der.length
    return izqRecortado + ' '.repeat(Math.max(0, relleno)) + der
}

/** Parte el texto en líneas de como máximo `cols` caracteres, por palabras. */
export function envolver(texto: string, cols: number): string[] {
    if (!texto) return ['']

    const lineas: string[] = []
    let actual = ''

    for (const palabra of texto.split(/\s+/)) {
        if (!palabra) continue

        // Palabra más larga que el ancho: se parte a la fuerza
        if (palabra.length > cols) {
            if (actual) { lineas.push(actual); actual = '' }
            for (let i = 0; i < palabra.length; i += cols) {
                const trozo = palabra.slice(i, i + cols)
                if (trozo.length === cols) lineas.push(trozo)
                else actual = trozo
            }
            continue
        }

        if (!actual) actual = palabra
        else if (actual.length + 1 + palabra.length <= cols) actual += ' ' + palabra
        else { lineas.push(actual); actual = palabra }
    }

    if (actual) lineas.push(actual)
    return lineas.length ? lineas : ['']
}
