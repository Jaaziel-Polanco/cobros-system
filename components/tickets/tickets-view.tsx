'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, Download, Send, Ban, Gift, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
    enviarTicketWhatsApp, anularTicket, asignarTicketsASorteo, type FiltrosTickets,
} from '@/lib/actions/tickets'
import { formatearFechaHoraRD } from '@/lib/utils/fecha-rd'
import { ESTADO_TICKET_COLORS, ESTADO_TICKET_LABELS, ORIGEN_TICKET_LABELS } from '@/lib/types'
import type { EstadoSorteo, TicketConRelaciones } from '@/lib/types'

interface TicketsViewProps {
    tickets: TicketConRelaciones[]
    /** `estado` es opcional por compatibilidad, pero la página lo envía: sin
     *  él, el desplegable de asignación ofrecería sorteos cerrados, que el
     *  RPC `asignar_tickets_a_sorteo` rechaza siempre. */
    sorteos: { id: string; nombre: string; estado?: EstadoSorteo }[]
    puedeAnular: boolean
    puedeAsignarSorteo: boolean
    /** Filtros ya aplicados en el servidor (leídos de la URL). Sirven para
     *  que los controles arranquen mostrando el mismo estado que produjo la
     *  lista recibida en `tickets`. */
    filtrosIniciales: FiltrosTickets
}

