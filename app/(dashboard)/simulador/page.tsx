'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
    Play, Trash2, RefreshCw, CheckCircle, XCircle, Loader2,
    Clock, Zap, AlertTriangle, TrendingUp, Send, FlaskConical,
    ChevronRight, Terminal, Radio,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Tipos ───────────────────────────────────────────────────────
interface SimResult {
    ok: boolean
    simulacion?: {
        cliente_id: string
        deuda_id: string
        cliente: string
        fecha_corte: string
        dias_atraso: number
        etapa: string
        monto_original: number
        saldo_pendiente: number
        frecuencia_envio_h: number
        mensaje: string
    }
    error?: string
}

interface CronResult {
    ok: boolean
    procesadas?: number
    enviados?: number
    omitidos?: number
    errores?: number
    error?: string
    timestamp?: string
}

interface LogLine {
    time: string
    type: 'info' | 'success' | 'error' | 'warn' | 'cron'
    msg: string
}

const ETAPA_INFO: Record<string, { label: string; color: string; bg: string; icon: string; dias: string }> = {
    preventivo: { label: 'Preventivo', color: '#6ee7b7', bg: 'rgba(16,185,129,0.12)', icon: '🟢', dias: '0 días — cuenta al día' },
    mora_temprana: { label: 'Mora Temprana', color: '#fcd34d', bg: 'rgba(245,158,11,0.12)', icon: '🟡', dias: '1–15 días de atraso' },
    mora_alta: { label: 'Mora Alta', color: '#fca5a5', bg: 'rgba(239,68,68,0.12)', icon: '🔴', dias: '16–30 días de atraso' },
    recuperacion: { label: 'Recuperación', color: '#d8b4fe', bg: 'rgba(168,85,247,0.12)', icon: '🟣', dias: '+30 días de atraso' },
}

const SCENARIOS = [
    { label: 'Preventivo', diasAtraso: 0, desc: 'Cuenta al día — 1 semana antes del vencimiento', etapa: 'preventivo' },
    { label: 'Mora Temprana', diasAtraso: 8, desc: '8 días de atraso — primer recordatorio de mora', etapa: 'mora_temprana' },
    { label: 'Mora Alta', diasAtraso: 20, desc: '20 días de atraso — alerta de mora alta', etapa: 'mora_alta' },
    { label: 'Recuperación', diasAtraso: 45, desc: '45 días de atraso — gestión de recuperación + referencias', etapa: 'recuperacion' },
]

function now() { return new Date().toLocaleTimeString('es-DO') }

