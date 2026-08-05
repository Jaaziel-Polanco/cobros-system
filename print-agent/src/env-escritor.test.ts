import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
    aplicarCambiosEnv, enmascararToken, escribirEnv, leerEnv, validarCambios,
} from './env-escritor'

/** El `.env` real del agente, comentarios incluidos: es lo que hay que conservar. */
const ENV_REAL = `# URL del servidor de cobros, alcanzable desde esta PC
API_URL=http://192.168.1.50:3000

# Token de la estación. Se obtiene en Estaciones -> crear estación.
# Solo se muestra una vez; si se pierde hay que regenerarlo.
ESTACION_TOKEN=token-viejo-de-la-estacion

# Espera del long-poll. Ponlo en 0 si un proxy corta las conexiones largas:
# el agente pasará a sondear cada 3 segundos.
POLL_ESPERA_MS=25000

# debug | info | warn | error
LOG_LEVEL=info

# Modo de desarrollo, sin impresora real. NUNCA se activa en una sucursal.
MODO_SIMULADOR=
`

describe('aplicarCambiosEnv — los comentarios son la documentación de quien instala', () => {
    it('conserva TODOS los comentarios y las líneas en blanco al cambiar un valor', () => {
        const salida = aplicarCambiosEnv(ENV_REAL, { API_URL: 'http://10.0.0.9:3000' })

        for (const comentario of [
            '# URL del servidor de cobros, alcanzable desde esta PC',
            '# Token de la estación. Se obtiene en Estaciones -> crear estación.',
            '# Solo se muestra una vez; si se pierde hay que regenerarlo.',
            '# Espera del long-poll. Ponlo en 0 si un proxy corta las conexiones largas:',
            '# el agente pasará a sondear cada 3 segundos.',
            '# debug | info | warn | error',
            '# Modo de desarrollo, sin impresora real. NUNCA se activa en una sucursal.',
        ]) {
            expect(salida).toContain(comentario)
        }

        // Y el número de líneas no cambia: no se ha añadido ni quitado nada.
        expect(salida.split('\n')).toHaveLength(ENV_REAL.split('\n').length)
        expect(salida).toContain('API_URL=http://10.0.0.9:3000')
        expect(salida).not.toContain('http://192.168.1.50:3000')
    })

    it('no toca las claves que no se están cambiando', () => {
        const salida = aplicarCambiosEnv(ENV_REAL, { LOG_LEVEL: 'debug' })
        const valores = { ...leerEnvDeTexto(salida) }

        expect(valores.LOG_LEVEL).toBe('debug')
        expect(valores.API_URL).toBe('http://192.168.1.50:3000')
        expect(valores.ESTACION_TOKEN).toBe('token-viejo-de-la-estacion')
        expect(valores.POLL_ESPERA_MS).toBe('25000')
    })

    it('permite dejar un valor vacío (quitar el simulador)', () => {
        const conSimulador = ENV_REAL.replace('MODO_SIMULADOR=', 'MODO_SIMULADOR=archivo')
        const salida = aplicarCambiosEnv(conSimulador, { MODO_SIMULADOR: '' })
        expect(leerEnvDeTexto(salida).MODO_SIMULADOR).toBe('')
    })

    it('NO descomenta una línea comentada: un ejemplo no es configuración', () => {
        const conEjemplo = '# API_URL=http://ejemplo-que-no-vale:3000\nAPI_URL=http://real:3000\n'
        const salida = aplicarCambiosEnv(conEjemplo, { API_URL: 'http://nuevo:3000' })

        expect(salida).toContain('# API_URL=http://ejemplo-que-no-vale:3000')
        expect(salida).toContain('API_URL=http://nuevo:3000')
    })

    it('añade al final, con un comentario, una clave que no estaba', () => {
        const salida = aplicarCambiosEnv('API_URL=http://x:3000\n', { LOG_LEVEL: 'warn' })

        expect(salida).toContain('# Añadido por la interfaz local del agente.')
        expect(salida).toContain('LOG_LEVEL=warn')
        expect(leerEnvDeTexto(salida).API_URL).toBe('http://x:3000')
    })

    it('actualiza TODAS las apariciones de una clave repetida', () => {
        // El lector se queda con la primera; dejar la segunda con el valor
        // viejo es una trampa para quien borre la primera más adelante.
        const duplicado = 'LOG_LEVEL=info\n# otra cosa\nLOG_LEVEL=error\n'
        const salida = aplicarCambiosEnv(duplicado, { LOG_LEVEL: 'debug' })

        expect(salida.match(/LOG_LEVEL=debug/g)).toHaveLength(2)
        expect(salida).not.toContain('LOG_LEVEL=error')
    })

    it('respeta los saltos de línea de Windows si el archivo ya los usaba', () => {
        const crlf = '# comentario\r\nAPI_URL=http://x:3000\r\n'
        const salida = aplicarCambiosEnv(crlf, { API_URL: 'http://y:3000' })

        expect(salida).toBe('# comentario\r\nAPI_URL=http://y:3000\r\n')
        expect(salida).not.toMatch(/[^\r]\n/)
    })

    it('no inventa un salto de línea final si el archivo no lo tenía', () => {
        expect(aplicarCambiosEnv('API_URL=http://x:3000', { API_URL: 'http://y:3000' }))
            .toBe('API_URL=http://y:3000')
    })
})

