import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/simulate/secret
 * Returns the CRON_SECRET to authenticated admin users only,
 * so the simulator page can auto-fill the field.
 */
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        // Only admins
        const { data: profile } = await supabase
            .from('profiles')
            .select('rol')
            .eq('id', user.id)
            .single()

        if (profile?.rol !== 'admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const secret = process.env.CRON_SECRET
        if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })

        return NextResponse.json({ secret })
    } catch {
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
