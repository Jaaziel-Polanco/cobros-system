'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, Download, Send, Ban } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { enviarTicketWhatsApp, anularTicket, type FiltrosTickets } from '@/lib/actions/tickets'
import { formatearFechaHoraRD } from '@/lib/utils/fecha-rd'
import { ESTADO_TICKET_COLORS, ESTADO_TICKET_LABELS, ORIGEN_TICKET_LABELS } from '@/lib/types'
import type { TicketConRelaciones } from '@/lib/types'

interface TicketsViewProps {
    tickets: TicketConRelaciones[]
    sorteos: { id: string; nombre: string }[]
    puedeAnular: boolean
    puedeAsignarSorteo: boolean
    /** Filtros ya aplicados en el servidor (leídos de la URL). Sirven para
     *  que los controles arranquen mostrando el mismo estado que produjo la
     *  lista recibida en `tickets`. */
    filtrosIniciales: FiltrosTickets
}

export function TicketsView({ tickets, sorteos, puedeAnular, puedeAsignarSorteo, filtrosIniciales }: TicketsViewProps) {
    // `puedeAsignarSorteo` no se usa todavía: el Plan 3 lo consume para la
    // asignación masiva de boletos huérfanos a un sorteo.
    void puedeAsignarSorteo
    const router = useRouter()
    const [busqueda, setBusqueda] = useState('')
    const [estadoFiltro, setEstadoFiltro] = useState(filtrosIniciales.estado ?? '')
    const [origenFiltro, setOrigenFiltro] = useState(filtrosIniciales.origen ?? '')
    const [sorteoFiltro, setSorteoFiltro] = useState(filtrosIniciales.sorteoId ?? '')
    const [soloHuerfanos, setSoloHuerfanos] = useState(filtrosIniciales.soloHuerfanos ?? false)
    const [desde, setDesde] = useState(filtrosIniciales.desde ?? '')
    const [hasta, setHasta] = useState(filtrosIniciales.hasta ?? '')
    const [pendiente, startTransition] = useTransition()

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

            {/* Tabla */}
            <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-white/5 text-slate-500 text-xs">
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
                                    <td colSpan={7} className="text-center p-12 text-slate-500">
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
