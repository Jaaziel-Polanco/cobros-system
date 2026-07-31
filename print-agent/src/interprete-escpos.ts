import iconv from 'iconv-lite'

/**
 * Descodifica un flujo de bytes ESC/POS y devuelve una representación en
 * texto de cómo quedaría el papel: es el corazón del simulador.
 *
 * Solo entiende el subconjunto de comandos que emite `lib/escpos` del
 * servidor (INIT, codepage, interlineado, alineación, tamaño, corte, QR y
 * texto con saltos de línea). No es un intérprete ESC/POS general.
 */

/** Igual que CODEPAGES en lib/escpos/codificacion.ts, para no acoplar los dos paquetes. */
const CODEPAGES: Record<number, string> = {
    0: 'cp437',
    2: 'cp850',
    19: 'cp858',
    16: 'win1252',
}

interface Estado {
    codepage: string
    alineacion: 0 | 1 | 2
    negrita: boolean
    anchoDoble: boolean
    altoDoble: boolean
}

function estadoInicial(): Estado {
    return { codepage: 'cp850', alineacion: 0, negrita: false, anchoDoble: false, altoDoble: false }
}

function aplicarModo(estado: Estado, n: number): void {
    estado.negrita = !!(n & 0x08)
    estado.altoDoble = !!(n & 0x10)
    estado.anchoDoble = !!(n & 0x20)
}

function centrarEn(texto: string, cols: number): string {
    if (texto.length >= cols) return texto
    const izq = Math.floor((cols - texto.length) / 2)
    return ' '.repeat(izq) + texto
}

function decorarLinea(texto: string, estado: Estado, cols: number): string {
    let salida = texto
    if (estado.anchoDoble) salida = [...salida].map(c => c + c).join('')
    if (estado.negrita) salida = `**${salida}**`
    if (estado.altoDoble) salida = `[ALTO x2] ${salida}`

    if (estado.alineacion === 1) return centrarEn(salida, cols)
    if (estado.alineacion === 2 && salida.length < cols) {
        return ' '.repeat(cols - salida.length) + salida
    }
    return salida
}

export interface ResultadoInterprete {
    /** Cómo se vería el papel, línea por línea, listo para imprimir en consola. */
    lienzo: string
    /** Contenido de los códigos QR encontrados, en orden. */
    qrs: string[]
    /** true si el flujo terminó con el comando de corte. */
    cortado: boolean
}

export function interpretarEscPos(bytes: Buffer, anchoCols = 48): ResultadoInterprete {
    const estado = estadoInicial()
    const lineas: string[] = []
    const qrs: string[] = []
    let cortado = false
    let actual: number[] = []

    const flushLinea = () => {
        const texto = iconv.decode(Buffer.from(actual), estado.codepage)
        lineas.push(decorarLinea(texto, estado, anchoCols))
        actual = []
    }

    let i = 0
    while (i < bytes.length) {
        const b = bytes[i]

        // ESC @ — reinicializar
        if (b === 0x1b && bytes[i + 1] === 0x40) {
            Object.assign(estado, estadoInicial())
            i += 2
            continue
        }

        // ESC t n — codepage
        if (b === 0x1b && bytes[i + 1] === 0x74) {
            estado.codepage = CODEPAGES[bytes[i + 2]] ?? 'cp850'
            i += 3
            continue
        }

        // ESC 3 n — interlineado: no afecta el texto, se ignora visualmente
        if (b === 0x1b && bytes[i + 1] === 0x33) {
            i += 3
            continue
        }

        // ESC a n — alineación
        if (b === 0x1b && bytes[i + 1] === 0x61) {
            estado.alineacion = (bytes[i + 2] as 0 | 1 | 2) ?? 0
            i += 3
            continue
        }

        // ESC ! n — modo de impresión (tamaño/negrita)
        if (b === 0x1b && bytes[i + 1] === 0x21) {
            aplicarModo(estado, bytes[i + 2])
            i += 3
            continue
        }

        // GS V 0 — corte
        if (b === 0x1d && bytes[i + 1] === 0x56 && bytes[i + 2] === 0x00) {
            if (actual.length) flushLinea()
            cortado = true
            i += 3
            continue
        }

        // GS ( k — subcomandos de QR
        if (b === 0x1d && bytes[i + 1] === 0x28 && bytes[i + 2] === 0x6b) {
            const pL = bytes[i + 3]
            const pH = bytes[i + 4]
            const len = pL + pH * 256
            const cn = bytes[i + 5]
            const fn = bytes[i + 6]

            if (cn === 0x31 && fn === 0x50) {
                // 0x50 = 'P', guardar datos: [cn, fn, m, ...datos]
                const largoDatos = len - 3
                const datos = bytes.subarray(i + 8, i + 8 + largoDatos)
                const texto = datos.toString('utf8')
                qrs.push(texto)
                // Se inserta en el lugar del flujo donde ocurre, no al final:
                // así el simulador dibuja el QR donde va en el papel real.
                lineas.push(centrarEn(`[QR] ${texto}`, anchoCols))
            }

            i += 5 + len
            continue
        }

        // Salto de línea: cierra la línea acumulada
        if (b === 0x0a) {
            flushLinea()
            i += 1
            continue
        }

        // Byte de texto normal
        actual.push(b)
        i += 1
    }

    if (actual.length) flushLinea()

    const bordes = '+' + '-'.repeat(anchoCols + 2) + '+'
    const cuerpo = lineas.map(l => `| ${l.padEnd(anchoCols).slice(0, anchoCols)} |`)
    const pieCorte = cortado ? [' '.repeat(Math.floor(anchoCols / 2)) + '✂ - - - - corte - - - -'] : []

    const lienzo = [bordes, ...cuerpo, bordes, ...pieCorte].join('\n')

    return { lienzo, qrs, cortado }
}
