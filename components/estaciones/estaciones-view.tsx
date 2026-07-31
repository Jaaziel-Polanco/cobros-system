'use client'

import { useState, useTransition, useEffect } from 'react'
import { toast } from 'sonner'
import {
    crearSucursal, actualizarSucursal,
    crearEstacion, actualizarEstacion, regenerarTokenEstacion,
} from '@/lib/actions/estaciones'
import { imprimirPaginaDePrueba } from '@/lib/actions/impresion'
import type { Sucursal, EstacionImpresion, TipoConexionEstacion } from '@/lib/types'
import { formatearFechaHoraRD } from '@/lib/utils/fecha-rd'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
    Plus, Pencil, Loader2, Store, Printer, KeyRound, Copy, Check,
    RotateCw, PrinterCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface EstacionesViewProps {
    sucursales: Sucursal[]
    estaciones: EstacionImpresion[]
}

// ─── Dialog: crear/editar sucursal ─────────────────────────────

function SucursalFormModal({
    open, onClose, sucursal,
}: { open: boolean; onClose: () => void; sucursal?: Sucursal }) {
    const [isPending, startTransition] = useTransition()
    const [nombre, setNombre] = useState('')
    const [direccion, setDireccion] = useState('')
    const [telefono, setTelefono] = useState('')
    const [activo, setActivo] = useState(true)

    useEffect(() => {
        if (open) {
            setNombre(sucursal?.nombre ?? '')
            setDireccion(sucursal?.direccion ?? '')
            setTelefono(sucursal?.telefono ?? '')
            setActivo(sucursal?.activo ?? true)
        }
    }, [open, sucursal])

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        startTransition(async () => {
            try {
                if (sucursal) {
                    await actualizarSucursal(sucursal.id, { nombre, direccion, telefono, activo })
                    toast.success('Sucursal actualizada')
                } else {
                    await crearSucursal({ nombre, direccion, telefono })
                    toast.success('Sucursal creada')
                }
                onClose()
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
        })
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg">
                <DialogHeader><DialogTitle>{sucursal ? 'Editar sucursal' : 'Nueva sucursal'}</DialogTitle></DialogHeader>
                <form onSubmit={onSubmit} className="space-y-4 mt-2">
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Nombre *</Label>
                        <Input className="bg-slate-800 border-white/10 text-white" value={nombre} onChange={e => setNombre(e.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Dirección</Label>
                        <Input className="bg-slate-800 border-white/10 text-white" value={direccion} onChange={e => setDireccion(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Teléfono</Label>
                        <Input placeholder="809-000-0000" className="bg-slate-800 border-white/10 text-white" value={telefono} onChange={e => setTelefono(e.target.value)} />
                    </div>
                    {sucursal && (
                        <div className="flex items-center gap-3">
                            <Switch id="suc-activo" checked={activo} onCheckedChange={setActivo} />
                            <Label htmlFor="suc-activo" className="text-slate-300 cursor-pointer">Sucursal activa</Label>
                        </div>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" className="border-white/10 text-slate-300" onClick={onClose}>Cancelar</Button>
                        <Button type="submit" disabled={isPending} className="text-white" style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)' }}>
                            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : 'Guardar'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

// ─── Dialog: crear/editar estación ─────────────────────────────

function EstacionFormModal({
    open, onClose, estacion, sucursales, onCreated,
}: {
    open: boolean
    onClose: () => void
    estacion?: EstacionImpresion
    sucursales: Sucursal[]
    onCreated: (tokenPlano: string) => void
}) {
    const [isPending, startTransition] = useTransition()
    const [sucursalId, setSucursalId] = useState('')
    const [nombre, setNombre] = useState('')
    const [tipoConexion, setTipoConexion] = useState<TipoConexionEstacion>('red')
    const [ip, setIp] = useState('')
    const [port, setPort] = useState(9100)
    const [impresoraNombre, setImpresoraNombre] = useState('')
    const [anchoCols, setAnchoCols] = useState(48)
    const [codepage, setCodepage] = useState('cp850')
    const [activo, setActivo] = useState(true)

    useEffect(() => {
        if (open) {
            setSucursalId(estacion?.sucursal_id ?? '')
            setNombre(estacion?.nombre ?? '')
            setTipoConexion(estacion?.tipo_conexion ?? 'red')
            setIp(estacion?.impresora_ip ?? '')
            setPort(estacion?.impresora_port ?? 9100)
            setImpresoraNombre(estacion?.impresora_nombre ?? '')
            setAnchoCols(estacion?.ancho_cols ?? 48)
            setCodepage(estacion?.codepage ?? 'cp850')
            setActivo(estacion?.activo ?? true)
        }
    }, [open, estacion])

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        startTransition(async () => {
            try {
                const datosConexion = tipoConexion === 'red'
                    ? { impresora_ip: ip, impresora_port: port }
                    : { impresora_nombre: impresoraNombre }

                if (estacion) {
                    await actualizarEstacion(estacion.id, {
                        nombre, tipo_conexion: tipoConexion, ...datosConexion,
                        ancho_cols: anchoCols, codepage, activo,
                    })
                    toast.success('Estación actualizada')
                    onClose()
                } else {
                    if (!sucursalId) { toast.error('Selecciona una sucursal'); return }
                    const { tokenPlano } = await crearEstacion({
                        sucursal_id: sucursalId, nombre, tipo_conexion: tipoConexion,
                        ...datosConexion, ancho_cols: anchoCols, codepage,
                    })
                    onClose()
                    onCreated(tokenPlano)
                }
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
        })
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg">
                <DialogHeader><DialogTitle>{estacion ? 'Editar estación' : 'Nueva estación de impresión'}</DialogTitle></DialogHeader>
                <form onSubmit={onSubmit} className="space-y-4 mt-2">
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Sucursal *</Label>
                        <Select value={sucursalId} onValueChange={setSucursalId} disabled={!!estacion}>
                            <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                                <SelectValue placeholder="Seleccionar sucursal..." />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-white/10 text-white">
                                {sucursales.map(s => (
                                    <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-slate-500">Solo puede haber una estación activa por sucursal.</p>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Nombre *</Label>
                        <Input className="bg-slate-800 border-white/10 text-white" value={nombre} onChange={e => setNombre(e.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-slate-300">Tipo de conexión *</Label>
                        <Select value={tipoConexion} onValueChange={v => setTipoConexion(v as TipoConexionEstacion)}>
                            <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-white/10 text-white">
                                <SelectItem value="red">Impresora de red (IP y puerto)</SelectItem>
                                <SelectItem value="windows">Impresora instalada en Windows</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {tipoConexion === 'red' ? (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label className="text-slate-300">IP de la impresora *</Label>
                                <Input placeholder="192.168.1.50" className="bg-slate-800 border-white/10 text-white font-mono" value={ip} onChange={e => setIp(e.target.value)} required />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-slate-300">Puerto</Label>
                                <Input type="number" className="bg-slate-800 border-white/10 text-white" value={port} onChange={e => setPort(Number(e.target.value))} />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Nombre de la impresora en Windows *</Label>
                            <Input placeholder="POS-80 Series" className="bg-slate-800 border-white/10 text-white font-mono" value={impresoraNombre} onChange={e => setImpresoraNombre(e.target.value)} required />
                            <p className="text-xs text-slate-500">
                                Se encuentra en «Impresoras y escáneres» de Windows, en la PC de la sucursal.
                                Debe escribirse exactamente igual, con los mismos espacios y mayúsculas.
                            </p>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Ancho (columnas)</Label>
                            <Input type="number" className="bg-slate-800 border-white/10 text-white" value={anchoCols} onChange={e => setAnchoCols(Number(e.target.value))} />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-slate-300">Codepage</Label>
                            <Input className="bg-slate-800 border-white/10 text-white" value={codepage} onChange={e => setCodepage(e.target.value)} />
                        </div>
                    </div>
                    {estacion && (
                        <div className="flex items-center gap-3">
                            <Switch id="est-activo" checked={activo} onCheckedChange={setActivo} />
                            <Label htmlFor="est-activo" className="text-slate-300 cursor-pointer">Estación activa</Label>
                        </div>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" className="border-white/10 text-slate-300" onClick={onClose}>Cancelar</Button>
                        <Button type="submit" disabled={isPending} className="text-white" style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)' }}>
                            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : 'Guardar'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

// ─── Dialog: mostrar token en claro (una sola vez) ─────────────

function TokenDialog({ open, onClose, tokenPlano }: { open: boolean; onClose: () => void; tokenPlano: string | null }) {
    const [copiado, setCopiado] = useState(false)

    const copiar = async () => {
        if (!tokenPlano) return
        await navigator.clipboard.writeText(tokenPlano)
        setCopiado(true)
        toast.success('Token copiado')
        setTimeout(() => setCopiado(false), 2000)
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <KeyRound className="w-5 h-5 text-amber-400" />
                        Token de la estación
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                    <div className="p-3 rounded-xl bg-slate-950 border border-white/10 font-mono text-sm text-white break-all">
                        {tokenPlano}
                    </div>
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm">
                        Cópialo ahora. No se puede volver a ver.
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" className="border-white/10 text-slate-300" onClick={onClose}>Cerrar</Button>
                        <Button type="button" onClick={copiar} className="text-white gap-2" style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)' }}>
                            {copiado ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copiado ? 'Copiado' : 'Copiar al portapapeles'}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}

// ─── Vista principal ────────────────────────────────────────────

export function EstacionesView({ sucursales, estaciones }: EstacionesViewProps) {
    const [sucursalFormOpen, setSucursalFormOpen] = useState(false)
    const [editSucursal, setEditSucursal] = useState<Sucursal | undefined>()
    const [estacionFormOpen, setEstacionFormOpen] = useState(false)
    const [editEstacion, setEditEstacion] = useState<EstacionImpresion | undefined>()
    const [tokenPlano, setTokenPlano] = useState<string | null>(null)
    const [isPending, startTransition] = useTransition()

    const handleRegenerar = (id: string, nombre: string) => {
        if (!confirm(`¿Regenerar el token de "${nombre}"? El token actual dejará de funcionar de inmediato.`)) return
        startTransition(async () => {
            try {
                const { tokenPlano } = await regenerarTokenEstacion(id)
                setTokenPlano(tokenPlano)
                toast.success('Token regenerado')
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
        })
    }

    const handleImprimirPrueba = (id: string) => {
        startTransition(async () => {
            try {
                await imprimirPaginaDePrueba(id)
                toast.success('Página de prueba encolada')
            } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
        })
    }

    return (
        <div className="space-y-8">
            {/* ── Sucursales ────────────────────────────────── */}
            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-white font-semibold flex items-center gap-2">
                        <Store className="w-4 h-4" style={{ color: '#007EC6' }} />
                        Sucursales
                    </h2>
                    <Button onClick={() => { setEditSucursal(undefined); setSucursalFormOpen(true) }}
                        className="text-white gap-2" style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)', boxShadow: '0 4px 12px rgba(0,126,198,0.25)' }}>
                        <Plus className="w-4 h-4" />Nueva sucursal
                    </Button>
                </div>

                {sucursales.length === 0 ? (
                    <div className="text-center p-16 text-slate-500 bg-slate-800/50 border border-white/5 rounded-2xl">
                        No hay sucursales registradas
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-2xl border border-white/5">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-800/50 text-slate-400 text-xs uppercase tracking-wide">
                                    <th className="text-left font-semibold px-4 py-3">Nombre</th>
                                    <th className="text-left font-semibold px-4 py-3">Dirección</th>
                                    <th className="text-left font-semibold px-4 py-3">Teléfono</th>
                                    <th className="text-left font-semibold px-4 py-3">Estado</th>
                                    <th className="text-right font-semibold px-4 py-3">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sucursales.map(s => (
                                    <tr key={s.id} className="border-t border-white/5 text-slate-300">
                                        <td className="px-4 py-3 font-medium text-white">{s.nombre}</td>
                                        <td className="px-4 py-3 text-slate-400">{s.direccion || '—'}</td>
                                        <td className="px-4 py-3 text-slate-400">{s.telefono || '—'}</td>
                                        <td className="px-4 py-3">
                                            <span className={cn('text-xs font-medium', s.activo ? 'text-green-400' : 'text-slate-500')}>
                                                {s.activo ? '● Activa' : '○ Inactiva'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Button size="sm" variant="outline" className="border-white/10 text-slate-300 hover:bg-white/5"
                                                onClick={() => { setEditSucursal(s); setSucursalFormOpen(true) }}>
                                                <Pencil className="w-3.5 h-3.5" />
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {/* ── Estaciones ────────────────────────────────── */}
            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-white font-semibold flex items-center gap-2">
                        <Printer className="w-4 h-4" style={{ color: '#007EC6' }} />
                        Estaciones de impresión
                    </h2>
                    <Button onClick={() => { setEditEstacion(undefined); setEstacionFormOpen(true) }}
                        disabled={sucursales.length === 0}
                        className="text-white gap-2" style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)', boxShadow: '0 4px 12px rgba(0,126,198,0.25)' }}>
                        <Plus className="w-4 h-4" />Nueva estación
                    </Button>
                </div>

                {estaciones.length === 0 ? (
                    <div className="text-center p-16 text-slate-500 bg-slate-800/50 border border-white/5 rounded-2xl">
                        No hay estaciones registradas
                    </div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                        {estaciones.map(est => {
                            const enLinea = est.ultimo_heartbeat
                                ? Date.now() - new Date(est.ultimo_heartbeat).getTime() < 60_000
                                : false

                            return (
                                <div key={est.id} className="bg-slate-800/50 border border-white/5 rounded-2xl p-5 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <h3 className="font-semibold text-white">{est.nombre}</h3>
                                            <p className="text-xs text-slate-500">{est.sucursal?.nombre ?? 'Sin sucursal'}</p>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <div className={cn('w-2 h-2 rounded-full', enLinea ? 'bg-green-400' : 'bg-slate-500')} />
                                            <span className={cn('text-xs font-medium', enLinea ? 'text-green-400' : 'text-slate-500')}>
                                                {enLinea
                                                    ? 'En línea'
                                                    : est.ultimo_heartbeat
                                                        ? `Sin conexión desde ${formatearFechaHoraRD(est.ultimo_heartbeat)}`
                                                        : 'Sin conexión'}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="text-sm text-slate-300 font-mono">
                                        {est.tipo_conexion === 'windows'
                                            ? `Windows: ${est.impresora_nombre}`
                                            : `Red: ${est.impresora_ip}:${est.impresora_port}`}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        {est.ancho_cols} columnas · {est.codepage}
                                    </div>

                                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                                        <KeyRound className="w-3.5 h-3.5" />
                                        <span className="font-mono">{est.token_prefijo}…</span>
                                    </div>

                                    <div className="flex flex-wrap gap-2 pt-1">
                                        <Button size="sm" variant="outline" disabled={isPending}
                                            className="border-white/10 text-slate-300 hover:bg-white/5 gap-1.5"
                                            onClick={() => { setEditEstacion(est); setEstacionFormOpen(true) }}>
                                            <Pencil className="w-3.5 h-3.5" />Editar
                                        </Button>
                                        <Button size="sm" variant="outline" disabled={isPending}
                                            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 gap-1.5"
                                            onClick={() => handleRegenerar(est.id, est.nombre)}>
                                            <RotateCw className="w-3.5 h-3.5" />Regenerar token
                                        </Button>
                                        <Button size="sm" variant="outline" disabled={isPending}
                                            className="border-white/10 text-slate-300 hover:bg-white/5 gap-1.5"
                                            onClick={() => handleImprimirPrueba(est.id)}>
                                            <PrinterCheck className="w-3.5 h-3.5" />Imprimir página de prueba
                                        </Button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </section>

            <SucursalFormModal
                open={sucursalFormOpen}
                onClose={() => { setSucursalFormOpen(false); setEditSucursal(undefined) }}
                sucursal={editSucursal}
            />

            <EstacionFormModal
                open={estacionFormOpen}
                onClose={() => { setEstacionFormOpen(false); setEditEstacion(undefined) }}
                estacion={editEstacion}
                sucursales={sucursales}
                onCreated={token => setTokenPlano(token)}
            />

            <TokenDialog
                open={!!tokenPlano}
                onClose={() => setTokenPlano(null)}
                tokenPlano={tokenPlano}
            />
        </div>
    )
}
