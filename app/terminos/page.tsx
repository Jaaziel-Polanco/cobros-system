import { createClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { resolverRedireccionTerminos } from '@/lib/utils/terminos'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
    title: 'Bases y términos del Sorteo del Buen Pago',
    description:
        'Bases y términos completos de la promoción «Sorteo del Buen Pago» de '
        + 'Inversiones Héctor Cordero (Grupo Hemin, SRL).',
}

/**
 * ══════════════════════════════════════════════════════════════════
 *  DATOS DEL SORTEO VIGENTE
 *
 *  Todo lo que cambia de un sorteo al siguiente vive aquí arriba, junto:
 *  fechas, premios y canal de transmisión. Para publicar las bases del
 *  próximo sorteo basta con editar este bloque y las cláusulas 2 y 6.
 *
 *  El texto legal NO se lee de la base de datos a propósito. Estas bases
 *  se registran ante Pro Consumidor y se publican; un documento legal que
 *  cambia solo porque alguien editó un campo en un panel de administración
 *  es exactamente lo que no debe pasar. `configuracion_ticket.texto_legal`
 *  es otra cosa: la línea corta que se imprime en el papel del boleto.
 * ══════════════════════════════════════════════════════════════════
 */
const SORTEO = {
    nombre: 'Sorteo del Buen Pago',
    inicio: '15 de agosto de 2026',
    fin: '4 de diciembre de 2026',
    fechaSorteo: 'viernes 4 de diciembre de 2026',
    hora: '11:00 AM',
    canal: 'Facebook e Instagram Live',
    montoMinimo: 'RD$1,000.00',
}

const ORGANIZADOR = {
    razonSocial: 'GRUPO HEMIN, SRL',
    marca: 'Inversiones Héctor Cordero',
    rnc: '132-96656-2',
    direccion: 'Av. Vetilio Alfau Durán No. 92, Sector El Mercado',
    email: 'info@inversioneshectorcordero.com',
    telefono: '829-619-0004',
    telefonoLlamable: '+18296190004',
    sitio: 'www.inversioneshectorcordero.com',
}

const PREMIOS = [
    { puesto: 'Primer lugar', equipo: 'iPhone 13 Pro Max 128 GB', condicion: 'Usado certificado' },
    { puesto: 'Segundo lugar', equipo: 'Samsung Galaxy A17 128 GB', condicion: 'Nuevo' },
    { puesto: 'Tercer lugar', equipo: 'iPhone 11 64 GB', condicion: 'Usado certificado' },
]

type Bloque =
    | { p: string }
    | { lista: string[] }

interface Seccion {
    id: string
    titulo: string
    bloques: Bloque[]
}

