'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Deuda, Profile, EtapaCobranza, FrecuenciaPago, FRECUENCIA_LABELS } from '@/lib/types'
import { actualizarEstadoDeuda, togglePausaDeuda, registrarPago, marcarPagoPeriodo } from '@/lib/actions/deudas'
import { enviarRecordatorioManual } from '@/lib/actions/envios'
import { calcularDiasAtraso, getEtapaCobranza } from '@/lib/utils/cobranza-engine'
import { DeudaForm } from './deuda-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Plus, Search, MoreHorizontal, Pencil, Send, PauseCircle, PlayCircle, CheckCircle, DollarSign, Clock } from 'lucide-react'
import { formatMonto, formatFecha } from '@/lib/utils/template-renderer'
import { cn } from '@/lib/utils'
import Link from 'next/link'

const ETAPA_CSS: Record<EtapaCobranza, string> = {
    preventivo: 'bg-green-500/20 text-green-300',
    mora_temprana: 'bg-yellow-500/20 text-yellow-300',
    mora_alta: 'bg-orange-500/20 text-orange-300',
    recuperacion: 'bg-red-500/20 text-red-300',
    saldado: 'bg-slate-500/20 text-slate-400',
}
const ETAPA_LABELS: Record<EtapaCobranza, string> = {
    preventivo: 'Preventivo', mora_temprana: 'Mora Temprana', mora_alta: 'Mora Alta',
    recuperacion: 'Recuperación', saldado: 'Saldado',
}

const FREQ_CSS: Record<FrecuenciaPago, string> = {
    mensual: 'bg-blue-500/15 text-blue-300',
    quincenal: 'bg-purple-500/15 text-purple-300',
    semanal: 'bg-cyan-500/15 text-cyan-300',
}

interface ClienteSimple { id: string; nombre: string; apellido: string; telefono: string; dni_ruc?: string | null }

interface CuentasViewProps {
    deudas: (Deuda & { cliente?: ClienteSimple; agente?: { full_name: string } })[]
    clientes: ClienteSimple[]
    agentes: Profile[]
}

