import type { TicketSnapshot } from '@/lib/types'
import { aBytes, selectorCodepage } from './codificacion'
import { CMD, TAMANO, comandoQR } from './comandos'
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

    /** Escribe una línea con un modo de impresión distinto y vuelve a normal. */
    const escribirCon = (texto: string, modo: number, alineacion: 0 | 1 | 2 = 0) => {
        partes.push(CMD.alinear(alineacion), CMD.tamano(modo))
        partes.push(aBytes(texto.trim(), codepage), CMD.SALTO)
        partes.push(CMD.tamano(TAMANO.NORMAL), CMD.alinear(0))
        // En la vista previa el centrado se simula con espacios
        previewLineas.push(alineacion === 1 ? centrar(texto.trim(), cols) : texto.trim())
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
    escribirCon(numeroFormateado, TAMANO.MAXIMO, 1)
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
