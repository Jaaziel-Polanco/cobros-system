'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Gift, Plus, Ticket, CalendarRange, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SorteoFormDialog } from './sorteo-form-dialog'
import { formatearFechaCalendario } from '@/lib/utils/fecha-rd'
import { ESTADO_SORTEO_LABELS } from '@/lib/types'
import type { Sorteo, EstadoSorteo } from '@/lib/types'

const ESTADO_COLORS: Record<EstadoSorteo, string> = {
    borrador: 'bg-slate-500/20 text-slate-300',
    activo: 'bg-green-500/20 text-green-300',
    cerrado: 'bg-red-500/20 text-red-300',
}

interface SorteosViewProps {
    sorteos: Sorteo[]
    puedeGestionar: boolean
}

export function SorteosView({ sorteos, puedeGestionar }: SorteosViewProps) {
    const [formAbierto, setFormAbierto] = useState(false)

    const activo = sorteos.find(s => s.estado === 'activo') ?? null

    return (
        <div className="space-y-5">
            {/* Cuál recibe los boletos nuevos. Confundirse con esto es el error
                más caro del módulo: los boletos emitidos hoy van al sorteo
                activo, no al que uno esté mirando. */}
            <div className={cn(
                'flex items-start gap-3 rounded-xl border p-4',
                activo
                    ? 'border-green-500/25 bg-green-500/5'
                    : 'border-amber-500/25 bg-amber-500/5',
            )}>
                <Ticket className={cn('mt-0.5 h-5 w-5 shrink-0', activo ? 'text-green-400' : 'text-amber-400')} />
                <div>
                    <p className="text-sm font-medium text-white">
                        {activo
                            ? <>Los boletos nuevos van al sorteo <strong>{activo.nombre}</strong></>
                            : 'Ningún sorteo está activo'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                        {activo
                            ? `Se numeran como ${activo.prefijo}-000001. Solo un sorteo puede estar activo a la vez.`
                            : 'Los boletos que se emitan ahora quedarán sin sorteo (huérfanos) y habrá que asignarlos a mano desde /tickets.'}
                    </p>
                </div>
            </div>

            {puedeGestionar && (
                <div className="flex justify-end">
                    <Button
                        onClick={() => setFormAbierto(true)}
                        className="gap-2 text-white"
                        style={{
                            background: 'linear-gradient(135deg, #007EC6, #0096E8)',
                            boxShadow: '0 4px 12px rgba(0,126,198,0.25)',
                        }}
                    >
                        <Plus className="h-4 w-4" />Nuevo sorteo
                    </Button>
                </div>
            )}

            {sorteos.length === 0 ? (
                <div className="rounded-2xl border border-white/5 bg-slate-800/50 p-12 text-center">
                    <Gift className="mx-auto h-8 w-8 text-slate-600" />
                    <p className="mt-3 text-sm text-slate-400">Todavía no hay ningún sorteo.</p>
                    {puedeGestionar && (
                        <p className="mt-1 text-xs text-slate-500">
                            Crea uno y actívalo para que los boletos empiecen a numerarse con su prefijo.
                        </p>
                    )}
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {sorteos.map(s => (
                        <Link
                            key={s.id}
                            href={`/sorteos/${s.id}`}
                            className={cn(
                                'group flex flex-col gap-3 rounded-2xl border bg-slate-800/50 p-5 transition-colors hover:bg-slate-800',
                                s.estado === 'activo'
                                    ? 'border-green-500/40 ring-1 ring-green-500/20'
                                    : 'border-white/5',
                            )}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className={cn(
                                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                                        s.estado === 'activo' ? 'bg-green-500/10' : 'bg-[#007EC6]/10',
                                    )}>
                                        <Gift className={cn(
                                            'h-4 w-4',
                                            s.estado === 'activo' ? 'text-green-400' : 'text-[#007EC6]',
                                        )} />
                                    </div>
                                    <p className="truncate font-semibold text-white">{s.nombre}</p>
                                </div>
                                <span className={cn(
                                    'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                                    ESTADO_COLORS[s.estado],
                                )}>
                                    {ESTADO_SORTEO_LABELS[s.estado]}
                                </span>
                            </div>

                            {s.premio && (
                                <p className="flex items-center gap-2 text-sm text-slate-300">
                                    <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                                    <span className="truncate">{s.premio}</span>
                                </p>
                            )}

                            <p className="flex items-center gap-2 text-xs text-slate-400">
                                <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                                {formatearFechaCalendario(s.fecha_inicio)} – {formatearFechaCalendario(s.fecha_fin)}
                            </p>

                            <p className="mt-auto border-t border-white/5 pt-3 text-xs text-slate-500">
                                <span className="font-mono text-slate-400">{s.prefijo}</span>
                                {' · '}
                                {s.ultimo_numero} {s.ultimo_numero === 1 ? 'boleto emitido' : 'boletos emitidos'}
                            </p>
                        </Link>
                    ))}
                </div>
            )}

            <SorteoFormDialog abierto={formAbierto} onCerrar={() => setFormAbierto(false)} />
        </div>
    )
}