const SECCIONES: Seccion[] = [
    {
        id: 'organizador',
        titulo: 'Organizador',
        bloques: [
            {
                p: `La promoción denominada «${SORTEO.nombre}» es organizada por `
                    + `${ORGANIZADOR.razonSocial}, empresa operadora de la marca comercial `
                    + `${ORGANIZADOR.marca}, RNC No. ${ORGANIZADOR.rnc}, con domicilio en `
                    + `${ORGANIZADOR.direccion}, correo electrónico ${ORGANIZADOR.email} y `
                    + `teléfono de contacto ${ORGANIZADOR.telefono}, en lo adelante denominada `
                    + '«EL ORGANIZADOR».',
            },
        ],
    },
    {
        id: 'vigencia',
        titulo: 'Vigencia',
        bloques: [
            { p: `La promoción tendrá vigencia desde el día ${SORTEO.inicio} hasta el día ${SORTEO.fin}, ambas fechas inclusive.` },
            { p: `El sorteo será realizado el día ${SORTEO.fechaSorteo}, a las ${SORTEO.hora}, en ${SORTEO.canal}.` },
            { p: 'No se generarán boletos por operaciones realizadas después de la fecha y hora de cierre.' },
        ],
    },
    {
        id: 'participantes',
        titulo: 'Personas que pueden participar',
        bloques: [
            {
                p: `Podrán participar las personas mayores de dieciocho (18) años que sean clientes de `
                    + `${ORGANIZADOR.marca} y que, durante el período de vigencia:`,
            },
            {
                lista: [
                    'Realicen una compra válida;',
                    'Efectúen un pago válido correspondiente a una obligación o servicio; o',
                    'Formalicen un acuerdo de pago aceptado por EL ORGANIZADOR.',
                ],
            },
            { p: 'La participación estará limitada a clientes debidamente identificados mediante cédula de identidad y electoral o pasaporte vigente.' },
        ],
    },
    {
        id: 'boletos',
        titulo: 'Generación de boletos',
        bloques: [
            { p: 'Por cada compra válida, pago válido o acuerdo de pago formalizado se generará un (1) boleto digital, identificado mediante un número único.' },
            { p: 'Los boletos serán asociados al nombre y documento de identidad del cliente y no podrán ser vendidos, cedidos, regalados, negociados ni transferidos a otra persona.' },
            { p: 'Los boletos no tienen valor monetario y no podrán ser cambiados por dinero, productos, descuentos o créditos.' },
            {
                p: `Para evitar la división artificial de pagos, los abonos parciales se acumularán hasta `
                    + `completar el valor mínimo de MIL PESOS DOMINICANOS (${SORTEO.montoMinimo}), momento en `
                    + 'el cual se generará el boleto correspondiente.',
            },
        ],
    },
    {
        id: 'no-validas',
        titulo: 'Operaciones no válidas',
        bloques: [
            { p: 'No generarán derecho de participación:' },
            {
                lista: [
                    'Pagos rechazados, anulados o reversados;',
                    'Transacciones fraudulentas o realizadas con información falsa;',
                    'Acuerdos de pago que no hayan sido formalmente aceptados;',
                    'Boletos duplicados por errores tecnológicos;',
                    'Operaciones posteriormente canceladas o declaradas inexistentes; y',
                    'Cualquier intento de manipular el sistema de generación o selección de boletos.',
                ],
            },
        ],
    },
    {
        id: 'premios',
        titulo: 'Premios',
        bloques: [
            { p: 'Los premios serán los siguientes:' },
            { lista: PREMIOS.map(p => `${p.puesto}: ${p.equipo}, condición ${p.condicion.toUpperCase()}.`) },
            { p: 'El color de los equipos estará sujeto a disponibilidad. La condición física, capacidad, número de serie o IMEI, accesorios incluidos y garantía aplicable serán establecidos en el acta de entrega.' },
            { p: 'Los premios no son transferibles ni podrán ser cambiados por dinero, otro modelo, crédito, saldo a favor o cualquier producto diferente.' },
        ],
    },
    {
        id: 'seleccion',
        titulo: 'Selección de los ganadores',
        bloques: [
            { p: 'Los ganadores serán seleccionados aleatoriamente entre todos los boletos válidos mediante ruleta virtual.' },
            { p: 'El proceso será grabado y realizado en presencia de notario público, levantándose la correspondiente constancia o acta.' },
            { p: 'Se seleccionarán tres (3) ganadores principales y, como mínimo, tres (3) ganadores alternos, en el orden correspondiente a cada premio.' },
            { p: 'Todos los participantes que cumplan estas bases tendrán iguales posibilidades de resultar ganadores por cada boleto válido que posean.' },
        ],
    },
    {
        id: 'un-premio',
        titulo: 'Un solo premio por participante',
        bloques: [
            { p: 'Cada participante solamente podrá recibir un premio.' },
            { p: 'Si una misma persona resulta seleccionada nuevamente, se anulará la segunda selección y se escogerá otro boleto de manera aleatoria.' },
        ],
    },
    {
        id: 'notificacion',
        titulo: 'Notificación',
        bloques: [
            { p: 'Los ganadores serán contactados mediante llamada telefónica, WhatsApp, mensaje de texto o cualquier otro medio verificable registrado en el sistema de EL ORGANIZADOR.' },
            { p: 'Se realizarán hasta tres (3) intentos de contacto durante un plazo máximo de cinco (5) días laborables.' },
            { p: 'Si el ganador no responde dentro de dicho plazo, no puede ser localizado o no cumple las presentes bases, el premio pasará al ganador alterno correspondiente.' },
        ],
    },
    {
        id: 'al-dia',
        titulo: 'Condición de estar al día',
        bloques: [
            { p: 'Para recibir el premio, el ganador deberá encontrarse al día en todas sus obligaciones vencidas con EL ORGANIZADOR.' },
            { p: 'En caso de presentar cuotas o compromisos vencidos al momento de ser notificado, contará con un plazo de setenta y dos (72) horas laborables para regularizar su situación.' },
            { p: 'Si no se pone al día dentro de dicho plazo, quedará descalificado y el premio será asignado al ganador alterno.' },
            { p: 'No se considerarán como atrasadas las cuotas cuya fecha de vencimiento todavía no haya llegado.' },
        ],
    },
    {
        id: 'entrega',
        titulo: 'Identificación y entrega personal',
        bloques: [
            { p: 'El ganador deberá presentarse personalmente en la sucursal indicada por EL ORGANIZADOR, mostrando el documento original utilizado para su registro:' },
            {
                lista: [
                    'Cédula de identidad y electoral; o',
                    'Pasaporte vigente, cuando corresponda.',
                ],
            },
            { p: 'No se entregarán premios a representantes, familiares, apoderados ni terceras personas.' },
            { p: 'El ganador deberá firmar un acta de entrega y recibo conforme en la que se hará constar el equipo recibido, su IMEI o número de serie, condición, accesorios y garantía aplicable.' },
        ],
    },
    {
        id: 'plazo',
        titulo: 'Plazo para retirar el premio',
        bloques: [
            { p: 'El ganador tendrá un plazo máximo de diez (10) días laborables, contados desde su validación definitiva, para retirar el premio.' },
            { p: 'Vencido el plazo sin una causa justificada y aceptada por EL ORGANIZADOR, el premio podrá ser entregado al ganador alterno correspondiente.' },
        ],
    },
    {
        id: 'impuestos',
        titulo: 'Impuestos',
        bloques: [
            { p: 'EL ORGANIZADOR gestionará las retenciones, declaraciones y demás obligaciones tributarias legalmente aplicables a la entrega de los premios.' },
            { p: 'No se exigirá al ganador ningún pago que no se encuentre expresamente indicado en estas bases y previamente informado conforme a la normativa aplicable.' },
        ],
    },
    {
        id: 'publicacion',
        titulo: 'Publicación de los ganadores',
        bloques: [
            { p: 'Para garantizar la transparencia de la promoción, los ganadores autorizan la publicación razonable de su nombre, inicial de apellido, fotografía o video de la entrega del premio en las redes sociales y medios de comunicación de EL ORGANIZADOR, sin recibir compensación adicional.' },
            { p: 'No serán publicados números de cédula, pasaporte, dirección, teléfono ni otros datos personales sensibles.' },
        ],
    },
    {
        id: 'excluidas',
        titulo: 'Personas excluidas',
        bloques: [
            { p: 'No podrán participar los propietarios, socios, administradores, empleados directos de EL ORGANIZADOR ni las personas que participen directamente en la organización, programación o selección de los ganadores.' },
            { p: 'También podrán excluirse sus cónyuges y familiares directos hasta el segundo grado de consanguinidad o afinidad.' },
        ],
    },
    {
        id: 'fraude',
        titulo: 'Fraude o manipulación',
        bloques: [
            { p: 'EL ORGANIZADOR podrá descalificar cualquier boleto o participante cuando existan evidencias verificables de fraude, suplantación de identidad, manipulación tecnológica, información falsa, duplicidad irregular o incumplimiento de estas bases.' },
            { p: 'Toda descalificación deberá quedar debidamente documentada.' },
        ],
    },
    {
        id: 'fuerza-mayor',
        titulo: 'Cambios por fuerza mayor',
        bloques: [
            { p: 'En caso de fuerza mayor o circunstancias fuera del control razonable de EL ORGANIZADOR, cualquier cambio de fecha, mecanismo o condición será previamente comunicado a Pro Consumidor y publicado por los mismos medios utilizados para anunciar la promoción.' },
            { p: 'Ningún cambio podrá disminuir injustificadamente el valor de los premios anunciados ni afectar los derechos adquiridos por los participantes.' },
        ],
    },
    {
        id: 'aceptacion',
        titulo: 'Aceptación',
        bloques: [
            { p: 'La participación en esta promoción implica el conocimiento y aceptación de las presentes bases y términos.' },
            { p: 'Cualquier situación no prevista será resuelta respetando la legislación dominicana, los derechos de los consumidores y las bases registradas ante Pro Consumidor.' },
        ],
    },
    {
        id: 'reclamaciones',
        titulo: 'Información y reclamaciones',
        bloques: [
            { p: `Las bases completas estarán disponibles en ${ORGANIZADOR.sitio}.` },
            { p: `También podrán consultarse en las sucursales de ${ORGANIZADOR.marca} y solicitarse mediante WhatsApp al ${ORGANIZADOR.telefono}.` },
        ],
    },
]

