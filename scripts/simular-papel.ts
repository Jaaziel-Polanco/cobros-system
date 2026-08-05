/**
 * Vista previa del papel, sin impresora, sin agente y sin servidor.
 *
 * Construye la tirilla con el MISMO código que usa el servidor
 * (lib/escpos/tirilla-ticket.ts) y la pasa por el MISMO intérprete que usa
 * el simulador de red (interprete-escpos.ts), que es el que traduce los
 * bytes ESC/POS a "cómo quedaría el papel". O sea: lo que sale aquí es lo
 * que saldría por la impresora, salvo por la tipografía.
 *
 * Sirve para revisar la maquetación —márgenes, cortes de línea, qué entra en
 * 48 columnas, cómo degrada el número cuando es largo— sin montar nada.
 * Para probar el recorrido completo (web -> API -> cola -> agente ->
 * impresora), ver el apartado 6 del README.
 *
 *   npm run papel
 *   npm run papel -- --cols 32       (papel de 58 mm)
 */

import { construirTirillaTicket } from '../lib/escpos/tirilla-ticket'
import type { TicketSnapshot } from '../lib/types'
import { interpretarEscPos } from '../print-agent/src/interprete-escpos'

const args = process.argv.slice(2)
const idxCols = args.indexOf('--cols')
const ANCHO = idxCols >= 0 ? Number(args[idxCols + 1]) : 48
const CODEPAGE = 'cp850'

/** Configuración real del negocio, tal y como está en configuracion_ticket. */
const NEGOCIO = {
    nombre_comercial: 'Inversiones Héctor Cordero',
    rnc: '132966562',
    direccion: '',
    telefono: '8296190004',
    texto_legal: 'esto es una prueba',
    url_terminos: null,
    pie_impresion: '',
    logo_url: null,
}

const CLIENTE = {
    id: '00000000-0000-0000-0000-000000000001',
    nombre: 'María Altagracia',
    apellido: 'Muñoz Peña',
    telefono: '8095551234',
    dni_ruc: '001-1234567-8',
}

function snapshot(sorteo: TicketSnapshot['sorteo']): TicketSnapshot {
    return {
        cliente: CLIENTE,
        sorteo,
        negocio: NEGOCIO,
        emitido_at_rd: '31/07/2026 10:42 AM',
        origen: 'automatico',
        version_snapshot: 1,
    } as TicketSnapshot
}

const SORTEO = {
    id: '00000000-0000-0000-0000-0000000000aa',
    nombre: 'Gran Sorteo de Navidad',
    premio: 'Un televisor Smart TV de 55 pulgadas',
    fecha_fin: '2026-12-24',
}

const CASOS = [
    {
        titulo: 'Boleto normal, con sorteo activo',
        nota: 'Lo que se imprime el 99 % de las veces.',
        numero: 'NAV-000042',
        snap: snapshot(SORTEO),
        esCopia: false,
    },
    {
        titulo: 'Reimpresión del mismo boleto',
        nota: 'Marcado COPIA. El sistema lo marca solo a partir de la segunda impresión, para que nadie cobre dos veces con el mismo papel.',
        numero: 'NAV-000042',
        snap: snapshot(SORTEO),
        esCopia: true,
    },
    {
        titulo: 'Boleto huérfano (sin sorteo abierto)',
        nota: 'Es lo que saldría HOY: todavía no hay ningún sorteo creado. Se numera aparte y luego se asigna en masa desde /tickets.',
        numero: 'BOL-SN-000001',
        snap: snapshot(null),
        esCopia: false,
    },
    {
        titulo: 'Nombre y premio largos',
        nota: 'El caso que rompe maquetaciones: comprueba que nada se sale de las columnas ni se corta a medias.',
        numero: 'NAV-000007',
        snap: snapshot({
            ...SORTEO,
            nombre: 'Sorteo Aniversario 25 Años Inversiones Héctor Cordero',
            premio: 'Una motocicleta 0 km más un año de seguro pagado y un bono de RD$25,000 en efectivo',
        }),
        esCopia: false,
    },
]

for (const caso of CASOS) {
    const { bytes } = construirTirillaTicket({
        numeroFormateado: caso.numero,
        snapshot: caso.snap,
        esCopia: caso.esCopia,
        anchoCols: ANCHO,
        codepage: CODEPAGE,
        urlPublica: 'https://cobros.example.com/t/8Kj2mNpQ7rStUvWxYz0123456789AbCdEfGh',
    })

    const { lienzo, qrs, cortado } = interpretarEscPos(bytes, ANCHO)

    console.log('')
    console.log('═'.repeat(ANCHO + 4))
    console.log(`  ${caso.titulo}`)
    console.log(`  ${caso.nota}`)
    console.log('═'.repeat(ANCHO + 4))
    console.log(lienzo)
    console.log(
        `  ${bytes.length} bytes · ${ANCHO} col · ${CODEPAGE} · corte ${cortado ? 'sí' : 'NO'}` +
            (qrs.length ? `\n  QR -> ${qrs[0]}` : ''),
    )
}

console.log('')
console.log('  El QR lleva a la página pública del boleto. El cliente lo escanea')
console.log('  y ve su número sin tener que guardar el papel.')
console.log('')