describe('enmascararToken', () => {
    it('enseña lo justo para reconocerlo, nunca entero', () => {
        const token = '8V-fNrvd-06Va0yV1tZvf-zvgJLqEdTd'
        const tapado = enmascararToken(token)

        expect(tapado).not.toContain(token)
        expect(tapado).toContain('8V-f')
        expect(tapado).toContain('EdTd')
        // Del medio no puede quedar ni un trozo reconocible.
        expect(tapado).not.toContain('06Va0yV1tZvf')
        expect(tapado).toBe('8V-f••••••••EdTd')
    })

    it('con un token corto no enseña NADA: 4 y 4 de 10 caracteres es enseñarlo casi entero', () => {
        expect(enmascararToken('abcdefghij')).toBe('••••••••')
        expect(enmascararToken('abcdefghij')).not.toContain('abcd')
    })

    it('dice que no hay token en vez de enseñar comillas vacías', () => {
        expect(enmascararToken('')).toBe('(sin token)')
        expect(enmascararToken(null)).toBe('(sin token)')
        expect(enmascararToken(undefined)).toBe('(sin token)')
    })
})

describe('validarCambios', () => {
    it('rechaza un salto de línea, que partiría el .env en dos', () => {
        const errores = validarCambios({ ESTACION_TOKEN: 'abc\nLOG_LEVEL=debug' })
        expect(errores).toHaveLength(1)
        expect(errores[0].mensaje).toMatch(/saltos de línea/)
    })

    it('exige que API_URL parezca una dirección', () => {
        expect(validarCambios({ API_URL: '192.168.1.50' })).toHaveLength(1)
        expect(validarCambios({ API_URL: 'http://192.168.1.50:3000' })).toHaveLength(0)
        expect(validarCambios({ API_URL: 'https://cobros.ejemplo.do' })).toHaveLength(0)
    })

    it('rechaza valores que harían que el agente no arranque', () => {
        expect(validarCambios({ LOG_LEVEL: 'todo' })).toHaveLength(1)
        expect(validarCambios({ MODO_SIMULADOR: 'si' })).toHaveLength(1)
        expect(validarCambios({ POLL_ESPERA_MS: 'mucho' })).toHaveLength(1)
        expect(validarCambios({ POLL_ESPERA_MS: '999999' })).toHaveLength(1)

        expect(validarCambios({
            LOG_LEVEL: 'debug', MODO_SIMULADOR: '', POLL_ESPERA_MS: '0',
        })).toHaveLength(0)
    })

    it('avisa de un token pegado a medias en vez de guardarlo', () => {
        expect(validarCambios({ ESTACION_TOKEN: 'corto' })).toHaveLength(1)
        expect(validarCambios({ ESTACION_TOKEN: 'con espacio dentro y largo' })).toHaveLength(1)
        expect(validarCambios({ ESTACION_TOKEN: '8V-fNrvd-06Va0yV1tZvf-zvgJLqEdTd' })).toHaveLength(0)
    })
})

describe('escribirEnv', () => {
    let carpeta: string
    let ruta: string

    beforeEach(() => {
        carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-env-'))
        ruta = path.join(carpeta, '.env')
        fs.writeFileSync(ruta, ENV_REAL, 'utf8')
    })
    afterEach(() => { fs.rmSync(carpeta, { recursive: true, force: true }) })

    it('escribe el archivo conservando los comentarios y lo deja legible por leerEnv', () => {
        escribirEnv(ruta, { API_URL: 'http://10.0.0.9:3000', LOG_LEVEL: 'debug' })

        const contenido = fs.readFileSync(ruta, 'utf8')
        expect(contenido).toContain('# debug | info | warn | error')
        expect(contenido).toContain('# Solo se muestra una vez; si se pierde hay que regenerarlo.')

        const valores = leerEnv(ruta)
        expect(valores.API_URL).toBe('http://10.0.0.9:3000')
        expect(valores.LOG_LEVEL).toBe('debug')
        expect(valores.ESTACION_TOKEN).toBe('token-viejo-de-la-estacion')
    })

    it('deja una copia del archivo anterior por si algo saliera mal', () => {
        escribirEnv(ruta, { LOG_LEVEL: 'warn' })
        expect(fs.readFileSync(`${ruta}.bak`, 'utf8')).toBe(ENV_REAL)
    })

    it('no deja el temporal a medio camino tirado en la carpeta', () => {
        escribirEnv(ruta, { LOG_LEVEL: 'warn' })
        expect(fs.existsSync(`${ruta}.tmp`)).toBe(false)
    })

    it('crea el archivo si no existía', () => {
        const nuevo = path.join(carpeta, 'otro.env')
        escribirEnv(nuevo, { API_URL: 'http://x:3000' })
        expect(leerEnv(nuevo).API_URL).toBe('http://x:3000')
    })
})

/** Aplica al texto las mismas reglas que `leerEnv`, sin pasar por disco. */
function leerEnvDeTexto(texto: string): Record<string, string> {
    const valores: Record<string, string> = {}
    for (const linea of texto.split('\n')) {
        const limpia = linea.trim()
        if (!limpia || limpia.startsWith('#')) continue
        const i = limpia.indexOf('=')
        if (i === -1) continue
        const clave = limpia.slice(0, i).trim()
        if (!(clave in valores)) valores[clave] = limpia.slice(i + 1).trim()
    }
    return valores
}
