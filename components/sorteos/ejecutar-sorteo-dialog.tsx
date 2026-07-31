'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Dices, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ejecutarSorteo, previsualizarPool } from '@/lib/actions/sorteos'
import type { Sorteo } from '@/lib/types'

interface EjecutarSorteoDialogProps {
    abierto: boolean
    onCerrar: () => void
    sorteo: Sorteo
    hayEjecucionPrevia: boolean
}

export function EjecutarSorteoDialog({
    abierto, onCerrar, sorteo, hayEjecucionPrevia,
}: EjecutarSorteoDialogProps) {
    const [desde, setDesde] = useState(sorteo.fecha_inicio)
    const [hasta, setHasta] = useState(sorteo.fecha_fin)
    const [cantidad, setCantidad] = useState(sorteo.cantidad_ganadores_default)
    const [semilla, setSemilla] = useState('')
    const [avanzadas, setAvanzadas] = useState(false)
    const [pool, setPool] = useState<{ boletos: number; clientes: number } | null>(null)
    const [poolError, setPoolError] = useState<string | null>(null)
    const [cargandoPool, setCargandoPool] = useState(false)
    const [pendiente, startTransition] = useTransition()

    useEffect(() => {
        if (!abierto) return
        setDesde(sorteo.fecha_inicio)
        setHasta(sorteo.fecha_fin)
        setCantidad(sorteo.cantidad_ganadores_default)
        setSemilla('')
        setAvanzadas(false)
    }, [abierto, sorteo])

    // Vista previa del pool: se recalcula con cada cambio de fechas.
    useEffect(() => {
        if (!abierto || !desde || !hasta || hasta < desde) {
            setPool(null)
            return
        }
        let cancelado = false
        setCargandoPool(true)
        setPoolError(null)
        previsualizarPool(sorteo.id, desde, hasta)
            .then(p => { if (!cancelado) setPool(p) })
            .catch((e: unknown) => {
                if (cancelado) return
                setPool(null)
                setPoolError(e instanceof Error ? e.message : 'No se pudo leer el pool')
            })
            .finally(() => { if (!cancelado) setCargandoPool(false) })
        return () => { cancelado = true }
    }, [abierto, sorteo.id, desde, hasta])

    const rangoInvalido = Boolean(desde && hasta && hasta < desde)
    const sinBoletos = pool !== null && pool.boletos === 0

    const confirmar = () => {
        startTransition(async () => {
            try {
                const r = await ejecutarSorteo({
                    sorteo_id: sorteo.id,
                    rango_desde: desde,
                    rango_hasta: hasta,
                    cantidad_ganadores: cantidad,
                    semilla: semilla.trim() || undefined,
                })

                toast.success(
                    `Sorteo ejecutado sobre ${r.poolCount} ${r.poolCount === 1 ? 'boleto' : 'boletos'}`,
                )
                if (r.ganadoresInsuficientes) {
                    toast.warning(
                        'Salieron menos ganadores de los pedidos: no había tantos clientes distintos.',
                    )
                }
                // La transición borrador -> activo no es muda: si el sorteo
                // sigue en borrador porque ya hay otro activo, hay que decirlo,
                // o el usuario leerá "borrador" como "no se ha ejecutado".
                if (r.transicionadoAActivo) {
                    toast.info('El sorteo pasó de borrador a activo.')
                } else if (r.motivoNoTransicion) {
                    toast.warning(
                        `Los ganadores se guardaron, pero el sorteo sigue en ${r.estadoSorteo}: ${r.motivoNoTransicion}`,
                        { duration: 10000 },
                    )
                }
                onCerrar()
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    return (
        <Dialog open={abierto} onOpenChange={v => { if (!v) onCerrar() }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Ejecutar sorteo</DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Participan los boletos válidos de <strong>{sorteo.nombre}</strong> emitidos
                        dentro del rango de fechas.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 mt-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Desde</Label>
                            <Input
                                type="date"
                                value={desde}
                                onChange={e => setDesde(e.target.value)}
                                className="bg-slate-800 border-white/10 text-white"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Hasta</Label>
                            <Input
                                type="date"
                                value={hasta}
                                onChange={e => setHasta(e.target.value)}
                                className="bg-slate-800 border-white/10 text-white"
                            />
                        </div>
                    </div>
                    {rangoInvalido && (
                        <p className="text-xs text-red-400">
                            La fecha final no puede ser anterior a la inicial.
                        </p>
                    )}

                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Cantidad de ganadores</Label>
                        <Input
                            type="number"
                            min={1}
                            max={100}
                            value={Number.isNaN(cantidad) ? '' : cantidad}
                            onChange={e => setCantidad(parseInt(e.target.value, 10))}
                            className="bg-slate-800 border-white/10 text-white"
                        />
                    </div>

                    {/* Vista previa del pool */}
                    <div className="rounded-xl border border-white/5 bg-slate-800/50 p-4 space-y-2">
                        {cargandoPool ? (
                            <p className="flex items-center gap-2 text-sm text-slate-400">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />Calculando el pool...
                            </p>
                        ) : poolError ? (
                            <p className="text-sm text-red-400">{poolError}</p>
                        ) : pool ? (
                            <>
                                <p className="text-sm text-slate-300">
                                    Participan <strong>{pool.boletos}</strong> boletos de{' '}
                                    <strong>{pool.clientes}</strong> clientes distintos.
                                </p>
                                {sinBoletos && (
                                    <p className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-300">
                                        No hay boletos válidos en ese rango de fechas, así que no se
                                        puede ejecutar el sorteo.
                                    </p>
                                )}
                                {cantidad > pool.clientes && pool.clientes > 0 && (
                                    <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-300">
                                        Pides {cantidad} ganadores pero solo hay {pool.clientes} clientes
                                        distintos. Como un cliente no puede ganar dos veces, saldrán{' '}
                                        {pool.clientes} ganadores.
                                    </p>
                                )}
                            </>
                        ) : (
                            <p className="text-sm text-slate-500">
                                Elige un rango de fechas válido para ver quién participa.
                            </p>
                        )}
                    </div>

                    {/* Opciones avanzadas */}
                    <div className="rounded-xl border border-white/5">
                        <button
                            type="button"
                            onClick={() => setAvanzadas(v => !v)}
                            className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-slate-300 hover:text-white"
                        >
                            Opciones avanzadas
                            <ChevronDown className={cn('h-4 w-4 transition-transform', avanzadas && 'rotate-180')} />
                        </button>
                        {avanzadas && (
                            <div className="space-y-1.5 border-t border-white/5 px-4 py-3">
                                <Label className="text-slate-300">Semilla</Label>
                                <Input
                                    value={semilla}
                                    onChange={e => setSemilla(e.target.value)}
                                    placeholder="Se genera sola si la dejas vacía"
                                    className="bg-slate-800 border-white/10 text-white font-mono text-xs"
                                />
                                <p className="text-xs text-slate-500">
                                    Déjalo vacío para que el sistema genere una semilla aleatoria.
                                    Rellénalo solo si quieres repetir un sorteo anterior exactamente igual.
                                </p>
                            </div>
                        )}
                    </div>

                    {hayEjecucionPrevia && (
                        <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-300">
                            Este sorteo ya tiene ganadores. Al ejecutarlo de nuevo se generará una
                            lista nueva y la anterior quedará archivada, pero no se borrará.
                        </p>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        className="border-white/10 text-slate-300"
                        onClick={onCerrar}
                    >
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        onClick={confirmar}
                        disabled={
                            pendiente || cargandoPool || rangoInvalido || sinBoletos
                            || !Number.isFinite(cantidad) || cantidad < 1
                        }
                        className="gap-2 text-white"
                        style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)' }}
                    >
                        {pendiente
                            ? <><Loader2 className="h-4 w-4 animate-spin" />Ejecutando...</>
                            : <><Dices className="h-4 w-4" />Ejecutar sorteo</>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
