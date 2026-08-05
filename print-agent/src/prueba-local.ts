import type { DestinoImpresora } from './tipos'
import { describirDestino } from './estado'

/**
 * Tirilla de prueba que construye el PROPIO agente, sin pasar por el servidor.
 *
 * Por qué no se reutiliza la del servidor
 * ───────────────────────────────────────
 * El sistema ya tiene `imprimirPaginaDePrueba` (lib/actions/impresion.ts),
 * que encola un trabajo con `es_prueba = true`. Pero es una Server Action
 * con sesión de administrador: el agente no tiene sesión, tiene un token de
 * estación. Llegar hasta ella exigiría abrir un endpoint nuevo en el
 * servidor, y eso es exactamente lo que no se quiere.
 *
 * Y aunque se abriera, seguiría siendo la herramienta equivocada para este
 * botón. El botón de la interfaz local responde a una pregunta muy
 * concreta: **¿sale papel de esta impresora, desde esta PC?** Si la prueba
 * viaja por el servidor, no se puede contestar esa pregunta justo cuando
 * más falta hace —servidor caído, token de la otra tienda, red de la
 * sucursal sin salida—, porque el trabajo ni siquiera llegaría a encolarse.
 * Construyéndola aquí, la prueba recorre exactamente el tramo que se está
 * poniendo en duda (bytes -> winspool/RAW o socket TCP -> papel) y ninguno
 * más, no toca `print_jobs`, no compite con el índice de deduplicación de
 * boletos en vuelo, y funciona con el agente incomunicado.
 *
 * Lo que esta prueba NO comprueba, y hay que saberlo: no valida el
 * maquetador de tirillas del servidor (`lib/escpos`), porque no es su
 * código. Para el recorrido completo de punta a punta sigue estando el
 * botón "Imprimir página de prueba" de la pantalla Estaciones.
 *
 * El ancho y el codepage se toman de los que el servidor dijo en el
 * `hello`, así que la línea de acentos se imprime con la MISMA tabla de
 * caracteres con la que saldrán los boletos: si aquí se ve bien, allí
 * también.
 */

// ─── ESC/POS mínimo ────────────────────────────────────────────
// Copia deliberada de lo justo de `lib/escpos/comandos.ts` del servidor.
// El agente es un paquete aparte, sin acceso a ese código, y esto es un
// puñado de constantes de un estándar que no cambia.
const INIT = Buffer.from([0x1b, 0x40])
const SALTO = Buffer.from([0x0a])
const CORTAR = Buffer.from([0x1d, 0x56, 0x00])
const alinear = (n: 0 | 1 | 2) => Buffer.from([0x1b, 0x61, n])
const tamano = (n: number) => Buffer.from([0x1b, 0x21, n])
const codepageEscT = (n: number) => Buffer.from([0x1b, 0x74, n])

/** Valor de `n` en `ESC t n`. Mismos valores que CODEPAGES del servidor. */
const SELECTOR_CODEPAGE: Record<string, number> = {
    cp437: 0,
    cp850: 2,
    cp858: 19,
    cp1252: 16,
}

/**
 * Bytes de los caracteres castellanos en cada tabla de la impresora.
 *
 * El servidor usa `iconv-lite` para esto, pero aquí no puede haber ninguna
 * dependencia en tiempo de ejecución (`iconv-lite` es de desarrollo: solo
 * lo usa el simulador). Como el juego de caracteres que hace falta es
 * cerrado y conocido —lo que aparece en un nombre en español—, basta con
 * una tabla. Los valores están verificados contra `iconv-lite` para cada
 * tabla; cp437 no tiene mayúsculas acentuadas, y por eso no están.
 */
const TABLA_OEM: Record<string, number> = {
    'á': 0xa0, 'é': 0x82, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3,
    'ñ': 0xa4, 'Ñ': 0xa5, 'ü': 0x81, 'Ü': 0x9a,
    'ç': 0x87, 'Ç': 0x80, '¿': 0xa8, '¡': 0xad,
    'ª': 0xa6, 'º': 0xa7, '°': 0xf8, 'É': 0x90,
    // Comillas angulares y punto medio: no son adorno, salen impresas.
    // `describirDestino` escribe el nombre de la impresora como «POS», y
    // sin estas tres entradas la hoja de prueba decía «Windows ?POS?» —
    // justo el dato que hay que leer para saber si el nombre es el bueno.
    '«': 0xae, '»': 0xaf, '·': 0xfa,
}

/** Mayúsculas acentuadas que existen en cp850/cp858 pero NO en cp437. */
const TABLA_OEM_EXTENDIDA: Record<string, number> = {
    'Á': 0xb5, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9,
}

