import type { TicketSnapshot } from '@/lib/types'
import { aBytes, selectorCodepage } from './codificacion'
import { CMD, TAMANO, comandoQR, columnasEfectivas } from './comandos'
import { centrar, linea, dosColumnas, envolver } from './formato'

export interface TirillaInput {
    numeroFormateado: string
    snapshot: TicketSnapshot
    esCopia: boolean
    anchoCols: number
    codepage: string
    urlPublica: string
}

/**
 * Construye la tirilla del boleto.
 *
 * Devuelve los bytes listos para escribir en el socket de la impresora y una
 * vista previa en texto plano. La vista previa se guarda junto al trabajo de
 * impresión para poder depurar desde la interfaz sin descodificar base64.
 *
 * Toda la maquetación vive aquí, en el servidor: el agente local de las
 * sucursales no sabe nada del formato y no hay que actualizarlo para
 * cambiarlo.
 */
export function construirTirillaTicket(
    input: TirillaInput,
): { bytes: Buffer; preview: string } {
    const { numeroFormateado, snapshot: s, esCopia, anchoCols: cols, codepage, urlPublica } = input

    const partes: Buffer[] = []
    const previewLineas: string[] = []

    /** Escribe una línea de texto normal, codificada y con salto. */
    const escribir = (texto: string) => {
        partes.push(aBytes(texto, codepage), CMD.SALTO)
        previewLineas.push(texto)
    }

    /**
     * Escribe una línea con un modo de impresión distinto y vuelve a normal.
     *
     * `ESC ! n` es una máscara de bits, no un multiplicador: un modo con el
     * bit de doble ancho activo (p. ej. `TAMANO.MAXIMO`) hace que cada
     * carácter ocupe 2 columnas físicas del papel, así que a `cols`
     * columnas de ancho solo caben `cols / 2` caracteres, no `cols`. Si el
     * texto no cabe en el ancho físico real de este modo, se recorta —tanto
     * en los bytes como en la vista previa, con el mismo criterio, para que
     * la vista previa nunca mienta sobre lo que sale en el papel.
     */
    const escribirCon = (texto: string, modo: number, alineacion: 0 | 1 | 2 = 0) => {
        const anchoModo = columnasEfectivas(modo, cols)
        const limpio = texto.trim()
        const recortado = limpio.length > anchoModo ? limpio.slice(0, anchoModo) : limpio

        partes.push(CMD.alinear(alineacion), CMD.tamano(modo))
        partes.push(aBytes(recortado, codepage), CMD.SALTO)
        partes.push(CMD.tamano(TAMANO.NORMAL), CMD.alinear(0))
        // En la vista previa el centrado se simula con espacios
        previewLineas.push(alineacion === 1 ? centrar(recortado, cols) : recortado)
    }

    /**
     * Escribe el número del boleto, degradando el tamaño de letra en vez de
     * recortarlo si no cabe entero en el modo más grande.
     *
     * El número es el único dato de la tirilla que no puede salir mal: un
     * boleto con el número cortado deja de ser válido (no coincide con el
     * QR ni con el registro del sistema). Los boletos "huérfanos" (sin
     * sorteo asignado) usan el formato `{prefijo hasta 12}-SN-{6 dígitos}`,
     * hasta 22 caracteres, que no siempre cabe en `TAMANO.MAXIMO` (doble
     * ancho: la mitad de columnas disponibles) en papel angosto de 32
     * columnas. En vez de recortar, se prueban tamaños decrecientes —máximo,
     * doble, normal— hasta encontrar uno donde el número entero quepa; a
     * tamaño normal caben las `cols` columnas completas, así que siempre
     * hay un tamaño donde entra.
     */
    const escribirNumeroBoleto = (numero: string) => {
        const candidatos = [TAMANO.MAXIMO, TAMANO.DOBLE, TAMANO.NORMAL]
        const modo = candidatos.find((m) => numero.length <= columnasEfectivas(m, cols)) ?? TAMANO.NORMAL
        escribirCon(numero, modo, 1)
    }

    const separador = () => escribir(linea(cols))

    // ─── Cabecera ─────────────────────────────────────────────
    partes.push(CMD.INIT)
    partes.push(CMD.codepage(selectorCodepage(codepage)))
    partes.push(CMD.interlineado(30))
    partes.push(CMD.SALTO, CMD.SALTO)
    previewLineas.push('', '')

    separador()
    escribirCon(s.negocio.nombre_comercial.toUpperCase(), TAMANO.DOBLE, 1)
    if (s.negocio.rnc) escribir(centrar(`RNC: ${s.negocio.rnc}`, cols))
    if (s.negocio.telefono) escribir(centrar(`Tel: ${s.negocio.telefono}`, cols))
    separador()

    // ─── Título ───────────────────────────────────────────────
    escribir(centrar('BOLETO DE SORTEO', cols))
    if (esCopia) escribirCon('*** COPIA ***', TAMANO.NEGRITA, 1)
    escribir('')

    // ─── Número del boleto ────────────────────────────────────
    escribirNumeroBoleto(numeroFormateado)
    escribir('')

    // ─── Datos ────────────────────────────────────────────────
    const cliente = `${s.cliente.nombre} ${s.cliente.apellido}`
    for (const l of envolver(`Cliente:  ${cliente}`, cols)) escribir(l)
    if (s.cliente.dni_ruc) escribir(dosColumnas('Cedula/RNC:', s.cliente.dni_ruc, cols))
    escribir(dosColumnas('Fecha:', s.emitido_at_rd, cols))

    if (s.sorteo) {
        for (const l of envolver(`Sorteo:   ${s.sorteo.nombre}`, cols)) escribir(l)
        if (s.sorteo.premio) {
            for (const l of envolver(`Premio:   ${s.sorteo.premio}`, cols)) escribir(l)
        }
    }

    separador()

    // ─── QR ───────────────────────────────────────────────────
    partes.push(CMD.alinear(1))
    partes.push(comandoQR(urlPublica, 6))
    partes.push(CMD.SALTO)
    partes.push(CMD.alinear(0))
    previewLineas.push(centrar('[ QR ]', cols))
    escribir(centrar('Verifica tu boleto', cols))

    separador()

    // ─── Pie ──────────────────────────────────────────────────
    if (s.negocio.texto_legal) {
        for (const l of envolver(s.negocio.texto_legal, cols)) escribir(l)
    }
    if (s.negocio.pie_impresion) {
        for (const l of envolver(s.negocio.pie_impresion, cols)) escribir(l)
    }

    separador()
    partes.push(CMD.SALTO, CMD.SALTO, CMD.SALTO)
    previewLineas.push('', '', '')

    // ─── Corte ────────────────────────────────────────────────
    partes.push(CMD.CORTAR)

    return {
        bytes: Buffer.concat(partes),
        preview: previewLineas.join('\n'),
    }
}
