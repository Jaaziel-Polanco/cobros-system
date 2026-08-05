'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, Copy, History, Loader2, ShieldCheck, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
    verificarEjecucion, marcarPremioEntregado,
    type ResultadoVerificacion, type EjecucionConEjecutor, type GanadorDetalle,
} from '@/lib/actions/sorteos'
import { formatearFechaCalendario, formatearFechaHoraRD } from '@/lib/utils/fecha-rd'

interface GanadoresPanelProps {
    ejecucion: EjecucionConEjecutor
    ganadores: GanadorDetalle[]
    /** Ejecuciones anteriores (vigente = false), más recientes primero. */
    historial: EjecucionConEjecutor[]
    puedeGestionar: boolean
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
    return (
        <div>
            <dt className="text-xs text-slate-500">{etiqueta}</dt>
            <dd className="mt-0.5 text-sm text-slate-200">{children}</dd>
        </div>
    )
}

export function GanadoresPanel({
    ejecucion, ganadores, historial, puedeGestionar,
}: GanadoresPanelProps) {
    const [verificacion, setVerificacion] = useState<ResultadoVerificacion | null>(null)
    const [verificando, setVerificando] = useState(false)
    const [historialAbierto, setHistorialAbierto] = useState(false)
    const [pendiente, startTransition] = useTransition()

    const copiarSemilla = async () => {
        try {
            await navigator.clipboard.writeText(ejecucion.semilla)
            toast.success('Semilla copiada')
        } catch {
            toast.error('No se pudo copiar la semilla')
        }
    }

    const verificar = () => {
        setVerificando(true)
        verificarEjecucion(ejecucion.id)
            .then(setVerificacion)
            .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Error'))
            .finally(() => setVerificando(false))
    }

    const alternarEntrega = (ganadorId: string, entregado: boolean) => {
        startTransition(async () => {
            try {
                await marcarPremioEntregado(ganadorId, entregado)
                toast.success(entregado ? 'Premio marcado como entregado' : 'Entrega revertida')
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    return (
        <div className="space-y-4">
            {/* Datos de la ejecución */}
            <div className="rounded-2xl border border-white/5 bg-slate-800/50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 font-semibold text-white">
                        <Trophy className="h-4 w-4 text-amber-400" />Ganadores
                    </h2>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={verificar}
                        disabled={verificando}
                        className="gap-2 border-white/10 text-slate-300 hover:bg-white/5"
                    >
                        {verificando
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <ShieldCheck className="h-3.5 w-3.5" />}
                        Verificar ejecución
                    </Button>
                </div>

                <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Dato etiqueta="Ejecutado">{formatearFechaHoraRD(ejecucion.ejecutado_at)}</Dato>
                    <Dato etiqueta="Por">{ejecucion.ejecutor?.full_name ?? '—'}</Dato>
                    <Dato etiqueta="Rango">
                        {formatearFechaCalendario(ejecucion.rango_desde)} – {formatearFechaCalendario(ejecucion.rango_hasta)}
                    </Dato>
                    <Dato etiqueta="Participantes">{ejecucion.pool_count} boletos</Dato>
                </dl>

                <div className="mt-4 border-t border-white/5 pt-3">
                    <p className="text-xs text-slate-500">Semilla</p>
                    <div className="mt-1 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-slate-900/70 px-2 py-1 font-mono text-xs text-slate-300">
                            {ejecucion.semilla}
                        </code>
                        <button
                            type="button"
                            onClick={copiarSemilla}
                            title="Copiar semilla"
                            className="rounded p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"
                        >
                            <Copy className="h-3.5 w-3.5" />
                        </button>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500">
                        Con esta semilla y el algoritmo{' '}
                        <span className="font-mono">{ejecucion.algoritmo}</span> se pueden recalcular
                        exactamente los mismos ganadores en cualquier momento.
                    </p>
                </div>
            </div>

            {verificacion && (
                <div className={cn(
                    'rounded-xl border p-4 text-sm',
                    verificacion.coincide && verificacion.poolIntacto
                        ? 'border-green-500/30 bg-green-500/10 text-green-300'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                )}>
                    <p className="font-medium">{verificacion.mensaje}</p>
                    <dl className="mt-3 space-y-1 text-xs opacity-90">
                        <div className="flex justify-between gap-4">
                            <dt>Algoritmo</dt>
                            <dd className="font-mono">{verificacion.algoritmo}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                            <dt>Semilla</dt>
                            <dd className="font-mono break-all text-right">{verificacion.semilla}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                            <dt>Participantes</dt>
                            <dd>{verificacion.poolCount} boletos</dd>
                        </div>
                    </dl>
                </div>
            )}

            {/* Lista de ganadores */}
            <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-800/50">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-white/5 text-xs text-slate-500">
                                <th className="p-4 text-left font-medium">#</th>
                                <th className="p-4 text-left font-medium">Boleto</th>
                                <th className="p-4 text-left font-medium">Cliente</th>
                                <th className="p-4 text-left font-medium">Teléfono</th>
                                <th className="p-4 text-left font-medium">Premio</th>
                                <th className="p-4 text-left font-medium">Entregado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {ganadores.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-12 text-center text-slate-500">
                                        Esta ejecución no guardó ningún ganador.
                                    </td>
                                </tr>
                            ) : ganadores.map(g => (
                                <tr key={g.id} className="text-slate-300">
                                    <td className="p-4 font-semibold text-white">{g.posicion}</td>
                                    <td className="p-4">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono text-white">
                                                {g.ticket?.numero_formateado ?? '—'}
                                            </span>
                                            {/* Anular un boleto ganador está permitido a
                                                propósito; lo que no se permite es que pase
                                                inadvertido. */}
                                            {g.ticket?.estado === 'anulado' && (
                                                <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                                                    Boleto anulado después del sorteo
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        {g.cliente ? `${g.cliente.nombre} ${g.cliente.apellido}` : '—'}
                                    </td>
                                    <td className="p-4 font-mono text-xs">{g.cliente?.telefono ?? '—'}</td>
                                    <td className="p-4 text-xs text-slate-400">{g.premio ?? '—'}</td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                checked={g.entregado}
                                                disabled={!puedeGestionar || pendiente}
                                                onCheckedChange={v => alternarEntrega(g.id, v)}
                                            />
                                            {g.entregado && g.entregado_at && (
                                                <span className="flex items-center gap-1 text-[10px] text-green-400">
                                                    <Check className="h-3 w-3" />
                                                    {formatearFechaHoraRD(g.entregado_at)}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Historial: nada se borra al re-ejecutar */}
            {historial.length > 0 && (
                <div className="rounded-2xl border border-white/5 bg-slate-800/50">
                    <button
                        type="button"
                        onClick={() => setHistorialAbierto(v => !v)}
                        className="flex w-full items-center justify-between px-5 py-3.5 text-sm text-slate-300 hover:text-white"
                    >
                        <span className="flex items-center gap-2">
                            <History className="h-4 w-4" />
                            Ejecuciones anteriores ({historial.length})
                        </span>
                        <ChevronDown className={cn('h-4 w-4 transition-transform', historialAbierto && 'rotate-180')} />
                    </button>
                    {historialAbierto && (
                        <div className="border-t border-white/5 px-5 py-4">
                            <p className="mb-3 text-xs text-slate-500">
                                Estas listas dejaron de ser la vigente al volver a ejecutar el sorteo,
                                pero no se borraron: sus participantes y ganadores siguen guardados.
                            </p>
                            <ul className="space-y-3">
                                {historial.map(e => (
                                    <li key={e.id} className="rounded-lg bg-slate-900/50 p-3 text-xs">
                                        <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
                                            <span>{formatearFechaHoraRD(e.ejecutado_at)}</span>
                                            <span className="text-slate-500">
                                                {e.ejecutor?.full_name ?? '—'} · {e.pool_count} boletos ·{' '}
                                                {e.cantidad_ganadores} ganadores
                                            </span>
                                        </div>
                                        <code className="mt-1.5 block truncate font-mono text-[11px] text-slate-500">
                                            {e.semilla}
                                        </code>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
