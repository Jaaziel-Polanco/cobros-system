import { timingSafeEqual } from 'crypto'

/**
 * Compara el CRON_SECRET de forma segura contra timing attacks.
 * Retorna false si el secreto no está configurado o no coincide.
 */
export function verificarCronSecret(headerSecret: string | null): boolean {
    const expected = process.env.CRON_SECRET
    if (!expected || !headerSecret) return false

    try {
        const a = Buffer.from(headerSecret, 'utf-8')
        const b = Buffer.from(expected, 'utf-8')
        if (a.length !== b.length) return false
        return timingSafeEqual(a, b)
    } catch {
        return false
    }
}
