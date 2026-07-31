'use client'

import { useState, useTransition, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import {
    crearSucursal, actualizarSucursal,
    crearEstacion, actualizarEstacion, regenerarTokenEstacion,
} from '@/lib/actions/estaciones'
import { imprimirPaginaDePrueba } from '@/lib/actions/impresion'
import type { PrintJobConDetalle } from '@/lib/actions/impresion'
import { ColaImpresion } from './cola-impresion'
import { CODEPAGES } from '@/lib/escpos/codificacion'
import { ANCHO_COLS_MIN, ANCHO_COLS_MAX } from '@/lib/validations/estaciones'
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
    /** Cola de impresión de todas las sucursales, para el bloque bajo cada
     *  estación. Ausente para quien no cargue getColaImpresion(); en la
     *  práctica siempre llega, porque esta vista solo la renderiza la
     *  página de administración (`/estaciones`). */
    trabajosImpresion?: PrintJobConDetalle[]
}

// ─── Reloj compartido para el estado de conexión ────────────────
//
// «En línea» es una resta contra la hora actual, así que no se puede calcular
// durante el render: el servidor pintaría un instante y el navegador otro
// (discrepancia de hidratación) y, sobre todo, el resultado quedaría
// congelado — una estación que dejara de latir seguiría anunciándose «En
// línea» hasta que alguien recargara la página a mano.
//
// La hora es un sistema externo, así que se lee con useSyncExternalStore:
// un único temporizador para toda la pantalla publica una marca de tiempo
// nueva cada RELOJ_TICK_MS y React repinta las tarjetas afectadas.

/** Silencio máximo tolerado antes de dar una estación por desconectada.
 *  Va a la par con el mismo cálculo del servidor
 *  (`getEstadoEstacionDeUsuario`, en lib/actions/impresion.ts). */
const UMBRAL_EN_LINEA_MS = 60_000

/** Cada cuánto se reevalúa el umbral en pantalla. El agente late en cada
 *  sondeo (≈25 s), así que revisar cada 15 s basta para que el corte se vea
 *  con poco retraso sin repintar de más. */
const RELOJ_TICK_MS = 15_000

let ahoraPublicado: number | null = null
let temporizadorReloj: ReturnType<typeof setInterval> | null = null
const oyentesDelReloj = new Set<() => void>()

function suscribirseAlReloj(oyente: () => void) {
    oyentesDelReloj.add(oyente)
    if (temporizadorReloj === null) {
        ahoraPublicado = Date.now()
        temporizadorReloj = setInterval(() => {
            ahoraPublicado = Date.now()
            for (const o of oyentesDelReloj) o()
        }, RELOJ_TICK_MS)
    }
    return () => {
        oyentesDelReloj.delete(oyente)
        if (oyentesDelReloj.size === 0 && temporizadorReloj !== null) {
            clearInterval(temporizadorReloj)
            temporizadorReloj = null
            ahoraPublicado = null
        }
    }
}

const leerAhora = () => ahoraPublicado
const leerAhoraEnElServidor = (): number | null => null

/** Marca de tiempo que avanza sola. Vale `null` en el HTML del servidor y en
 *  la primera pintura del navegador: ahí todavía no hay reloj y el estado se
 *  muestra como «Comprobando...» en vez de inventarse una respuesta. */
function useAhora(): number | null {
    return useSyncExternalStore(suscribirseAlReloj, leerAhora, leerAhoraEnElServidor)
}

// ─── Dialog: crear/editar sucursal ─────────────────────────────

function SucursalFormModal({
    open, onClose, sesion, sucursal,
}: { open: boolean; onClose: () => void; sesion: number; sucursal?: Sucursal }) {
    return (
        <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg">
                <DialogHeader><DialogTitle>{sucursal ? 'Editar sucursal' : 'Nueva sucursal'}</DialogTitle></DialogHeader>
                {/* `key={sesion}`: cada apertura monta un formulario nuevo, así
                    los campos arrancan de la sucursal elegida sin copiar
                    prop -> estado desde un efecto. La sesión solo cambia al
                    abrir, nunca al cerrar, para que los valores no se borren a
                    la vista durante la animación de salida. */}
                <SucursalForm key={sesion} onClose={onClose} sucursal={sucursal} />
            </DialogContent>
        </Dialog>
    )
}

function SucursalForm({
    onClose, sucursal,
}: { onClose: () => void; sucursal?: Sucursal }) {
    const [isPending, startTransition] = useTransition()
    const [nombre, setNombre] = useState(sucursal?.nombre ?? '')
    const [direccion, setDireccion] = useState(sucursal?.direccion ?? '')
    const [telefono, setTelefono] = useState(sucursal?.telefono ?? '')
    const [activo, setActivo] = useState(sucursal?.activo ?? true)

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
    )
}

// ─── Dialog: crear/editar estación ─────────────────────────────

function EstacionFormModal({
    open, onClose, sesion, estacion, sucursales, onCreated,
}: {
    open: boolean
    onClose: () => void
    sesion: number
    estacion?: EstacionImpresion
    sucursales: Sucursal[]
    onCreated: (tokenPlano: string) => void
}) {
    return (
        <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
            <DialogContent className="bg-slate-900 border-white/10 text-white max-w-lg">
                <DialogHeader><DialogTitle>{estacion ? 'Editar estación' : 'Nueva estación de impresión'}</DialogTitle></DialogHeader>
                {/* Ver la nota de `key` en SucursalFormModal. Aquí importa más:
                    el mismo diálogo sirve para estaciones distintas, y arrastrar
                    los campos de una a otra guardaría la impresora equivocada. */}
                <EstacionForm
                    key={sesion}
                    onClose={onClose}
                    estacion={estacion}
                    sucursales={sucursales}
                    onCreated={onCreated}
                />
            </DialogContent>
        </Dialog>
    )
}

