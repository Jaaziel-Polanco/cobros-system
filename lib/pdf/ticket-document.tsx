import {
    Document, Page, Text, View, StyleSheet, Image, renderToBuffer,
} from '@react-pdf/renderer'
import type { Ticket } from '@/lib/types'

/**
 * Se usan las fuentes estándar del formato PDF (Helvetica, codificación
 * WinAnsi) a propósito: cubren ñ y vocales acentuadas sin tener que
 * empaquetar archivos TTF, que romperían el build `standalone` de Docker.
 */
const estilos = StyleSheet.create({
    pagina: { padding: 48, fontFamily: 'Helvetica', fontSize: 11, color: '#0f172a' },
    cabecera: {
        flexDirection: 'row', justifyContent: 'space-between',
        alignItems: 'flex-start', marginBottom: 24,
        borderBottomWidth: 2, borderBottomColor: '#007EC6', paddingBottom: 12,
    },
    logo: { width: 64, height: 64, objectFit: 'contain' },
    negocio: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#007EC6' },
    negocioLinea: { fontSize: 9, color: '#64748b', marginTop: 2 },
    titulo: {
        fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'center',
        letterSpacing: 2, marginBottom: 4, color: '#334155',
    },
    numeroCaja: {
        borderWidth: 2, borderColor: '#0f172a', borderStyle: 'dashed',
        paddingVertical: 20, marginVertical: 16, alignItems: 'center',
    },
    numero: { fontSize: 34, fontFamily: 'Helvetica-Bold', letterSpacing: 3 },
    anulado: {
        fontSize: 13, fontFamily: 'Helvetica-Bold',
        color: '#dc2626', textAlign: 'center', marginTop: 6,
    },
    fila: { flexDirection: 'row', marginBottom: 6 },
    etiqueta: { width: 110, color: '#64748b' },
    valor: { flex: 1, fontFamily: 'Helvetica-Bold' },
    seccion: { marginTop: 18 },
    legal: {
        marginTop: 28, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0',
        fontSize: 8, color: '#64748b', lineHeight: 1.5,
    },
})

/**
 * Enmascara un documento de identidad (cédula/RNC) dejando visibles solo
 * los dos últimos dígitos; el resto de los dígitos se sustituye por '*',
 * conservando cualquier separador (guiones, espacios, etc.) en su posición
 * original para que el formato se siga reconociendo.
 *
 * Se aplica solo a la presentación en el PDF: el snapshot y la base de
 * datos guardan el valor completo. El PDF viaja por WhatsApp, se reenvía y
 * queda en capturas y respaldos de chats; el boleto es solo un número de
 * rifa, así que la cédula completa no hace falta ahí. Volver a mostrarla
 * entera, si el negocio lo decide más adelante, es un cambio de una línea.
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

export function TicketDocument({ ticket }: { ticket: Ticket }) {
    const s = ticket.snapshot
    const cliente = `${s.cliente.nombre} ${s.cliente.apellido}`
    const documentoEnmascarado = enmascararDocumento(s.cliente.dni_ruc)

    return (
        <Document
            title={`Boleto ${ticket.numero_formateado}`}
            author={s.negocio.nombre_comercial}
        >
            <Page size="LETTER" style={estilos.pagina}>
                <View style={estilos.cabecera}>
                    <View>
                        <Text style={estilos.negocio}>{s.negocio.nombre_comercial}</Text>
                        {s.negocio.rnc && (
                            <Text style={estilos.negocioLinea}>RNC: {s.negocio.rnc}</Text>
                        )}
                        {s.negocio.direccion && (
                            <Text style={estilos.negocioLinea}>{s.negocio.direccion}</Text>
                        )}
                        {s.negocio.telefono && (
                            <Text style={estilos.negocioLinea}>Tel: {s.negocio.telefono}</Text>
                        )}
                    </View>
                    {s.negocio.logo_url && (
                        <Image style={estilos.logo} src={s.negocio.logo_url} />
                    )}
                </View>

                <Text style={estilos.titulo}>BOLETO DE SORTEO</Text>

                <View style={estilos.numeroCaja}>
                    <Text style={estilos.numero}>{ticket.numero_formateado}</Text>
                    {ticket.estado === 'anulado' && (
                        <Text style={estilos.anulado}>BOLETO ANULADO</Text>
                    )}
                </View>

                <View style={estilos.seccion}>
                    <View style={estilos.fila}>
                        <Text style={estilos.etiqueta}>Cliente</Text>
                        <Text style={estilos.valor}>{cliente}</Text>
                    </View>
                    {documentoEnmascarado && (
                        <View style={estilos.fila}>
                            <Text style={estilos.etiqueta}>Cédula / RNC</Text>
                            <Text style={estilos.valor}>{documentoEnmascarado}</Text>
                        </View>
                    )}
                    <View style={estilos.fila}>
                        <Text style={estilos.etiqueta}>Fecha de emisión</Text>
                        <Text style={estilos.valor}>{s.emitido_at_rd}</Text>
                    </View>
                    {s.sorteo && (
                        <>
                            <View style={estilos.fila}>
                                <Text style={estilos.etiqueta}>Sorteo</Text>
                                <Text style={estilos.valor}>{s.sorteo.nombre}</Text>
                            </View>
                            {s.sorteo.premio && (
                                <View style={estilos.fila}>
                                    <Text style={estilos.etiqueta}>Premio</Text>
                                    <Text style={estilos.valor}>{s.sorteo.premio}</Text>
                                </View>
                            )}
                        </>
                    )}
                </View>

                <View style={estilos.legal}>
                    {s.negocio.texto_legal && <Text>{s.negocio.texto_legal}</Text>}
                    {s.negocio.url_terminos && (
                        <Text>Términos y condiciones: {s.negocio.url_terminos}</Text>
                    )}
                    {s.negocio.pie_impresion && <Text>{s.negocio.pie_impresion}</Text>}
                </View>
            </Page>
        </Document>
    )
}

/** Genera el PDF en memoria. Nunca se escribe a disco ni a la base de datos. */
export async function generarTicketPdf(ticket: Ticket): Promise<Buffer> {
    return renderToBuffer(<TicketDocument ticket={ticket} />)
}
