'use client'

import { useState } from 'react'
import { EnvioLog } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const ETAPA_CSS: Record<string, string> = {
    preventivo: 'bg-green-500/20 text-green-300',
    mora_temprana: 'bg-yellow-500/20 text-yellow-300',
    mora_alta: 'bg-orange-500/20 text-orange-300',
    recuperacion: 'bg-red-500/20 text-red-300',
}
const ETAPA_LABELS: Record<string, string> = {
    preventivo: 'Preventivo', mora_temprana: 'Mora Temprana',
    mora_alta: 'Mora Alta', recuperacion: 'Recuperación',
}
const ESTADO_CSS: Record<string, string> = {
    enviado: 'bg-green-500/20 text-green-300',
    error: 'bg-red-500/20 text-red-300',
    omitido: 'bg-slate-500/20 text-slate-400',
    pendiente: 'bg-yellow-500/20 text-yellow-300',
}

interface LogEntry extends Partial<Omit<EnvioLog, 'etapa' | 'tipo_destino' | 'estado' | 'enviado_por' | 'cliente' | 'agente'>> {
    id: string
    etapa: string
    estado: string
    enviado_por: string
    sent_at: string
    tipo_destino: string
    mensaje_enviado: string
    payload: Record<string, unknown>
    cliente?: { nombre: string; apellido: string } | null
    agente?: { full_name: string } | null
    respuesta_http?: number
    respuesta_body?: string
}

interface LogsViewProps {
    logs: LogEntry[]
}

export function LogsView({ logs }: LogsViewProps) {
    const [search, setSearch] = useState('')
    const [etapaFilter, setEtapaFilter] = useState('')
    const [estadoFilter, setEstadoFilter] = useState('')
    const [expandedId, setExpandedId] = useState<string | null>(null)

    const filtered = logs.filter(l => {
        const term = search.toLowerCase()
        const nombre = `${l.cliente?.nombre ?? ''} ${l.cliente?.apellido ?? ''}`.toLowerCase()
        if (!nombre.includes(term)) return false
        if (etapaFilter && l.etapa !== etapaFilter) return false
        if (estadoFilter && l.estado !== estadoFilter) return false
        return true
    })

    const enviados = logs.filter(l => l.estado === 'enviado').length
    const errores = logs.filter(l => l.estado === 'error').length
    const hoy = logs.filter(l => l.sent_at?.startsWith(new Date().toISOString().split('T')[0])).length

    return (
        <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
                {[
                    { label: 'Total registros', value: logs.length, color: 'text-white' },
                    { label: 'Enviados ok', value: enviados, color: 'text-green-400' },
                    { label: 'Errores', value: errores, color: 'text-red-400' },
                ].map(s => (
                    <div key={s.label} className="bg-slate-800/50 border border-white/5 rounded-xl p-4 text-center">
                        <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
                    </div>
                ))}
            </div>

            {/* Filtros */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por cliente..."
                        className="pl-9 bg-slate-800 border-white/10 text-white placeholder:text-slate-500" />
                </div>
                <Select onValueChange={v => setEtapaFilter(v === 'todas' ? '' : v)}>
                    <SelectTrigger className="w-44 bg-slate-800 border-white/10 text-white">
                        <SelectValue placeholder="Etapa" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-white/10 text-white">
                        <SelectItem value="todas">Todas</SelectItem>
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
                        <SelectItem value="enviado">Enviado</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                        <SelectItem value="omitido">Omitido</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Tabla */}
            <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-white/5 text-slate-500 text-xs">
                                <th className="text-left p-4 font-medium w-6"></th>
                                <th className="text-left p-4 font-medium">Fecha</th>
                                <th className="text-left p-4 font-medium">Cliente</th>
                                <th className="text-left p-4 font-medium">Etapa</th>
                                <th className="text-left p-4 font-medium">Tipo</th>
                                <th className="text-left p-4 font-medium">Enviado por</th>
                                <th className="text-left p-4 font-medium">HTTP</th>
                                <th className="text-left p-4 font-medium">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filtered.length === 0 ? (
                                <tr><td colSpan={8} className="text-center p-12 text-slate-500">No se encontraron registros</td></tr>
                            ) : filtered.map(l => (
                                <>
                                    <tr key={l.id} className="text-slate-300 hover:bg-white/3 transition-colors cursor-pointer"
                                        onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}>
                                        <td className="p-4">
                                            {expandedId === l.id
                                                ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                                                : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                                        </td>
                                        <td className="p-4 whitespace-nowrap text-xs text-slate-400">
                                            {new Date(l.sent_at).toLocaleString('es-DO')}
                                        </td>
                                        <td className="p-4 font-medium text-white">
                                            {l.cliente ? `${l.cliente.nombre} ${l.cliente.apellido}` : '—'}
                                        </td>
                                        <td className="p-4">
                                            <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', ETAPA_CSS[l.etapa])}>
                                                {ETAPA_LABELS[l.etapa] ?? l.etapa}
                                            </span>
                                        </td>
                                        <td className="p-4 text-xs">
                                            <span className={cn('px-1.5 py-0.5 rounded',
                                                l.tipo_destino === 'referencia' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300')}>
                                                {l.tipo_destino}
                                            </span>
                                        </td>
                                        <td className="p-4 text-xs text-slate-400">{l.enviado_por}</td>
                                        <td className="p-4 text-xs font-mono">
                                            {l.respuesta_http ? (
                                                <span className={l.respuesta_http < 300 ? 'text-green-400' : 'text-red-400'}>
                                                    {l.respuesta_http}
                                                </span>
                                            ) : '—'}
                                        </td>
                                        <td className="p-4">
                                            <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', ESTADO_CSS[l.estado])}>
                                                {l.estado}
                                            </span>
                                        </td>
                                    </tr>
                                    {expandedId === l.id && (
                                        <tr key={`${l.id}-expanded`} className="bg-slate-900/50">
                                            <td colSpan={8} className="px-8 py-4 space-y-3">
                                                <div>
                                                    <p className="text-xs text-slate-500 mb-1">Mensaje enviado:</p>
                                                    <p className="text-sm text-slate-300 whitespace-pre-wrap">{l.mensaje_enviado}</p>
                                                </div>
                                                {l.respuesta_body && (
                                                    <div>
                                                        <p className="text-xs text-slate-500 mb-1">Respuesta del webhook:</p>
                                                        <p className="text-xs font-mono text-slate-400 bg-slate-900 p-2 rounded">{l.respuesta_body}</p>
                                                    </div>
                                                )}
                                                {l.agente && (
                                                    <p className="text-xs text-slate-500">Agente: <span className="text-slate-300">{l.agente.full_name}</span></p>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="px-4 py-3 border-t border-white/5 text-xs text-slate-500">
                    {filtered.length} de {logs.length} registros
                </div>
            </div>
        </div>
    )
}