/** Quita los diacríticos: 'Á' -> 'A'. Último recurso antes de un '?'. */
function sinTildes(ch: string): string {
    return ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Convierte texto a los bytes de la tabla de caracteres de la impresora.
 *
 * Nunca `Buffer.from(texto)`: eso emite UTF-8 y la impresora lee un
 * codepage de un byte, así que "Muñoz" saldría "MuÃ±oz" en el papel. Lo que
 * no se puede representar se degrada a su letra sin tilde y, si ni eso,
 * a '?' — el mismo criterio que el servidor.
 */
export function codificar(texto: string, codepage: string): Buffer {
    const bytes: number[] = []
    const esWin1252 = codepage === 'cp1252'
    const admiteMayusculas = codepage === 'cp850' || codepage === 'cp858'

    for (const ch of texto) {
        const punto = ch.codePointAt(0) ?? 0x3f

        if (punto < 0x80) { bytes.push(punto); continue }

        // cp1252 coincide con Latin-1 en todo el rango que interesa aquí.
        if (esWin1252 && punto <= 0xff) { bytes.push(punto); continue }

        if (!esWin1252) {
            const directo = TABLA_OEM[ch] ?? (admiteMayusculas ? TABLA_OEM_EXTENDIDA[ch] : undefined)
            if (directo !== undefined) { bytes.push(directo); continue }
        }

        const plano = sinTildes(ch)
        if (plano && plano !== ch && /^[\x20-\x7e]+$/.test(plano)) {
            for (const c of plano) bytes.push(c.charCodeAt(0))
            continue
        }
        bytes.push(0x3f) // '?'
    }

    return Buffer.from(bytes)
}

function centrar(texto: string, cols: number): string {
    if (texto.length >= cols) return texto.slice(0, cols)
    return ' '.repeat(Math.floor((cols - texto.length) / 2)) + texto
}

/** dd/mm/aaaa hh:mm en la hora local de la PC. Sin `toLocaleString`, que
 *  depende de qué datos de idioma traiga esa instalación de Node. */
function fechaLocal(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface OpcionesPrueba {
    estacion: string | null
    sucursal: string | null
    destino: DestinoImpresora | null
    cols: number
    codepage: string
    ahora?: Date
}

/**
 * Devuelve los bytes ESC/POS de la tirilla de prueba y su vista previa en
 * texto, para poder enseñar en la interfaz lo mismo que debería salir del
 * papel aunque la impresora no responda.
 */
export function construirTirillaPrueba(
    opciones: OpcionesPrueba,
): { bytes: Buffer; vistaPrevia: string } {
    const { estacion, sucursal, destino, cols, codepage } = opciones
    const ahora = opciones.ahora ?? new Date()

    const separador = '='.repeat(cols)
    const lineas: string[] = [
        separador,
        centrar('PAGINA DE PRUEBA', cols),
        centrar('del agente de impresion', cols),
        separador,
        '',
        'Esta hoja la genera el agente en esta',
        'misma PC. No pasa por el servidor ni',
        'por la cola de impresion.',
        '',
        `Estacion:  ${estacion ?? '(el servidor no ha contestado)'}`,
        `Sucursal:  ${sucursal ?? '(el servidor no ha contestado)'}`,
        `Impresora: ${describirDestino(destino)}`,
        `Papel:     ${cols} columnas`,
        `Codepage:  ${codepage}`,
        `Fecha:     ${fechaLocal(ahora)}`,
        '',
        '-'.repeat(cols),
        'Prueba de acentos:',
        'Munoz -> Muñoz    Pena -> Peña',
        'aeiou -> áéíóú    AEIOU -> ÁÉÍÓÚ',
        'nN -> ñÑ   uU -> üÜ   ¿? ¡!',
        '-'.repeat(cols),
        '',
        'Si estas leyendo esto en papel, la',
        'impresora esta bien conectada a esta PC',
        'y el agente puede imprimir.',
        '',
        'Si las letras con tilde de arriba se',
        'ven raras, avisa a soporte: hay que',
        'cambiar el codepage de esta estacion',
        'en el sistema.',
        '',
        separador,
        '', '', '',
    ]

    const partes: Buffer[] = [
        INIT,
        codepageEscT(SELECTOR_CODEPAGE[codepage] ?? SELECTOR_CODEPAGE.cp850),
        Buffer.from([0x1b, 0x33, 30]), // ESC 3 n — mismo interlineado que el servidor
        tamano(0x00),
        alinear(0),
    ]

    for (const l of lineas) {
        partes.push(codificar(l, codepage), SALTO)
    }
    partes.push(CORTAR)

    return { bytes: Buffer.concat(partes), vistaPrevia: lineas.join('\n') }
}