export function CuentasView({ deudas, clientes, agentes }: CuentasViewProps) {
    const [search, setSearch] = useState('')
    const [etapaFilter, setEtapaFilter] = useState('')
    const [estadoFilter, setEstadoFilter] = useState('')
    const [formOpen, setFormOpen] = useState(false)
    const [editDeuda, setEditDeuda] = useState<Deuda | undefined>()
    const [pagoDialog, setPagoDialog] = useState<{ id: string; saldo: number; cuota: number | null; monto_original: number; frecuencia: FrecuenciaPago } | null>(null)
    const [montoPago, setMontoPago] = useState('')
    const [isPending, startTransition] = useTransition()

    const filtered = deudas.filter(d => {
        const term = search.toLowerCase()
        const nombre = `${d.cliente?.nombre ?? ''} ${d.cliente?.apellido ?? ''}`.toLowerCase()
        if (!nombre.includes(term)) return false
        if (etapaFilter && d.etapa !== etapaFilter) return false
        if (estadoFilter && d.estado !== estadoFilter) return false
        return true
    })

    const handleEnviar = (id: string) => {
        startTransition(async () => {
            try {
                await enviarRecordatorioManual(id)
                toast.success('Recordatorio enviado correctamente')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error al enviar')
            }
        })
    }

    const handleTogglePausa = (id: string, pausado: boolean) => {
        startTransition(async () => {
            try {
                await togglePausaDeuda(id, !pausado)
                toast.success(pausado ? 'Recordatorios reanudados' : 'Recordatorios pausados')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    const handleMarcarSaldado = (id: string) => {
        startTransition(async () => {
            try {
                await actualizarEstadoDeuda(id, 'saldado')
                toast.success('Cuenta marcada como saldada')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    const handleRegistrarPago = () => {
        if (!pagoDialog) return
        const monto = parseFloat(montoPago)

        if (pagoDialog.monto_original === 0) {
            const fc = new Date()
            const periodo = fc.toISOString().split('T')[0]
            startTransition(async () => {
                try {
                    await marcarPagoPeriodo(pagoDialog.id, periodo, 'Pago registrado desde cuentas')
                    toast.success('Pago registrado correctamente')
                    setPagoDialog(null)
                    setMontoPago('')
                } catch (e: unknown) {
                    toast.error(e instanceof Error ? e.message : 'Error')
                }
            })
            return
        }

        if (isNaN(monto) || monto <= 0) { toast.error('Monto inválido'); return }
        startTransition(async () => {
            try {
                await registrarPago(pagoDialog.id, monto)
                toast.success('Pago registrado correctamente')
                setPagoDialog(null)
                setMontoPago('')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    return (
        <>
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input placeholder="Buscar por nombre del cliente..." value={search} onChange={e => setSearch(e.target.value)}
                        className="pl-9 bg-slate-800 border-white/10 text-white placeholder:text-slate-500" />
                </div>
                <Select onValueChange={v => setEtapaFilter(v === 'todas' ? '' : v)}>
                    <SelectTrigger className="w-44 bg-slate-800 border-white/10 text-white">
                        <SelectValue placeholder="Etapa" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/10 text-white">
                        <SelectItem value="todas">Todas las etapas</SelectItem>
                        <SelectItem value="preventivo">Preventivo</SelectItem>
                        <SelectItem value="mora_temprana">Mora Temprana</SelectItem>
                        <SelectItem value="mora_alta">Mora Alta</SelectItem>
                        <SelectItem value="recuperacion">Recuperación</SelectItem>
                    </SelectContent>
                </Select>
                <Select onValueChange={v => setEstadoFilter(v === 'todos' ? '' : v)}>
                    <SelectTrigger className="w-36 bg-slate-800 border-white/10 text-white">
                        <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/10 text-white">
                        <SelectItem value="todos">Todos</SelectItem>
                        <SelectItem value="activo">Activo</SelectItem>
                        <SelectItem value="saldado">Saldado</SelectItem>
                        <SelectItem value="cancelado">Cancelado</SelectItem>
                    </SelectContent>
                </Select>
                <Button onClick={() => { setEditDeuda(undefined); setFormOpen(true) }}
                    className="text-white gap-2" style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)", boxShadow: "0 4px 12px rgba(0,126,198,0.25)" }}>
                    <Plus className="w-4 h-4" />Nueva Cuenta
                </Button>
            </div>

            {/* Table */}
            <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-white/5 text-slate-500 text-xs">
                                <th className="text-left p-4 font-medium">Cliente</th>
                                <th className="text-left p-4 font-medium">Monto</th>
                                <th className="text-left p-4 font-medium">Saldo</th>
                                <th className="text-left p-4 font-medium">Cuota</th>
                                <th className="text-left p-4 font-medium">Frecuencia</th>
                                <th className="text-left p-4 font-medium">Vence</th>
                                <th className="text-left p-4 font-medium">Días atraso</th>
                                <th className="text-left p-4 font-medium">Etapa</th>
                                <th className="text-left p-4 font-medium">Estado</th>
                                <th className="text-center p-4 font-medium">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filtered.length === 0 ? (
                                <tr><td colSpan={10} className="text-center p-12 text-slate-500">No se encontraron cuentas</td></tr>
                            ) : filtered.map(d => {
                                const freq = (d.frecuencia_pago ?? 'mensual') as FrecuenciaPago
                                const diasAtrasoReal = d.estado === 'saldado' ? 0 : calcularDiasAtraso(d.fecha_corte)
                                const etapaReal = d.estado === 'saldado' ? 'saldado' as EtapaCobranza : getEtapaCobranza(diasAtrasoReal)
                                return (
                                    <tr key={d.id} className={cn('text-slate-300 hover:bg-white/3 transition-colors', d.pausado && 'opacity-60')}>
                                        <td className="p-4">
                                            <Link href={`/clientes/${d.cliente_id}`} className="font-semibold text-white transition-colors" style={{ textDecorationLine: 'none' }} onMouseEnter={e => (e.currentTarget.style.color = '#5bbfed')} onMouseLeave={e => (e.currentTarget.style.color = 'white')}>
                                                {d.cliente ? `${d.cliente.nombre} ${d.cliente.apellido}` : '—'}
                                            </Link>
                                            <div className="text-xs text-slate-500">{d.cliente?.telefono}</div>
                                            {d.es_deuda_existente && (
                                                <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1 py-0.5 rounded">Pre-existente</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-white font-semibold">
                                            {d.monto_original > 0 ? formatMonto(d.monto_original) : <span className="text-slate-600 text-xs">Sin monto</span>}
                                        </td>
                                        <td className="p-4 text-white">
                                            {d.saldo_pendiente > 0 ? formatMonto(d.saldo_pendiente) : <span className="text-slate-600 text-xs">—</span>}
                                        </td>
                                        <td className="p-4">
                                            {d.cuota_mensual
                                                ? <span className="text-[#5bbfed] font-semibold">{formatMonto(d.cuota_mensual)}</span>
                                                : <span className="text-slate-600 text-xs">—</span>}
                                        </td>
                                        <td className="p-4">
                                            <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold', FREQ_CSS[freq])}>
                                                <Clock className="w-2.5 h-2.5" />
                                                {FRECUENCIA_LABELS[freq]}
                                            </span>
                                        </td>
                                        <td className="p-4">{formatFecha(d.fecha_corte)}</td>
                                        <td className="p-4">
                                            <span className={cn('font-bold text-base', diasAtrasoReal > 0 ? 'text-red-400' : 'text-green-400')}>
                                                {diasAtrasoReal}d
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', ETAPA_CSS[etapaReal])}>
                                                {ETAPA_LABELS[etapaReal]}
                                            </span>
                                            {d.pausado && <span className="ml-1 text-[10px] text-slate-500">(pausado)</span>}
                                        </td>
                                        <td className="p-4">
                                            <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs',
                                                d.estado === 'activo' ? 'text-[#5bbfed]' :
                                                    d.estado === 'saldado' ? 'bg-green-500/20 text-green-300' :
                                                        'bg-slate-500/20 text-slate-400'
                                            )}>{d.estado}</span>
                                        </td>
                                        <td className="p-4 text-center">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-white/10">
                                                        <MoreHorizontal className="w-4 h-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" style={{ background: '#0c1d38', border: '1px solid rgba(0,126,198,0.15)' }} className="text-slate-200">
                                                    <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => { setEditDeuda(d); setFormOpen(true) }}>
                                                        <Pencil className="w-4 h-4" />Editar
                                                    </DropdownMenuItem>
                                                    {d.estado === 'activo' && (
                                                        <>
                                                            <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => handleEnviar(d.id)} disabled={isPending}>
                                                                <Send className="w-4 h-4" />Enviar recordatorio
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem className="gap-2 cursor-pointer"
                                                                onClick={() => {
                                                                    setPagoDialog({
                                                                        id: d.id,
                                                                        saldo: d.saldo_pendiente,
                                                                        cuota: d.cuota_mensual,
                                                                        monto_original: d.monto_original,
                                                                        frecuencia: (d.frecuencia_pago ?? 'mensual') as FrecuenciaPago,
                                                                    })
                                                                    setMontoPago(d.cuota_mensual ? String(d.cuota_mensual) : '')
                                                                }}>
                                                                <DollarSign className="w-4 h-4" />Registrar pago
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => handleTogglePausa(d.id, d.pausado)}>
                                                                {d.pausado ? <><PlayCircle className="w-4 h-4" />Reanudar recordatorios</> : <><PauseCircle className="w-4 h-4" />Pausar recordatorios</>}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator className="bg-white/10" />
                                                            <DropdownMenuItem className="gap-2 cursor-pointer text-green-400 focus:text-green-400"
                                                                onClick={() => handleMarcarSaldado(d.id)}>
                                                                <CheckCircle className="w-4 h-4" />Marcar como saldado
                                                            </DropdownMenuItem>
                                                        </>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="px-4 py-3 border-t border-white/5 text-xs text-slate-500">
                    {filtered.length} de {deudas.length} cuentas
                </div>
            </div>

            <DeudaForm open={formOpen} onClose={() => { setFormOpen(false); setEditDeuda(undefined) }}
                deuda={editDeuda} clientes={clientes} agentes={agentes} />

            {/* Dialog de pago */}
            <Dialog open={!!pagoDialog} onOpenChange={v => { if (!v) { setPagoDialog(null); setMontoPago('') } }}>
                <DialogContent className="bg-slate-900 border-white/10 text-white max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Registrar Pago</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        {pagoDialog && (
                            <>
                                <div className="flex items-center gap-2 text-xs">
                                    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold', FREQ_CSS[pagoDialog.frecuencia])}>
                                        <Clock className="w-2.5 h-2.5" />
                                        Pago {FRECUENCIA_LABELS[pagoDialog.frecuencia]}
                                    </span>
                                </div>

                                {pagoDialog.monto_original === 0 ? (
                                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                                        <p className="text-sm text-emerald-300 font-medium">Marcar como pagado</p>
                                        <p className="text-xs text-slate-400 mt-1">
                                            Esta cuenta no tiene montos configurados. Al marcar como pagado, se avanzará la fecha de corte al siguiente período.
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="space-y-1 text-sm">
                                            <p className="text-slate-400">Saldo pendiente: <span className="text-white font-semibold">{formatMonto(pagoDialog.saldo)}</span></p>
                                            {pagoDialog.cuota && (
                                                <p className="text-slate-400">Cuota {FRECUENCIA_LABELS[pagoDialog.frecuencia].toLowerCase()}: <span className="font-semibold" style={{ color: '#5bbfed' }}>{formatMonto(pagoDialog.cuota)}</span></p>
                                            )}
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-slate-300">Monto del pago</Label>
                                            <Input type="number" step="0.01" value={montoPago} onChange={e => setMontoPago(e.target.value)}
                                                placeholder={pagoDialog.cuota ? String(pagoDialog.cuota) : '0.00'}
                                                className="bg-slate-800 border-white/10 text-white" />
                                            {pagoDialog.cuota && (
                                                <p className="text-xs text-slate-500">
                                                    Al pagar la cuota, la fecha de corte avanzará al siguiente período ({FRECUENCIA_LABELS[pagoDialog.frecuencia].toLowerCase()}).
                                                </p>
                                            )}
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" className="border-white/10 text-slate-300" onClick={() => { setPagoDialog(null); setMontoPago('') }}>Cancelar</Button>
                        <Button disabled={isPending} className="bg-green-600 hover:bg-green-500 text-white" onClick={handleRegistrarPago}>
                            {pagoDialog?.monto_original === 0 ? 'Marcar Pagado' : 'Registrar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
