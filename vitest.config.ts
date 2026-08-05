import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
    test: {
        environment: 'node',
        // `app/` entra desde que hay pruebas del cron de recordatorios: el
        // truncamiento silencioso de PostgREST que hacía que se mandaran
        // recordatorios a quien ya había pagado sólo se puede atrapar
        // ejercitando el `GET` de la ruta, y una ruta de Next no puede
        // exportar nada más que sus manejadores.
        include: [
            'lib/**/*.test.ts', 'lib/**/*.test.tsx',
            'app/**/*.test.ts', 'app/**/*.test.tsx',
        ],
    },
    resolve: {
        alias: { '@': path.resolve(__dirname, '.') },
    },
})
