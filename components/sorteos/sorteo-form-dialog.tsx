'use client'

import { useEffect, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { SorteoSchema, type SorteoFormData } from '@/lib/validations/sorteos'
import { crearSorteo, actualizarSorteo } from '@/lib/actions/sorteos'
import { hoyRD } from '@/lib/utils/fecha-rd'
import type { Sorteo } from '@/lib/types'

interface SorteoFormDialogProps {
    abierto: boolean
    onCerrar: () => void
    /** Si viene, el diálogo edita en vez de crear. */
    sorteo?: Sorteo
    /** true en cuanto el sorteo ya emitió algún boleto: el prefijo se congela. */
    prefijoBloqueado?: boolean
}

function valoresIniciales(sorteo?: Sorteo): SorteoFormData {
    if (sorteo) {
        return {
            nombre: sorteo.nombre,
            descripcion: sorteo.descripcion ?? '',
            premio: sorteo.premio ?? '',
            fecha_inicio: sorteo.fecha_inicio,
            fecha_fin: sorteo.fecha_fin,
            prefijo: sorteo.prefijo,
            cantidad_ganadores_default: sorteo.cantidad_ganadores_default,
        }
    }
    const hoy = hoyRD()
    return {
        nombre: '',
        descripcion: '',
        premio: '',
        fecha_inicio: hoy,
        fecha_fin: hoy,
        prefijo: '',
        cantidad_ganadores_default: 1,
    }
}

export function SorteoFormDialog({
    abierto, onCerrar, sorteo, prefijoBloqueado = false,
}: SorteoFormDialogProps) {
    const [pendiente, startTransition] = useTransition()
    const {
        register, handleSubmit, reset, formState: { errors },
    } = useForm<SorteoFormData>({
        resolver: zodResolver(SorteoSchema),
        defaultValues: valoresIniciales(sorteo),
    })

    useEffect(() => {
        if (abierto) reset(valoresIniciales(sorteo))
    }, [abierto, sorteo, reset])

    const onSubmit = (data: SorteoFormData) => {
        startTransition(async () => {
            try {
                if (sorteo) {
                    // El prefijo no viaja cuando está congelado: renumeraría
                    // boletos que pueden estar ya impresos o enviados.
                    await actualizarSorteo(sorteo.id, {
                        ...data,
                        prefijo: prefijoBloqueado ? sorteo.prefijo : data.prefijo,
                    })
                    toast.success('Sorteo actualizado')
                } else {
                    await crearSorteo(data)
                    toast.success('Sorteo creado')
                }
                reset()
                onCerrar()
            } catch (e: unknown) {
                toast.error(e instanceof Error ? e.message : 'Error')
            }
        })
    }

    return (
        <Dialog open={abierto} onOpenChange={v => { if (!v) { reset(); onCerrar() } }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{sorteo ? 'Editar sorteo' : 'Nuevo sorteo'}</DialogTitle>
                    <DialogDescription className="text-slate-400">
                        Los boletos emitidos mientras este sorteo esté activo se numerarán
                        con su prefijo y participarán en su selección de ganadores.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Nombre *</Label>
                        <Input
                            className="bg-slate-800 border-white/10 text-white"
                            placeholder="Ej: Sorteo de Navidad 2026"
                            {...register('nombre')}
                        />
                        {errors.nombre && <p className="text-xs text-red-400">{errors.nombre.message}</p>}
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Descripción</Label>
                        <Textarea
                            rows={2}
                            className="bg-slate-800 border-white/10 text-white resize-none"
                            placeholder="Opcional..."
                            {...register('descripcion')}
                        />
                        {errors.descripcion && <p className="text-xs text-red-400">{errors.descripcion.message}</p>}
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Premio</Label>
                        <Input
                            className="bg-slate-800 border-white/10 text-white"
                            placeholder="Ej: Un televisor de 55 pulgadas"
                            {...register('premio')}
                        />
                        {errors.premio && <p className="text-xs text-red-400">{errors.premio.message}</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Fecha de inicio *</Label>
                            <Input
                                type="date"
                                className="bg-slate-800 border-white/10 text-white"
                                {...register('fecha_inicio')}
                            />
                            {errors.fecha_inicio && <p className="text-xs text-red-400">{errors.fecha_inicio.message}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Fecha final *</Label>
                            <Input
                                type="date"
                                className="bg-slate-800 border-white/10 text-white"
                                {...register('fecha_fin')}
                            />
                            {errors.fecha_fin && <p className="text-xs text-red-400">{errors.fecha_fin.message}</p>}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Prefijo *</Label>
                        <Input
                            className="bg-slate-800 border-white/10 text-white font-mono uppercase disabled:opacity-50"
                            placeholder="NAV26"
                            disabled={prefijoBloqueado}
                            {...register('prefijo')}
                        />
                        <p className="text-xs text-slate-500">
                            Los boletos de este sorteo se numerarán como{' '}
                            <span className="font-mono text-slate-400">PREFIJO-000001</span>.
                            Debe ser único y no se puede cambiar una vez emitido el primer boleto.
                        </p>
                        {prefijoBloqueado && (
                            <p className="text-xs text-amber-300">
                                Este sorteo ya emitió boletos, así que el prefijo quedó congelado.
                            </p>
                        )}
                        {errors.prefijo && <p className="text-xs text-red-400">{errors.prefijo.message}</p>}
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Ganadores por defecto *</Label>
                        <Input
                            type="number"
                            min={1}
                            max={100}
                            className="bg-slate-800 border-white/10 text-white"
                            {...register('cantidad_ganadores_default', { valueAsNumber: true })}
                        />
                        <p className="text-xs text-slate-500">
                            Es solo el valor que aparecerá propuesto al ejecutar el sorteo;
                            se puede cambiar en ese momento.
                        </p>
                        {errors.cantidad_ganadores_default && (
                            <p className="text-xs text-red-400">{errors.cantidad_ganadores_default.message}</p>
                        )}
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            className="border-white/10 text-slate-300"
                            onClick={() => { reset(); onCerrar() }}
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            disabled={pendiente}
                            className="text-white"
                            style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)' }}
                        >
                            {pendiente
                                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</>
                                : 'Guardar'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