export default function SimuladorPage() {
    const [cronSecret, setCronSecret] = useState('')
    const [secretReady, setSecretReady] = useState(false)
    const [selectedScenario, setSelectedScenario] = useState(1) // mora_temprana por defecto
    const [simResult, setSimResult] = useState<SimResult | null>(null)
    const [cronResult, setCronResult] = useState<CronResult | null>(null)
    const [phase, setPhase] = useState<'idle' | 'creando' | 'esperando' | 'disparando' | 'done' | 'error'>('idle')
    const [countdown, setCountdown] = useState(0)
    const [totalCountdown, setTotalCountdown] = useState(0)
    const [logs, setLogs] = useState<LogLine[]>([])
    const [autoFire, setAutoFire] = useState(true)
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const logsEndRef = useRef<HTMLDivElement>(null)

    const addLog = useCallback((type: LogLine['type'], msg: string) => {
        setLogs(prev => [...prev, { time: now(), type, msg }])
        setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }, [])

    // Cargar CRON_SECRET al montar
    useEffect(() => {
        fetch('/api/simulate/secret')
            .then(r => r.json())
            .then(d => {
                if (d.secret) { setCronSecret(d.secret); setSecretReady(true) }
            })
            .catch(() => { /* se ingresa manual */ })
    }, [])

    const clearTimer = () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    }

    // ── PASO 1: Crear simulación ──────────────────────────────────
    const handleCrearSimulacion = async () => {
        if (!cronSecret) { toast.error('Ingresa el CRON_SECRET'); return }
        const scen = SCENARIOS[selectedScenario]
        setPhase('creando')
        setSimResult(null)
        setCronResult(null)
        setLogs([])
        addLog('info', `Iniciando simulación: "${scen.label}" (${scen.diasAtraso} días de atraso)`)
        addLog('info', 'Creando cliente y deuda de prueba en Supabase...')

        try {
            const res = await fetch('/api/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
                body: JSON.stringify({ dias_atraso: scen.diasAtraso }),
            })
            const data: SimResult = await res.json()

            if (!data.ok || !data.simulacion) {
                addLog('error', `Error: ${data.error ?? 'Respuesta inesperada'}`)
                setPhase('error')
                return
            }

            setSimResult(data)
            addLog('success', `✅ Cliente creado: "${data.simulacion.cliente}"`)
            addLog('success', `✅ Deuda creada — Etapa: ${data.simulacion.etapa} | Saldo: RD$${data.simulacion.saldo_pendiente.toLocaleString('es-DO')}`)
            addLog('info', `⏱  Frecuencia de envío configurada: ${data.simulacion.frecuencia_envio_h}h (modo test = 1h)`)

            if (autoFire) {
                const WAIT_SECS = 10 //  Esperamos 10 s y disparamos el cron para validar
                addLog('warn', `🔄 Auto-disparo en ${WAIT_SECS} segundos... Puedes cancelar y disparar manualmente.`)
                setCountdown(WAIT_SECS)
                setTotalCountdown(WAIT_SECS)
                setPhase('esperando')

                timerRef.current = setInterval(() => {
                    setCountdown(prev => {
                        if (prev <= 1) {
                            clearTimer()
                            handleDispararCron(cronSecret)
                            return 0
                        }
                        return prev - 1
                    })
                }, 1000)
            } else {
                setPhase('idle')
                addLog('info', 'Pulsa "Disparar Cron" cuando quieras ejecutar el envío.')
            }
        } catch (e) {
            addLog('error', `Error de red: ${String(e)}`)
            setPhase('error')
        }
    }

    // ── PASO 2: Disparar el cron ─────────────────────────────────
    const handleDispararCron = async (secret?: string) => {
        const s = secret ?? cronSecret
        clearTimer()
        setPhase('disparando')
        addLog('cron', '🚀 Disparando cron /api/cron/recordatorios...')

        try {
            const res = await fetch('/api/cron/recordatorios', {
                headers: { 'x-cron-secret': s },
            })
            const data: CronResult = await res.json()
            setCronResult(data)

            if (data.ok) {
                addLog('success', `✅ CRON completado — Procesadas: ${data.procesadas} | Enviadas: ${data.enviados} | Omitidas: ${data.omitidos} | Errores: ${data.errores}`)
                if ((data.enviados ?? 0) > 0) {
                    addLog('success', `📨 Payload enviado al webhook. Verifica tu n8n/endpoint.`)
                    setPhase('done')
                    toast.success(`Cron ejecutado — ${data.enviados} mensajes enviados al webhook`)
                } else {
                    addLog('warn', `⚠️  Cron ejecutó pero no hubo envíos nuevos. Posiblemente el anti-duplicado está activo (último envío < 1h). Espera y vuelve a disparar.`)
                    setPhase('done')
                    toast.info('Cron ejecutado — sin nuevos envíos (anti-duplicado activo)')
                }
            } else {
                addLog('error', `❌ CRON error: ${data.error}`)
                setPhase('error')
                toast.error(`Error en cron: ${data.error}`)
            }
        } catch (e) {
            addLog('error', `Error de red disparando cron: ${String(e)}`)
            setPhase('error')
        }
    }

    // ── Limpiar datos de simulación ──────────────────────────────
    const handleLimpiar = async () => {
        clearTimer()
        if (!cronSecret) { toast.error('Ingresa el CRON_SECRET'); return }
        addLog('warn', '🧹 Eliminando datos de simulación...')
        try {
            const res = await fetch('/api/simulate', {
                method: 'DELETE',
                headers: { 'x-cron-secret': cronSecret },
            })
            const data = await res.json()
            addLog('success', `✅ Eliminados ${data.eliminados ?? 0} registro(s) de simulación`)
            setSimResult(null)
            setCronResult(null)
            setPhase('idle')
            toast.success('Datos de simulación eliminados')
        } catch (e) {
            addLog('error', `Error limpiando: ${String(e)}`)
        }
    }

    useEffect(() => () => clearTimer(), [])

    const scen = SCENARIOS[selectedScenario]
    const etapaInfo = ETAPA_INFO[scen.etapa]
    const pct = totalCountdown > 0 ? ((totalCountdown - countdown) / totalCountdown) * 100 : 0

    return (
        <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
            {/* Header */}
            <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(0,126,198,0.1)', border: '1px solid rgba(0,126,198,0.2)' }}>
                    <FlaskConical className="w-5 h-5" style={{ color: '#007EC6' }} />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-white tracking-tight">Simulador de Envíos</h1>
                    <p className="text-slate-400 text-sm mt-0.5">
                        Crea datos de prueba reales y valida el pipeline completo de recordatorios → webhook
                    </p>
                </div>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-3 p-4 rounded-xl"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-300 space-y-1">
                    <p className="font-semibold">Datos reales — usar solo para pruebas</p>
                    <p>Esta herramienta inserta un cliente/deuda de prueba <strong>marcados como [DEMO]</strong> en tu base de datos real. Usa el botón "Limpiar" al finalizar.</p>
                    <p>La frecuencia de envío se fuerza a <strong>1 hora</strong> para facilitar las pruebas (en producción sería 48–72h según configuración).</p>
                </div>
            </div>

            {/* CRON SECRET input */}
            <div className="rounded-2xl p-5 space-y-4"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-2 mb-3">
                    <Terminal className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-semibold text-slate-300">Configuración</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <label className="text-xs text-slate-400 font-medium">CRON_SECRET <span className="text-red-400">*</span></label>
                        <input
                            type="password"
                            value={cronSecret}
                            onChange={e => setCronSecret(e.target.value)}
                            placeholder="Tu CRON_SECRET de .env.local"
                            className="w-full px-3 py-2 rounded-xl text-sm text-white font-mono outline-none focus:ring-1"
                            style={{
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(0,126,198,0.2)',
                            }}
                        />
                        {secretReady && (
                            <p className="text-xs text-emerald-400 flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" />Cargado automáticamente
                            </p>
                        )}
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs text-slate-400 font-medium">Auto-disparar cron</label>
                        <div className="flex items-center gap-2 mt-1">
                            <button
                                onClick={() => setAutoFire(!autoFire)}
                                className={cn(
                                    'relative w-11 h-6 rounded-full transition-all duration-200',
                                    autoFire ? 'bg-emerald-500' : 'bg-slate-600'
                                )}
                            >
                                <span className={cn(
                                    'absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-200 shadow',
                                    autoFire ? 'left-6' : 'left-1'
                                )} />
                            </button>
                            <span className="text-xs text-slate-400">
                                {autoFire ? 'Sí — dispara en 10s automáticamente' : 'No — disparo manual'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Scenario picker */}
            <div className="rounded-2xl p-5 space-y-4"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                    <Radio className="w-4 h-4" style={{ color: '#007EC6' }} />
                    Escenario de prueba
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {SCENARIOS.map((s, i) => {
                        const info = ETAPA_INFO[s.etapa]
                        const active = selectedScenario === i
                        return (
                            <button
                                key={i}
                                onClick={() => setSelectedScenario(i)}
                                disabled={phase === 'creando' || phase === 'disparando'}
                                className="rounded-xl p-3 text-left transition-all duration-150"
                                style={{
                                    background: active ? info.bg : 'rgba(255,255,255,0.03)',
                                    border: active
                                        ? `1px solid ${info.color}40`
                                        : '1px solid rgba(255,255,255,0.06)',
                                }}
                            >
                                <p className="text-xs font-bold" style={{ color: active ? info.color : '#94a3b8' }}>
                                    {info.icon} {s.label}
                                </p>
                                <p className="text-[10px] mt-1" style={{ color: active ? info.color + 'cc' : '#64748b' }}>
                                    {info.dias}
                                </p>
                            </button>
                        )
                    })}
                </div>
                {/* Scenario detail */}
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                    style={{ background: etapaInfo.bg, border: `1px solid ${etapaInfo.color}25` }}>
                    <div>
                        <p className="text-xs font-semibold" style={{ color: etapaInfo.color }}>{scen.desc}</p>
                        {scen.etapa === 'recuperacion' && (
                            <p className="text-[10px] mt-0.5" style={{ color: etapaInfo.color + 'aa' }}>
                                ⚡ En esta etapa también se envía a las referencias del cliente
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3">
                <Button
                    onClick={handleCrearSimulacion}
                    disabled={phase === 'creando' || phase === 'esperando' || phase === 'disparando' || !cronSecret}
                    className="gap-2 text-white font-semibold"
                    style={{ background: 'linear-gradient(135deg, #007EC6, #0096E8)', boxShadow: '0 4px 12px rgba(0,126,198,0.3)' }}
                >
                    {phase === 'creando' ? (
                        <><Loader2 className="w-4 h-4 animate-spin" />Creando datos...</>
                    ) : (
                        <><Play className="w-4 h-4" />Iniciar Simulación</>
                    )}
                </Button>

                {(phase === 'esperando' || simResult) && phase !== 'done' && (
                    <Button
                        onClick={() => handleDispararCron()}
                        disabled={phase === 'disparando'}
                        variant="outline"
                        className="gap-2 border-[#007EC6]/30 text-[#5bbfed] hover:bg-[#007EC6]/10"
                    >
                        {phase === 'disparando' ? (
                            <><Loader2 className="w-4 h-4 animate-spin" />Disparando...</>
                        ) : (
                            <><Send className="w-4 h-4" />Disparar Cron ahora</>
                        )}
                    </Button>
                )}

                {phase === 'done' && (
                    <Button
                        onClick={() => handleDispararCron()}
                        variant="outline"
                        className="gap-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                    >
                        <RefreshCw className="w-4 h-4" />Volver a disparar
                    </Button>
                )}

                {(simResult || phase !== 'idle') && (
                    <Button
                        onClick={handleLimpiar}
                        variant="outline"
                        className="gap-2 border-red-500/25 text-red-400 hover:bg-red-500/10"
                    >
                        <Trash2 className="w-4 h-4" />Limpiar datos
                    </Button>
                )}
            </div>

            {/* Countdown bar */}
            {phase === 'esperando' && countdown > 0 && (
                <div className="rounded-2xl p-4 space-y-2"
                    style={{ background: 'rgba(0,126,198,0.08)', border: '1px solid rgba(0,126,198,0.2)' }}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#5bbfed' }}>
                            <Clock className="w-4 h-4" />
                            Auto-disparo en {countdown} segundo{countdown !== 1 ? 's' : ''}...
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => { clearTimer(); setPhase('idle'); addLog('warn', 'Auto-disparo cancelado.') }}
                            className="text-slate-400 hover:text-white text-xs h-7">
                            Cancelar
                        </Button>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden bg-white/5">
                        <div className="h-full rounded-full transition-all duration-1000"
                            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #007EC6, #0096E8)' }} />
                    </div>
                </div>
            )}

            {/* Sim result card */}
            {simResult?.simulacion && (
                <div className="rounded-2xl p-5 space-y-3"
                    style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)' }}>
                    <p className="text-sm font-bold text-emerald-300 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" />Datos de simulación creados
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        {[
                            { label: 'Cliente', value: simResult.simulacion.cliente },
                            { label: 'Etapa', value: simResult.simulacion.etapa.replace('_', ' ').toUpperCase() },
                            { label: 'Días de atraso', value: `${simResult.simulacion.dias_atraso} días` },
                            { label: 'Monto original', value: `RD$${simResult.simulacion.monto_original.toLocaleString('es-DO')}` },
                            { label: 'Saldo pendiente', value: `RD$${simResult.simulacion.saldo_pendiente.toLocaleString('es-DO')}` },
                            { label: 'Freq. envío (test)', value: `${simResult.simulacion.frecuencia_envio_h}h` },
                        ].map(item => (
                            <div key={item.label} className="space-y-0.5">
                                <p className="text-slate-500">{item.label}</p>
                                <p className="text-white font-semibold">{item.value}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Cron result card */}
            {cronResult && (
                <div className="rounded-2xl p-5 space-y-3"
                    style={{
                        background: cronResult.ok ? 'rgba(0,126,198,0.06)' : 'rgba(239,68,68,0.06)',
                        border: `1px solid ${cronResult.ok ? 'rgba(0,126,198,0.2)' : 'rgba(239,68,68,0.2)'}`,
                    }}>
                    <p className="text-sm font-bold flex items-center gap-2"
                        style={{ color: cronResult.ok ? '#5bbfed' : '#fca5a5' }}>
                        {cronResult.ok ? <><Zap className="w-4 h-4" />Cron ejecutado correctamente</> : <><XCircle className="w-4 h-4" />Error en el cron</>}
                    </p>
                    {cronResult.ok && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            {[
                                { label: 'Procesadas', value: cronResult.procesadas ?? 0, color: '#94a3b8' },
                                { label: 'Enviadas', value: cronResult.enviados ?? 0, color: (cronResult.enviados ?? 0) > 0 ? '#6ee7b7' : '#94a3b8' },
                                { label: 'Omitidas', value: cronResult.omitidos ?? 0, color: (cronResult.omitidos ?? 0) > 0 ? '#fcd34d' : '#94a3b8' },
                                { label: 'Errores', value: cronResult.errores ?? 0, color: (cronResult.errores ?? 0) > 0 ? '#fca5a5' : '#94a3b8' },
                            ].map(item => (
                                <div key={item.label} className="rounded-xl p-3 text-center"
                                    style={{ background: 'rgba(255,255,255,0.03)' }}>
                                    <p className="text-xl font-bold" style={{ color: item.color }}>{item.value}</p>
                                    <p className="text-slate-500 mt-0.5">{item.label}</p>
                                </div>
                            ))}
                        </div>
                    )}
                    {(cronResult.omitidos ?? 0) > 0 && (cronResult.enviados ?? 0) === 0 && (
                        <div className="text-xs text-amber-300 flex items-start gap-2 p-3 rounded-xl"
                            style={{ background: 'rgba(245,158,11,0.08)' }}>
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>Anti-duplicado activo: el sistema ya envió recientemente a este cliente. Espera el intervalo mínimo de 1 hora y vuelve a disparar el cron.</span>
                        </div>
                    )}
                    {cronResult.error && <p className="text-xs text-red-400">{cronResult.error}</p>}
                </div>
            )}

            {/* Console logs */}
            {logs.length > 0 && (
                <div className="rounded-2xl overflow-hidden"
                    style={{ background: '#060e1a', border: '1px solid rgba(0,126,198,0.15)' }}>
                    <div className="px-4 py-2 border-b flex items-center gap-2"
                        style={{ borderColor: 'rgba(0,126,198,0.1)', background: 'rgba(0,126,198,0.05)' }}>
                        <Terminal className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-xs font-mono text-slate-400">Console — Pipeline de simulación</span>
                        <button onClick={() => setLogs([])}
                            className="ml-auto text-xs text-slate-600 hover:text-slate-400 transition-colors">Clear</button>
                    </div>
                    <div className="p-4 space-y-1 max-h-64 overflow-y-auto font-mono text-xs">
                        {logs.map((l, i) => (
                            <div key={i} className="flex items-start gap-2">
                                <span className="text-slate-600 shrink-0">[{l.time}]</span>
                                <span className={cn(
                                    l.type === 'success' && 'text-emerald-300',
                                    l.type === 'error' && 'text-red-400',
                                    l.type === 'warn' && 'text-amber-300',
                                    l.type === 'cron' && 'text-[#5bbfed]',
                                    l.type === 'info' && 'text-slate-400',
                                )}>
                                    <ChevronRight className="w-3 h-3 inline mr-0.5 -mt-0.5" />
                                    {l.msg}
                                </span>
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </div>
            )}

            {/* Guide */}
            <div className="rounded-2xl p-5 space-y-4"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide flex items-center gap-2">
                    <TrendingUp className="w-3.5 h-3.5" />Cómo funciona el pipeline en producción
                </p>
                <div className="space-y-2">
                    {[
                        { step: '1', title: 'Cron local (node-cron)', desc: 'server.js contiene un scheduler configurado con CRON_SCHEDULE en .env.local. Predeterminado: 8 AM y 6 PM hora RD.' },
                        { step: '2', title: 'Actualizar días de atraso', desc: 'El cron ejecuta la función SQL actualizar_dias_atraso() para recalcular etapas automáticamente.' },
                        { step: '3', title: 'Anti-duplicado', desc: 'Verifica el último envío: preventivo=7d, mora_temprana/mora_alta=48h (configurable), recuperacion=72h.' },
                        { step: '4', title: 'Renderizar plantilla', desc: 'Busca plantilla activa para la etapa, reemplaza variables {{nombre}}, {{saldo}}, etc.' },
                        { step: '5', title: 'POST al Webhook', desc: 'Envía el payload JSON completo a n8n/WhatsApp/tu sistema. Registra en envios_log.' },
                        { step: '6', title: 'Referencias (mora_alta+)', desc: 'Si la deuda está en mora alta o recuperación, también envía a las referencias del cliente.' },
                    ].map(item => (
                        <div key={item.step} className="flex items-start gap-3">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                                style={{ background: 'rgba(0,126,198,0.15)', color: '#007EC6' }}>
                                {item.step}
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-300">{item.title}</p>
                                <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