export function TicketsView({ tickets, sorteos, puedeAnular, puedeAsignarSorteo, filtrosIniciales }: TicketsViewProps) {
    const router = useRouter()
    const [busqueda, setBusqueda] = useState('')
    const [estadoFiltro, setEstadoFiltro] = useState(filtrosIniciales.estado ?? '')
    const [origenFiltro, setOrigenFiltro] = useState(filtrosIniciales.origen ?? '')
    const [sorteoFiltro, setSorteoFiltro] = useState(filtrosIniciales.sorteoId ?? '')
    const [soloHuerfanos, setSoloHuerfanos] = useState(filtrosIniciales.soloHuerfanos ?? false)
    const [desde, setDesde] = useState(filtrosIniciales.desde ?? '')
    const [hasta, setHasta] = useState(filtrosIniciales.hasta ?? '')
    const [seleccionados, setSeleccionados] = useState<string[]>([])
    const [sorteoDestino, setSorteoDestino] = useState('')
    const [pendiente, startTransition] = useTransition()

    // El modo de asignación solo existe con el filtro de huérfanos activo: es
    // el único listado en el que todos los boletos son asignables.
    const modoAsignacion = soloHuerfanos && puedeAsignarSorteo
    const sorteosAsignables = useMemo(
        () => sorteos.filter(s => s.estado !== 'cerrado'),
        [sorteos],
    )

    // Estado, origen, sorteo, huérfanos y rango de fechas ya se filtraron en
    // el servidor (getTickets recibe estos mismos valores vía searchParams,
    // ver app/(dashboard)/tickets/page.tsx). Aquí solo se refina, en el
    // cliente, la búsqueda por número sobre el resultado ya acotado -- así
    // no hace falta una ida y vuelta al servidor por cada tecla.
    const filtrados = useMemo(() => {
        const term = busqueda.trim().toLowerCase()
        if (!term) return tickets
        return tickets.filter(t => t.numero_formateado.toLowerCase().includes(term))
    }, [tickets, busqueda])

    // Solo los boletos válidos son asignables: el RPC descarta los anulados
    // en silencio, así que ofrecer su casilla sería ofrecer una acción que no
    // hace nada.
    const asignables = useMemo(
        () => filtrados.filter(t => t.estado === 'valido'),
        [filtrados],
    )

    // Al cambiar de listado (filtros, recarga tras asignar) se descartan las
    // selecciones que ya no están en pantalla: nunca se envía un id que el
    // usuario no está viendo marcado. Es un filtro sobre lo marcado, no un
    // estado aparte, así que se deriva en el render: guardarlo en `useState`
    // desde un efecto solo añadiría un repintado y una ventana en la que lo
    // enviado y lo visible no coinciden.
    const seleccionVisible = useMemo(() => {
        if (!modoAsignacion) return []
        const visibles = new Set(asignables.map(t => t.id))
        return seleccionados.filter(id => visibles.has(id))
    }, [modoAsignacion, asignables, seleccionados])

    const alternarSeleccion = (id: string) => {
        setSeleccionados(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
        )
    }

    const todosMarcados = asignables.length > 0 && seleccionVisible.length === asignables.length

    const asignar = () => {
        if (!sorteoDestino || seleccionVisible.length === 0) return
        const idsEnviados = seleccionVisible
        startTransition(async () => {
            try {
                const r = await asignarTicketsASorteo(idsEnviados, sorteoDestino)

                // El número que se muestra es el REAL, no el que se marcó: la
                // acción solo asigna los que siguen huérfanos y válidos.
                toast.success(
                    `${r.asignados} ${r.asignados === 1 ? 'boleto asignado' : 'boletos asignados'}`,
                )

                if (r.rechazadosPorNumero.length > 0) {
                    // El RPC devuelve ids, nunca datos de boleto; los números
                    // se resuelven aquí, contra la lista que ya está en
                    // pantalla, sin pedirle más al servidor.
                    const numeros = r.rechazadosPorNumero
                        .map(id => tickets.find(t => t.id === id)?.numero_formateado ?? id)
                    toast.warning(
                        `${numeros.length} sin asignar por número repetido en ese sorteo: ${numeros.join(', ')}`,
                        { duration: 12000 },
                    )
                }

                const noTocados = idsEnviados.length - r.asignados - r.rechazadosPorNumero.length
                if (noTocados > 0) {
                    toast.info(
                        `${noTocados} ya no estaban disponibles (otro usuario los asignó o se anularon).`,
                    )
                }

                setSeleccionados([])
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    /** Recalcula la URL con los filtros vigentes y navega, lo que hace que
     *  el Server Component vuelva a llamar getTickets() con el WHERE
     *  correspondiente. Los cambios que aún no llegan al estado de React
     *  (porque setX es asíncrono) se pasan explícitos en `cambios`. */
    const actualizarFiltros = (cambios: Partial<{
        estado: string
        origen: string
        sorteoId: string
        soloHuerfanos: boolean
        desde: string
        hasta: string
    }>) => {
        const next = {
            estado: cambios.estado ?? estadoFiltro,
            origen: cambios.origen ?? origenFiltro,
            sorteoId: cambios.sorteoId ?? sorteoFiltro,
            soloHuerfanos: cambios.soloHuerfanos ?? soloHuerfanos,
            desde: cambios.desde ?? desde,
            hasta: cambios.hasta ?? hasta,
        }
        const params = new URLSearchParams()
        if (next.estado) params.set('estado', next.estado)
        if (next.origen) params.set('origen', next.origen)
        if (next.soloHuerfanos) {
            params.set('soloHuerfanos', '1')
        } else if (next.sorteoId) {
            params.set('sorteoId', next.sorteoId)
        }
        if (next.desde) params.set('desde', next.desde)
        if (next.hasta) params.set('hasta', next.hasta)
        const qs = params.toString()
        router.replace(qs ? `/tickets?${qs}` : '/tickets')
    }

    const handleEstadoChange = (v: string) => {
        const val = v === 'todos' ? '' : v
        setEstadoFiltro(val)
        actualizarFiltros({ estado: val })
    }

    const handleOrigenChange = (v: string) => {
        const val = v === 'todos' ? '' : v
        setOrigenFiltro(val)
        actualizarFiltros({ origen: val })
    }

    const handleSorteoChange = (v: string) => {
        const val = v === 'todos' ? '' : v
        setSorteoFiltro(val)
        actualizarFiltros({ sorteoId: val })
    }

    const handleSoloHuerfanosChange = (v: boolean) => {
        setSoloHuerfanos(v)
        // Salir (o entrar) del modo de asignación descarta lo marcado: es una
        // consecuencia directa de este clic, así que se hace aquí y no en un
        // efecto que reaccione al cambio.
        setSeleccionados([])
        actualizarFiltros({ soloHuerfanos: v })
    }

    const handleDesdeChange = (v: string) => {
        setDesde(v)
        actualizarFiltros({ desde: v })
    }

    const handleHastaChange = (v: string) => {
        setHasta(v)
        actualizarFiltros({ hasta: v })
    }

    const reenviar = (ticketId: string) => {
        startTransition(async () => {
            try {
                await enviarTicketWhatsApp(ticketId, { reenvio: true })
                toast.success('Boleto reenviado')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    const anular = (ticketId: string) => {
        const motivo = window.prompt('Motivo de la anulación:')
        if (!motivo || motivo.trim().length < 3) return
        startTransition(async () => {
            try {
                await anularTicket(ticketId, motivo.trim())
                toast.success('Boleto anulado')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    return (
        <div className="space-y-4">
            {/* Filtros */}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                        value={busqueda}
                        onChange={e => setBusqueda(e.target.value)}
                        placeholder="Buscar por número..."
                        className="pl-9 bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
                    />
                </div>
                <Select value={estadoFiltro || 'todos'} onValueChange={handleEstadoChange}>
                    <SelectTrigger className="w-40 bg-slate-800 border-white/10 text-white">
                        <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/10 text-white">
                        <SelectItem value="todos">Todos</SelectItem>
                        <SelectItem value="valido">Válido</SelectItem>
                        <SelectItem value="anulado">Anulado</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={origenFiltro || 'todos'} onValueChange={handleOrigenChange}>
                    <SelectTrigger className="w-40 bg-slate-800 border-white/10 text-white">
                        <SelectValue placeholder="Origen" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/10 text-white">
                        <SelectItem value="todos">Todos</SelectItem>
                        <SelectItem value="automatico">Automático</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                </Select>
                <Select
                    value={sorteoFiltro || 'todos'}
                    disabled={soloHuerfanos}
                    onValueChange={handleSorteoChange}
                >
                    <SelectTrigger className="w-48 bg-slate-800 border-white/10 text-white disabled:opacity-40">
                        <SelectValue placeholder="Sorteo" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/10 text-white">
                        <SelectItem value="todos">Todos los sorteos</SelectItem>
                        {sorteos.map(s => (
                            <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                    <Label htmlFor="desde" className="text-sm text-slate-400">Desde</Label>
                    <Input
                        id="desde"
                        type="date"
                        value={desde}
                        onChange={e => handleDesdeChange(e.target.value)}
                        className="w-40 bg-slate-800 border-white/10 text-white"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Label htmlFor="hasta" className="text-sm text-slate-400">Hasta</Label>
                    <Input
                        id="hasta"
                        type="date"
                        value={hasta}
                        onChange={e => handleHastaChange(e.target.value)}
                        className="w-40 bg-slate-800 border-white/10 text-white"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        id="solo-huerfanos"
                        checked={soloHuerfanos}
                        onCheckedChange={handleSoloHuerfanosChange}
                    />
                    <Label htmlFor="solo-huerfanos" className="text-sm text-slate-300 cursor-pointer">
                        Solo huérfanos
                    </Label>
                </div>
            </div>

            {/* Barra de asignación masiva de huérfanos */}
            {modoAsignacion && (
                <div className="flex flex-col gap-3 rounded-xl border border-[#007EC6]/20 bg-[#007EC6]/5 p-4 sm:flex-row sm:items-center">
                    <Gift className="h-5 w-5 shrink-0 text-[#007EC6]" />
                    <p className="flex-1 text-sm text-slate-300">
                        {seleccionVisible.length === 0
                            ? 'Marca los boletos sin sorteo que quieras asignar.'
                            : `${seleccionVisible.length} ${seleccionVisible.length === 1 ? 'boleto seleccionado' : 'boletos seleccionados'}`}
                    </p>
                    <Select value={sorteoDestino} onValueChange={setSorteoDestino}>
                        <SelectTrigger className="w-full bg-slate-800 border-white/10 text-white sm:w-56">
                            <SelectValue placeholder="Sorteo de destino" />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-white/10 text-white">
                            {sorteosAsignables.length === 0 ? (
                                <SelectItem value="__vacio" disabled>
                                    No hay sorteos abiertos
                                </SelectItem>
                            ) : sorteosAsignables.map(s => (
                                <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        onClick={asignar}
                        disabled={pendiente || seleccionVisible.length === 0 || !sorteoDestino}
                        className="gap-2 text-white disabled:opacity-40"
                        style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)' }}
                    >
                        {pendiente
                            ? <><Loader2 className="h-4 w-4 animate-spin" />Asignando...</>
                            : <>Asignar {seleccionVisible.length} {seleccionVisible.length === 1 ? 'boleto' : 'boletos'}</>}
                    </Button>
                </div>
            )}

            {/* Tabla */}
            <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-white/5 text-slate-500 text-xs">
                                {modoAsignacion && (
                                    <th className="p-4 w-10">
                                        <input
                                            type="checkbox"
                                            aria-label="Seleccionar todos"
                                            className="h-4 w-4 accent-[#007EC6]"
                                            checked={todosMarcados}
                                            disabled={asignables.length === 0}
                                            onChange={e => setSeleccionados(
                                                e.target.checked ? asignables.map(t => t.id) : [],
                                            )}
                                        />
                                    </th>
                                )}
                                <th className="text-left p-4 font-medium">Número</th>
                                <th className="text-left p-4 font-medium">Cliente</th>
                                <th className="text-left p-4 font-medium">Sorteo</th>
                                <th className="text-left p-4 font-medium">Origen</th>
                                <th className="text-left p-4 font-medium">Estado</th>
                                <th className="text-left p-4 font-medium">Emitido</th>
                                <th className="text-left p-4 font-medium">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filtrados.length === 0 ? (
                                <tr>
                                    <td colSpan={modoAsignacion ? 8 : 7} className="text-center p-12 text-slate-500">
                                        No se encontraron boletos
                                    </td>
                                </tr>
                            ) : filtrados.map(t => {
                                const cliente = t.snapshot?.cliente
                                const nombreCliente = cliente
                                    ? `${cliente.nombre} ${cliente.apellido}`
                                    : (t.cliente ? `${t.cliente.nombre} ${t.cliente.apellido}` : '—')
                                const tieneTelefono = Boolean(cliente?.telefono ?? t.cliente?.telefono)

                                return (
                                    <tr key={t.id} className="text-slate-300 hover:bg-white/3 transition-colors">
                                        {modoAsignacion && (
                                            <td className="p-4">
                                                <input
                                                    type="checkbox"
                                                    aria-label={`Seleccionar ${t.numero_formateado}`}
                                                    className="h-4 w-4 accent-[#007EC6] disabled:opacity-30"
                                                    checked={seleccionVisible.includes(t.id)}
                                                    disabled={t.estado !== 'valido'}
                                                    onChange={() => alternarSeleccion(t.id)}
                                                />
                                            </td>
                                        )}
                                        <td className="p-4 font-mono text-white">{t.numero_formateado}</td>
                                        <td className="p-4">{nombreCliente}</td>
                                        <td className="p-4 text-xs">
                                            {t.sorteo?.nombre ?? (
                                                <span className="text-slate-500">Sin sorteo</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-xs text-slate-400">
                                            {ORIGEN_TICKET_LABELS[t.origen]}
                                        </td>
                                        <td className="p-4">
                                            <span className={cn(
                                                'inline-flex px-2 py-0.5 rounded-full text-xs font-medium',
                                                ESTADO_TICKET_COLORS[t.estado],
                                            )}>
                                                {ESTADO_TICKET_LABELS[t.estado]}
                                            </span>
                                        </td>
                                        <td className="p-4 whitespace-nowrap text-xs text-slate-400">
                                            {formatearFechaHoraRD(t.emitido_at)}
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-1">
                                                <a
                                                    href={`/api/tickets/${t.token_publico}/pdf`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    title="Descargar PDF"
                                                    className="rounded p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"
                                                >
                                                    <Download className="h-3.5 w-3.5" />
                                                </a>
                                                {t.estado === 'valido' && (
                                                    <>
                                                        <button
                                                            title="Reenviar por WhatsApp"
                                                            disabled={pendiente || !tieneTelefono}
                                                            onClick={() => reenviar(t.id)}
                                                            className="rounded p-1.5 text-slate-400 hover:bg-white/5 hover:text-green-400 disabled:opacity-30"
                                                        >
                                                            <Send className="h-3.5 w-3.5" />
                                                        </button>
                                                        {puedeAnular && (
                                                            <button
                                                                title="Anular boleto"
                                                                disabled={pendiente}
                                                                onClick={() => anular(t.id)}
                                                                className="rounded p-1.5 text-slate-400 hover:bg-white/5 hover:text-red-400 disabled:opacity-30"
                                                            >
                                                                <Ban className="h-3.5 w-3.5" />
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="px-4 py-3 border-t border-white/5 text-xs text-slate-500">
                    {filtrados.length} de {tickets.length} boletos
                </div>
            </div>
        </div>
    )
}
