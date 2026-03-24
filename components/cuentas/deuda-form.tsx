'use client'

import { useState, useTransition, useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { DeudaSchema, DeudaFormData } from '@/lib/validations/schemas'
import { createDeuda, updateDeuda } from '@/lib/actions/deudas'
import { Deuda, Profile, FrecuenciaPago } from '@/lib/types'
import {
    Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Loader2, Search, Calendar, DollarSign, Clock } from 'lucide-react'

interface ClienteSimple {
    id: string
    nombre: string
    apellido: string
    telefono: string
    dni_ruc?: string | null
    agente_id?: string | null
}

interface DeudaFormProps {
    open: boolean
    onClose: () => void
    deuda?: Deuda
    clientes: ClienteSimple[]
    agentes: Profile[]
    defaultClienteId?: string
}

const FRECUENCIA_OPTIONS: { value: FrecuenciaPago; label: string; desc: string }[] = [
    { value: 'mensual', label: 'Mensual', desc: 'Pago cada 30 días' },
    { value: 'quincenal', label: 'Quincenal', desc: 'Pago cada 15 días' },
    { value: 'semanal', label: 'Semanal', desc: 'Pago cada 7 días' },
]

export function DeudaForm({ open, onClose, deuda, clientes, agentes, defaultClienteId }: DeudaFormProps) {
    const [isPending, startTransition] = useTransition()
    const [clienteSearch, setClienteSearch] = useState('')
    const [clienteDropdownOpen, setClienteDropdownOpen] = useState(false)

    const hasMontos = deuda ? deuda.monto_original > 0 : false

    const {
        register, handleSubmit, setValue, watch, reset, formState: { errors },
    } = useForm<DeudaFormData>({
        // @ts-expect-error zodResolver type mismatch with rhf generics
        resolver: zodResolver(DeudaSchema),
        defaultValues: deuda ? {
            cliente_id: deuda.cliente_id,
            descripcion: deuda.descripcion ?? '',
            montos_activos: hasMontos,
            monto_original: deuda.monto_original || undefined,
            saldo_pendiente: deuda.saldo_pendiente || undefined,
            cuota_mensual: deuda.cuota_mensual ?? undefined,
            tasa_interes: deuda.tasa_interes || undefined,
            frecuencia_pago: deuda.frecuencia_pago ?? 'mensual',
            dia_corte_2: deuda.dia_corte_2 ?? undefined,
            fecha_corte: deuda.fecha_corte,
            es_deuda_existente: deuda.es_deuda_existente,
            fecha_deuda_origen: deuda.fecha_deuda_origen ?? '',
            agente_id: deuda.agente_id ?? '',
            dias_antes_vencimiento: deuda.configuracion?.dias_antes_vencimiento ?? 3,
            frecuencia_mora_h: deuda.configuracion?.frecuencia_mora_h ?? 48,
            frecuencia_recuperacion_h: deuda.configuracion?.frecuencia_recuperacion_h ?? 72,
        } : {
            cliente_id: defaultClienteId ?? '',
            es_deuda_existente: false,
            montos_activos: false,
            saldo_pendiente: 0,
            cuota_mensual: undefined,
            tasa_interes: 0,
            frecuencia_pago: 'mensual',
            dia_corte_2: 30,
            dias_antes_vencimiento: 3,
            frecuencia_mora_h: 48,
            frecuencia_recuperacion_h: 72,
        },
    })

    const esExistente = watch('es_deuda_existente')
    const montosActivos = watch('montos_activos')
    const montoOriginal = watch('monto_original')
    const frecuencia = watch('frecuencia_pago')
    const clienteId = watch('cliente_id')

    const selectedCliente = clientes.find(c => c.id === clienteId)

    const filteredClientes = useMemo(() => {
        if (!clienteSearch.trim()) return clientes
        const term = clienteSearch.toLowerCase()
        return clientes.filter(c => {
            const full = `${c.nombre} ${c.apellido} ${c.telefono} ${c.dni_ruc ?? ''}`.toLowerCase()
            return full.includes(term)
        })
    }, [clientes, clienteSearch])

    useEffect(() => {
        if (open) {
            setClienteSearch('')
            if (deuda) {
                const hm = deuda.monto_original > 0
                reset({
                    cliente_id: deuda.cliente_id,
                    descripcion: deuda.descripcion ?? '',
                    montos_activos: hm,
                    monto_original: deuda.monto_original || undefined,
                    saldo_pendiente: deuda.saldo_pendiente || undefined,
                    cuota_mensual: deuda.cuota_mensual ?? undefined,
                    tasa_interes: deuda.tasa_interes || undefined,
                    frecuencia_pago: deuda.frecuencia_pago ?? 'mensual',
                    dia_corte_2: deuda.dia_corte_2 ?? undefined,
                    fecha_corte: deuda.fecha_corte,
                    es_deuda_existente: deuda.es_deuda_existente,
                    fecha_deuda_origen: deuda.fecha_deuda_origen ?? '',
                    agente_id: deuda.agente_id ?? '',
                    dias_antes_vencimiento: deuda.configuracion?.dias_antes_vencimiento ?? 3,
                    frecuencia_mora_h: deuda.configuracion?.frecuencia_mora_h ?? 48,
                    frecuencia_recuperacion_h: deuda.configuracion?.frecuencia_recuperacion_h ?? 72,
                })
            } else {
                reset({
                    cliente_id: defaultClienteId ?? '',
                    descripcion: '',
                    montos_activos: false,
                    monto_original: undefined as unknown as number,
                    saldo_pendiente: 0,
                    cuota_mensual: undefined,
                    tasa_interes: 0,
                    frecuencia_pago: 'mensual',
                    dia_corte_2: 30,
                    fecha_corte: '',
                    es_deuda_existente: false,
                    fecha_deuda_origen: '',
                    agente_id: '',
                    dias_antes_vencimiento: 3,
                    frecuencia_mora_h: 48,
                    frecuencia_recuperacion_h: 72,
                })
            }
        }
    }, [open, deuda, defaultClienteId, reset])

    const [autoAgente, setAutoAgente] = useState(false)

    const autoAssignAgente = (cId: string) => {
        if (deuda) return
        const cliente = clientes.find(c => c.id === cId)
        if (cliente?.agente_id) {
            setValue('agente_id', cliente.agente_id)
            setAutoAgente(true)
        } else {
            setAutoAgente(false)
        }
    }

    useEffect(() => {
        if (!deuda && montosActivos && montoOriginal && montoOriginal > 0) {
            setValue('saldo_pendiente', montoOriginal)
        }
    }, [montoOriginal, deuda, setValue, montosActivos])

    useEffect(() => {
        if (frecuencia === 'quincenal') {
            const current = watch('dia_corte_2')
            if (!current) setValue('dia_corte_2', 30)
        }
    }, [frecuencia, setValue, watch])

    const onSubmit = (data: DeudaFormData) => {
        startTransition(async () => {
            try {
                if (deuda) {
                    await updateDeuda(deuda.id, data)
                    toast.success('Cuenta actualizada correctamente')
                } else {
                    await createDeuda(data)
                    toast.success('Cuenta registrada correctamente')
                }
                reset()
                onClose()
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : 'Error al guardar'
                const isServerActionDesync =
                    typeof message === 'string'
                    && (
                        message.includes('was not found on the server')
                        || message.includes('failed-to-find-server-action')
                    )

                if (isServerActionDesync) {
                    toast.error('Se actualizó el sistema. Recargando para sincronizar...')
                    setTimeout(() => window.location.reload(), 1200)
                    return
                }

                toast.error(message)
            }
        })
    }

    return (
        <Sheet open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }}>
            <SheetContent className="bg-slate-900 border-white/10 text-white w-full max-w-lg overflow-y-auto">
                <SheetHeader className="mb-6">
                    <SheetTitle className="text-white">{deuda ? 'Editar Cuenta' : 'Nueva Cuenta / Deuda'}</SheetTitle>
                </SheetHeader>

                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-5 pb-6">

                    {/* ── Cliente con búsqueda ── */}
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Cliente *</Label>
                        <div className="relative">
                            <div
                                className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-800 border border-white/10 cursor-pointer hover:border-white/20 transition-colors"
                                onClick={() => setClienteDropdownOpen(!clienteDropdownOpen)}
                            >
                                {selectedCliente ? (
                                    <span className="text-white text-sm flex-1">
                                        {selectedCliente.nombre} {selectedCliente.apellido} — {selectedCliente.telefono}
                                    </span>
                                ) : (
                                    <span className="text-slate-500 text-sm flex-1">Selecciona un cliente...</span>
                                )}
                                <Search className="w-4 h-4 text-slate-500 shrink-0" />
                            </div>

                            {clienteDropdownOpen && (
                                <div className="absolute z-50 mt-1 w-full rounded-lg bg-slate-800 border border-white/10 shadow-xl max-h-64 overflow-hidden">
                                    <div className="p-2 border-b border-white/5">
                                        <div className="relative">
                                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                                            <input
                                                type="text"
                                                value={clienteSearch}
                                                onChange={e => setClienteSearch(e.target.value)}
                                                placeholder="Buscar por nombre, teléfono o cédula..."
                                                className="w-full pl-8 pr-3 py-2 bg-slate-900 border border-white/10 rounded-md text-sm text-white placeholder:text-slate-500 outline-none focus:border-[#007EC6]/50"
                                                autoFocus
                                            />
                                        </div>
                                    </div>
                                    <div className="overflow-y-auto max-h-48">
                                        {filteredClientes.length === 0 ? (
                                            <div className="p-4 text-center text-slate-500 text-sm">
                                                No se encontraron clientes
                                            </div>
                                        ) : filteredClientes.map(c => (
                                            <button
                                                key={c.id}
                                                type="button"
                                                className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
                                                onClick={() => {
                                                    setValue('cliente_id', c.id)
                                                    setClienteDropdownOpen(false)
                                                    setClienteSearch('')
                                                    autoAssignAgente(c.id)
                                                }}
                                            >
                                                <div className="text-sm text-white font-medium">{c.nombre} {c.apellido}</div>
                                                <div className="text-xs text-slate-500">{c.telefono}{c.dni_ruc ? ` · ${c.dni_ruc}` : ''}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        {errors.cliente_id && <p className="text-xs text-red-400">{errors.cliente_id.message}</p>}
                    </div>

                    {/* ── Deuda existente toggle ── */}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
                        <Switch
                            id="es-existente"
                            checked={esExistente}
                            onCheckedChange={v => setValue('es_deuda_existente', v)}
                        />
                        <div>
                            <Label htmlFor="es-existente" className="text-slate-200 text-sm cursor-pointer">
                                Deuda pre-existente
                            </Label>
                            <p className="text-xs text-slate-500 mt-0.5">Marca esto si la deuda ya existía antes del sistema</p>
                        </div>
                    </div>

                    {esExistente && (
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Fecha de origen de la deuda</Label>
                            <Input type="date" className="bg-slate-800 border-white/10 text-white" {...register('fecha_deuda_origen')} />
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Descripción</Label>
                        <Textarea className="bg-slate-800 border-white/10 text-white resize-none" rows={2} {...register('descripcion')} />
                    </div>

                    {/* ── Frecuencia de pago ── */}
                    <div className="space-y-3 p-4 rounded-xl bg-slate-800/50 border border-white/5">
                        <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-[#5bbfed]" />
                            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Frecuencia de Pago</p>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {FRECUENCIA_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setValue('frecuencia_pago', opt.value)}
                                    className="rounded-xl p-3 text-left transition-all duration-150"
                                    style={{
                                        background: frecuencia === opt.value ? 'rgba(0,126,198,0.15)' : 'rgba(255,255,255,0.03)',
                                        border: frecuencia === opt.value ? '1px solid rgba(0,126,198,0.4)' : '1px solid rgba(255,255,255,0.06)',
                                    }}
                                >
                                    <p className="text-xs font-semibold" style={{ color: frecuencia === opt.value ? '#5bbfed' : '#94a3b8' }}>{opt.label}</p>
                                    <p className="text-[10px] mt-0.5" style={{ color: frecuencia === opt.value ? '#5bbfed99' : '#475569' }}>{opt.desc}</p>
                                </button>
                            ))}
                        </div>

                        {frecuencia === 'quincenal' && (
                            <div className="space-y-1.5 pt-1">
                                <Label className="text-slate-400 text-xs">Segundo día de corte (el primero viene de la fecha de corte)</Label>
                                <Input type="number" min={1} max={31} className="bg-slate-900 border-white/10 text-white text-sm" {...register('dia_corte_2')} />
                                <p className="text-[10px] text-slate-500">Ej: si la fecha de corte es el 15, pon 30 aquí. Los meses sin día 30 usan el último día.</p>
                                {errors.dia_corte_2 && <p className="text-xs text-red-400">{errors.dia_corte_2.message}</p>}
                            </div>
                        )}
                    </div>

                    {/* ── Fecha de corte ── */}
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-[#5bbfed]" />
                            <Label className="text-slate-300">Fecha de Corte *</Label>
                        </div>
                        <Input type="date" className="bg-slate-800 border-white/10 text-white" {...register('fecha_corte')} />
                        <p className="text-[10px] text-slate-500">
                            {frecuencia === 'mensual' && 'Día en que se espera el pago cada mes'}
                            {frecuencia === 'quincenal' && 'Primera fecha de pago. La segunda se calcula con el día de arriba'}
                            {frecuencia === 'semanal' && 'Próximo día de pago. Se avanzará cada 7 días'}
                        </p>
                        {errors.fecha_corte && <p className="text-xs text-red-400">{errors.fecha_corte.message}</p>}
                    </div>

                    {/* ── Montos toggle ── */}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                        <Switch
                            id="montos-activos"
                            checked={montosActivos}
                            onCheckedChange={v => setValue('montos_activos', v)}
                        />
                        <div>
                            <div className="flex items-center gap-2">
                                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                                <Label htmlFor="montos-activos" className="text-slate-200 text-sm cursor-pointer">
                                    Configurar montos
                                </Label>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                                {montosActivos
                                    ? 'Registra monto, saldo, cuota y tasa de interés'
                                    : 'Solo registra que el cliente debe (sin montos específicos)'}
                            </p>
                        </div>
                    </div>

                    {montosActivos && (
                        <>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label className="text-slate-300">Monto Original *</Label>
                                    <Input type="number" step="0.01" className="bg-slate-800 border-white/10 text-white" {...register('monto_original')} />
                                    {errors.monto_original && <p className="text-xs text-red-400">{errors.monto_original.message}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-slate-300">Saldo Pendiente *</Label>
                                    <Input type="number" step="0.01" className="bg-slate-800 border-white/10 text-white" {...register('saldo_pendiente')} />
                                    {errors.saldo_pendiente && <p className="text-xs text-red-400">{errors.saldo_pendiente.message}</p>}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-slate-300">
                                    Cuota {frecuencia === 'mensual' ? 'Mensual' : frecuencia === 'quincenal' ? 'Quincenal' : 'Semanal'}
                                </Label>
                                <Input type="number" step="0.01"
                                    placeholder={`Monto por ${frecuencia === 'mensual' ? 'mes' : frecuencia === 'quincenal' ? 'quincena' : 'semana'} (opcional)`}
                                    className="bg-slate-800 border-white/10 text-white" {...register('cuota_mensual')} />
                                <p className="text-xs text-slate-500">Si se deja vacío, se trata como pago único.</p>
                                {errors.cuota_mensual && <p className="text-xs text-red-400">{errors.cuota_mensual.message}</p>}
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-slate-300">Tasa de Interés (%)</Label>
                                <Input type="number" step="0.01" placeholder="0" className="bg-slate-800 border-white/10 text-white" {...register('tasa_interes')} />
                            </div>
                        </>
                    )}

                    {/* ── Agente ── */}
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Agente asignado</Label>
                        <Select
                            onValueChange={v => {
                                setValue('agente_id', v === 'none' ? '' : v)
                                setAutoAgente(false)
                            }}
                            value={watch('agente_id') || 'none'}
                        >
                            <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                                <SelectValue placeholder="Sin asignar" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-white/10 text-white">
                                <SelectItem value="none">Sin asignar</SelectItem>
                                {agentes.map(a => <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        {autoAgente && !deuda && (
                            <p className="text-xs text-[#5bbfed]">Asignado automáticamente del agente del cliente. Puedes cambiarlo.</p>
                        )}
                    </div>

                    {/* ── Configuración de recordatorios ── */}
                    <div className="space-y-3 p-4 rounded-xl bg-slate-800/50 border border-white/5">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Configuración de Recordatorios</p>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-slate-400 text-xs">Días antes del vencimiento</Label>
                                <Input type="number" className="bg-slate-900 border-white/10 text-white text-sm" {...register('dias_antes_vencimiento')} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-400 text-xs">Frecuencia mora (h)</Label>
                                <Input type="number" className="bg-slate-900 border-white/10 text-white text-sm" {...register('frecuencia_mora_h')} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-400 text-xs">Frecuencia recuperación (h)</Label>
                                <Input type="number" className="bg-slate-900 border-white/10 text-white text-sm" {...register('frecuencia_recuperacion_h')} />
                            </div>
                        </div>
                    </div>

                    <Button type="submit" disabled={isPending} className="w-full text-white" style={{ background: "linear-gradient(135deg, #007EC6, #0096E8)" }}>
                        {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : deuda ? 'Actualizar' : 'Registrar Cuenta'}
                    </Button>
                </form>
            </SheetContent>
        </Sheet>
    )
}