export default async function TerminosPage() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: cfg } = await supabase
        .from('configuracion_ticket')
        .select('url_terminos')
        .eq('id', true)
        .maybeSingle()

    const externa = resolverRedireccionTerminos(cfg?.url_terminos, process.env.APP_PUBLIC_URL)
    if (externa) redirect(externa)

    return (
        <main className="min-h-screen bg-[#0a1628] px-5 py-12 text-slate-300 print:bg-white print:text-black">
            <article className="mx-auto w-full max-w-3xl">

                <header className="border-b border-white/10 pb-8 print:border-black/20">
                    <p className="text-sm font-semibold text-[#007EC6]">
                        {ORGANIZADOR.marca}
                    </p>
                    <h1 className="mt-2 text-3xl font-bold leading-tight text-white print:text-black sm:text-4xl">
                        Bases y términos del {SORTEO.nombre}
                    </h1>
                    <p className="mt-4 text-sm leading-relaxed">
                        {ORGANIZADOR.razonSocial} · RNC {ORGANIZADOR.rnc}
                        <br />
                        {ORGANIZADOR.direccion}
                        <br />
                        <a href={`mailto:${ORGANIZADOR.email}`} className="underline underline-offset-2 hover:text-white">
                            {ORGANIZADOR.email}
                        </a>
                        {' · '}
                        <a href={`tel:${ORGANIZADOR.telefonoLlamable}`} className="underline underline-offset-2 hover:text-white">
                            {ORGANIZADOR.telefono}
                        </a>
                    </p>
                </header>

                {/* Resumen. No sustituye a las bases: solo evita que quien
                    escanea el QR desde el mostrador tenga que leer 19
                    cláusulas para saber cuándo es el sorteo. */}
                <section
                    aria-label="Resumen del sorteo"
                    className="mt-8 rounded-2xl border border-white/10 bg-slate-900/60 p-6 print:border-black/20 print:bg-transparent"
                >
                    <dl className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <dt className="text-xs uppercase tracking-widest text-slate-500">Vigencia</dt>
                            <dd className="mt-1 text-sm text-white print:text-black">
                                Del {SORTEO.inicio} al {SORTEO.fin}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-widest text-slate-500">Fecha del sorteo</dt>
                            <dd className="mt-1 text-sm text-white print:text-black">
                                {SORTEO.fechaSorteo}, {SORTEO.hora}
                            </dd>
                        </div>
                        <div className="sm:col-span-2">
                            <dt className="text-xs uppercase tracking-widest text-slate-500">Transmisión</dt>
                            <dd className="mt-1 text-sm text-white print:text-black">{SORTEO.canal}</dd>
                        </div>
                    </dl>

                    <ul className="mt-6 space-y-2 border-t border-white/10 pt-6 print:border-black/20">
                        {PREMIOS.map(premio => (
                            <li key={premio.puesto} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                                <span className="font-semibold text-[#007EC6]">{premio.puesto}:</span>
                                <span className="text-white print:text-black">{premio.equipo}</span>
                                <span className="text-slate-500">({premio.condicion})</span>
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Índice. Con 19 cláusulas, llegar a «cómo se entrega el
                    premio» sin un índice es desplazarse a ciegas. */}
                <nav aria-label="Índice" className="mt-10 print:hidden">
                    <h2 className="text-xs uppercase tracking-widest text-slate-500">Contenido</h2>
                    <ol className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                        {SECCIONES.map((seccion, i) => (
                            <li key={seccion.id}>
                                <a
                                    href={`#${seccion.id}`}
                                    className="text-slate-400 underline-offset-2 hover:text-white hover:underline"
                                >
                                    {i + 1}. {seccion.titulo}
                                </a>
                            </li>
                        ))}
                    </ol>
                </nav>

                <div className="mt-10 space-y-10">
                    {SECCIONES.map((seccion, i) => (
                        <section key={seccion.id} id={seccion.id} className="scroll-mt-8">
                            <h2 className="text-lg font-semibold text-white print:text-black">
                                <span className="text-[#007EC6]">{i + 1}.</span> {seccion.titulo}
                            </h2>
                            <div className="mt-3 space-y-3 text-sm leading-relaxed">
                                {seccion.bloques.map((bloque, j) =>
                                    'p' in bloque ? (
                                        <p key={j}>{bloque.p}</p>
                                    ) : (
                                        <ol
                                            key={j}
                                            className="ml-1 list-[lower-alpha] space-y-1.5 pl-5 marker:text-slate-500"
                                        >
                                            {bloque.lista.map(item => (
                                                <li key={item} className="pl-1">{item}</li>
                                            ))}
                                        </ol>
                                    ),
                                )}
                            </div>
                        </section>
                    ))}
                </div>

                <footer className="mt-14 border-t border-white/10 pt-8 text-xs leading-relaxed text-slate-500 print:border-black/20">
                    <p>
                        Promoción registrada ante Pro Consumidor. Consultas y reclamaciones
                        por WhatsApp al{' '}
                        <a href={`tel:${ORGANIZADOR.telefonoLlamable}`} className="underline underline-offset-2">
                            {ORGANIZADOR.telefono}
                        </a>{' '}
                        o en cualquier sucursal de {ORGANIZADOR.marca}.
                    </p>
                    <p className="mt-2">
                        {ORGANIZADOR.razonSocial} · RNC {ORGANIZADOR.rnc}
                    </p>
                </footer>

            </article>
        </main>
    )
}