function EstacionForm({
    onClose, estacion, sucursales, onCreated,
}: {
    onClose: () => void
    estacion?: EstacionImpresion
    sucursales: Sucursal[]
    onCreated: (tokenPlano: string) => void
}) {
    const [isPending, startTransition] = useTransition()
    const [sucursalId, setSucursalId] = useState(estacion?.sucursal_id ?? '')
    const [nombre, setNombre] = useState(estacion?.nombre ?? '')
    const [tipoConexion, setTipoConexion] = useState<TipoConexionEstacion>(estacion?.tipo_conexion ?? 'red')
    const [ip, setIp] = useState(estacion?.impresora_ip ?? '')
    const [port, setPort] = useState(estacion?.impresora_port ?? 9100)
    const [impresoraNombre, setImpresoraNombre] = useState(estacion?.impresora_nombre ?? '')
    const [anchoCols, setAnchoCols] = useState(estacion?.ancho_cols ?? 48)
    const [codepage, setCodepage] = useState(estacion?.codepage ?? 'cp850')
    const [activo, setActivo] = useState(estacion?.activo ?? true)

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
                    <Input
                        type="number"
                        min={ANCHO_COLS_MIN}
                        max={ANCHO_COLS_MAX}
                        required
                        className="bg-slate-800 border-white/10 text-white"
                        value={anchoCols}
                        onChange={e => setAnchoCols(Number(e.target.value))}
                    />
                    <p className="text-xs text-slate-500">Entre {ANCHO_COLS_MIN} y {ANCHO_COLS_MAX}. Menos de {ANCHO_COLS_MIN} puede truncar el número del boleto.</p>
                </div>
                <div className="space-y-1.5">
                    <Label className="text-slate-300">Codepage</Label>
                    <Select value={codepage} onValueChange={setCodepage}>
                        <SelectTrigger className="bg-slate-800 border-white/10 text-white">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-white/10 text-white">
                            {Object.keys(CODEPAGES).map(cp => (
                                <SelectItem key={cp} value={cp}>{cp}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
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

export function EstacionesView({ sucursales, estaciones, trabajosImpresion = [] }: EstacionesViewProps) {
    const [sucursalFormOpen, setSucursalFormOpen] = useState(false)
    const [editSucursal, setEditSucursal] = useState<Sucursal | undefined>()
    const [sesionSucursal, setSesionSucursal] = useState(0)
    const [estacionFormOpen, setEstacionFormOpen] = useState(false)
    const [editEstacion, setEditEstacion] = useState<EstacionImpresion | undefined>()
    const [sesionEstacion, setSesionEstacion] = useState(0)
    const [tokenPlano, setTokenPlano] = useState<string | null>(null)
    const [isPending, startTransition] = useTransition()
    const ahora = useAhora()

    // Cada apertura estrena número de sesión: es la `key` del formulario, y
    // obliga a React a montarlo de cero con los datos de la fila elegida.
    const abrirFormSucursal = (sucursal?: Sucursal) => {
        setEditSucursal(sucursal)
        setSesionSucursal(n => n + 1)
        setSucursalFormOpen(true)
    }

    const abrirFormEstacion = (estacion?: EstacionImpresion) => {
        setEditEstacion(estacion)
        setSesionEstacion(n => n + 1)
        setEstacionFormOpen(true)
    }

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
                    <Button onClick={() => abrirFormSucursal()}
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
                                                onClick={() => abrirFormSucursal(s)}>
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
                    <Button onClick={() => abrirFormEstacion()}
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
                            // Sin ningún latido registrado no hace falta reloj:
                            // la estación nunca se ha conectado.
                            const ultimoLatido = est.ultimo_heartbeat
                                ? new Date(est.ultimo_heartbeat).getTime()
                                : null
                            const conexion: 'en-linea' | 'sin-conexion' | 'comprobando' =
                                ultimoLatido === null
                                    ? 'sin-conexion'
                                    : ahora === null
                                        ? 'comprobando'
                                        : ahora - ultimoLatido < UMBRAL_EN_LINEA_MS
                                            ? 'en-linea'
                                            : 'sin-conexion'
                            const enLinea = conexion === 'en-linea'

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
                                                {conexion === 'en-linea'
                                                    ? 'En línea'
                                                    : conexion === 'comprobando'
                                                        ? 'Comprobando...'
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
                                            onClick={() => abrirFormEstacion(est)}>
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

                                    <div className="border-t border-white/5 pt-3">
                                        <h4 className="mb-1.5 text-xs font-semibold text-slate-400">Cola de impresión</h4>
                                        <ColaImpresion
                                            jobs={trabajosImpresion.filter(j => j.sucursal_id === est.sucursal_id)}
                                        />
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
                sesion={sesionSucursal}
                sucursal={editSucursal}
            />

            <EstacionFormModal
                open={estacionFormOpen}
                onClose={() => { setEstacionFormOpen(false); setEditEstacion(undefined) }}
                sesion={sesionEstacion}
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
