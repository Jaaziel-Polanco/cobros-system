'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { TrendingUp, Lock, Eye, EyeOff, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'

/**
 * /set-password
 *
 * Página a la que llegan los usuarios:
 * 1. Tras aceptar una invitación (type=invite)
 * 2. Tras solicitar un reset de contraseña (type=recovery)
 *
 * La sesión ya está establecida por /auth/callback.
 * Solo necesitamos pedir la nueva contraseña.
 */
export default function SetPasswordPage() {
    const router = useRouter()
    const [password, setPassword] = useState('')
    const [confirm, setConfirm] = useState('')
    const [showPwd, setShowPwd] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const [loading, setLoading] = useState(false)
    const [sessionReady, setSessionReady] = useState(false)
    const [userName, setUserName] = useState<string>('')

    // ── Verificar sesión (puede venir de hash en URL para el invite flow antiguo)
    useEffect(() => {
        const supabase = createClient()

        const checkSession = async () => {
            // Primero intentar sesión existente (después del callback PKCE)
            const { data: { session } } = await supabase.auth.getSession()

            if (session) {
                setSessionReady(true)
                const name = session.user.user_metadata?.full_name ?? session.user.email?.split('@')[0] ?? ''
                setUserName(name)
                return
            }

            // Fallback: leer tokens del hash (flujo antiguo de invite con #access_token)
            const hash = window.location.hash
            if (hash && hash.includes('access_token')) {
                const params = new URLSearchParams(hash.substring(1))
                const accessToken = params.get('access_token')
                const refreshToken = params.get('refresh_token')
                const type = params.get('type')

                if ((type === 'invite' || type === 'recovery') && accessToken && refreshToken) {
                    const { data, error } = await supabase.auth.setSession({
                        access_token: accessToken,
                        refresh_token: refreshToken,
                    })

                    if (error) {
                        toast.error('El enlace de invitación expiró o ya fue usado. Pide una nueva invitación.')
                        router.push('/login')
                        return
                    }

                    setSessionReady(true)
                    const name = data.session?.user.user_metadata?.full_name ?? ''
                    setUserName(name)
                    // Limpiar el hash de la URL sin recargar
                    window.history.replaceState(null, '', window.location.pathname)
                    return
                }
            }

            // Sin sesión ni hash válido → al login
            toast.error('Enlace inválido o expirado. Solicita una nueva invitación.')
            router.push('/login')
        }

        checkSession()
    }, [router])

    // ── Validaciones de contraseña
    const validations = {
        minLen: password.length >= 8,
        hasUpper: /[A-Z]/.test(password),
        hasNum: /[0-9]/.test(password),
        matches: password === confirm && confirm.length > 0,
    }
    const allValid = Object.values(validations).every(Boolean)

    // ── Submit
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!allValid) return

        setLoading(true)
        try {
            const supabase = createClient()
            const { error } = await supabase.auth.updateUser({ password })
            if (error) throw error

            toast.success('¡Contraseña configurada! Bienvenido al sistema.')
            router.push('/dashboard')
            router.refresh()
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : 'Error al configurar contraseña')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #061020 0%, #0a1628 40%, #0c2040 70%, #051018 100%)' }}>

            {/* Background blobs */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-32 -right-32 w-125 h-125 rounded-full opacity-20 blur-3xl"
                    style={{ background: 'radial-gradient(circle, #007EC6, transparent)' }} />
                <div className="absolute -bottom-32 -left-32 w-125 h-125 rounded-full opacity-15 blur-3xl"
                    style={{ background: 'radial-gradient(circle, #0096E8, transparent)' }} />
                <div className="absolute inset-0 opacity-5"
                    style={{
                        backgroundImage: 'linear-gradient(rgba(0,126,198,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(0,126,198,0.5) 1px, transparent 1px)',
                        backgroundSize: '64px 64px',
                    }} />
            </div>

            <div className="relative w-full max-w-md px-6 sm:px-0">
                {/* Brand */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-5 shadow-2xl"
                        style={{
                            background: 'linear-gradient(135deg, #007EC6 0%, #0096E8 60%, #005f96 100%)',
                            boxShadow: '0 0 40px rgba(0,126,198,0.5), 0 20px 40px rgba(0,0,0,0.3)',
                        }}>
                        <TrendingUp className="w-10 h-10 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Inversiones Cordero</h1>
                    <p className="mt-2 text-sm font-medium tracking-widest uppercase" style={{ color: '#5bbfed' }}>
                        Plataforma de Gestión de Cobranza
                    </p>
                </div>

                {/* Card */}
                <div className="rounded-2xl p-8 shadow-2xl"
                    style={{
                        background: 'rgba(12,29,56,0.85)',
                        backdropFilter: 'blur(20px)',
                        border: '1px solid rgba(0,126,198,0.2)',
                        boxShadow: '0 0 0 1px rgba(0,126,198,0.1), 0 32px 64px rgba(0,0,0,0.4)',
                    }}>

                    {!sessionReady ? (
                        /* Loading state */
                        <div className="flex flex-col items-center gap-4 py-8">
                            <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#007EC6' }} />
                            <p className="text-slate-400 text-sm">Verificando enlace de invitación...</p>
                        </div>
                    ) : (
                        <>
                            <div className="mb-6">
                                <div className="flex items-center gap-2 mb-1">
                                    <ShieldCheck className="w-5 h-5" style={{ color: '#007EC6' }} />
                                    <h2 className="text-xl font-bold text-white">Configura tu contraseña</h2>
                                </div>
                                {userName && (
                                    <p className="text-sm text-slate-400 mt-1">
                                        Bienvenido, <strong className="text-white">{userName}</strong>. Establece una contraseña segura para acceder al sistema.
                                    </p>
                                )}
                                {!userName && (
                                    <p className="text-sm text-slate-400 mt-1">
                                        Establece una contraseña segura para acceder al sistema.
                                    </p>
                                )}
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-5">
                                {/* Password */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="password" className="text-slate-300 text-sm font-medium flex items-center gap-1.5">
                                        <Lock className="w-3.5 h-3.5" style={{ color: '#007EC6' }} />
                                        Nueva contraseña
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            id="password"
                                            type={showPwd ? 'text' : 'password'}
                                            placeholder="Mínimo 8 caracteres"
                                            value={password}
                                            onChange={e => setPassword(e.target.value)}
                                            autoComplete="new-password"
                                            className="text-white placeholder:text-slate-500 h-11 pr-10"
                                            style={{
                                                background: 'rgba(255,255,255,0.05)',
                                                border: '1px solid rgba(0,126,198,0.2)',
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPwd(!showPwd)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                        >
                                            {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>

                                {/* Confirm */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="confirm" className="text-slate-300 text-sm font-medium flex items-center gap-1.5">
                                        <Lock className="w-3.5 h-3.5" style={{ color: '#007EC6' }} />
                                        Confirmar contraseña
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            id="confirm"
                                            type={showConfirm ? 'text' : 'password'}
                                            placeholder="Repite la contraseña"
                                            value={confirm}
                                            onChange={e => setConfirm(e.target.value)}
                                            autoComplete="new-password"
                                            className="text-white placeholder:text-slate-500 h-11 pr-10"
                                            style={{
                                                background: 'rgba(255,255,255,0.05)',
                                                border: confirm.length > 0
                                                    ? validations.matches
                                                        ? '1px solid rgba(16,185,129,0.4)'
                                                        : '1px solid rgba(239,68,68,0.4)'
                                                    : '1px solid rgba(0,126,198,0.2)',
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowConfirm(!showConfirm)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                        >
                                            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>

                                {/* Validation checklist */}
                                {password.length > 0 && (
                                    <div className="grid grid-cols-2 gap-1.5 text-xs p-3 rounded-xl"
                                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                        {[
                                            { ok: validations.minLen, label: 'Mínimo 8 caracteres' },
                                            { ok: validations.hasUpper, label: 'Una mayúscula' },
                                            { ok: validations.hasNum, label: 'Un número' },
                                            { ok: validations.matches, label: 'Contraseñas coinciden' },
                                        ].map(({ ok, label }) => (
                                            <div key={label} className="flex items-center gap-1.5">
                                                <CheckCircle2
                                                    className="w-3.5 h-3.5 shrink-0 transition-colors"
                                                    style={{ color: ok ? '#10b981' : '#475569' }}
                                                />
                                                <span style={{ color: ok ? '#6ee7b7' : '#475569' }}>{label}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <Button
                                    type="submit"
                                    disabled={loading || !allValid}
                                    className="w-full text-white border-0 h-12 font-bold text-sm tracking-wide transition-all duration-200 shadow-lg mt-2"
                                    style={{
                                        background: allValid
                                            ? 'linear-gradient(135deg, #007EC6 0%, #0096E8 50%, #005f96 100%)'
                                            : 'rgba(0,126,198,0.3)',
                                        boxShadow: allValid ? '0 8px 24px rgba(0,126,198,0.35)' : 'none',
                                    }}
                                >
                                    {loading ? (
                                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Configurando...</>
                                    ) : (
                                        'Establecer contraseña →'
                                    )}
                                </Button>
                            </form>
                        </>
                    )}
                </div>

                <p className="text-center text-xs text-slate-600 mt-6">
                    © {new Date().getFullYear()} Inversiones Cordero. Todos los derechos reservados.
                </p>
            </div>
        </div>
    )
}
