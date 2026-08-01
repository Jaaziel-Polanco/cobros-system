import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import {
    DIRECCION_LOCAL, esHostLocal, esOrigenLocal, iniciarUi, mutacionPermitida,
    pendienteDeReinicio,
} from './ui-servidor'
import { reiniciarEstado } from './estado'
import type { Config } from './config'

const ENV_BASE = `# La dirección del servidor
API_URL=http://localhost:3000

# El token, que solo se ve una vez
ESTACION_TOKEN=8V-fNrvd-06Va0yV1tZvf-zvgJLqEdTd

# debug | info | warn | error
LOG_LEVEL=info

POLL_ESPERA_MS=25000
MODO_SIMULADOR=
`

function configDePrueba(uiPuerto: number): Config {
    return {
        apiUrl: 'http://localhost:3000',
        token: '8V-fNrvd-06Va0yV1tZvf-zvgJLqEdTd',
        pollEsperaMs: 25_000,
        logLevel: 'info',
        modoSimulador: '',
        uiPuerto,
    }
}

/** Petición HTTP escrita byte a byte, para poder mentir en la cabecera Host. */
function peticionCruda(puerto: number, host: string): Promise<string> {
    return new Promise((resolver, rechazar) => {
        const s = net.createConnection({ host: '127.0.0.1', port: puerto, timeout: 3_000 })
        let recibido = ''
        s.on('connect', () => {
            s.write(`GET /api/estado HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
        })
        s.on('data', d => { recibido += d.toString() })
        s.on('close', () => resolver(recibido))
        s.on('timeout', () => { s.destroy(); rechazar(new Error('timeout')) })
        s.on('error', rechazar)
    })
}

/** Un puerto que ahora mismo está libre, para no chocar con nada. */
function puertoLibre(): Promise<number> {
    return new Promise(resolver => {
        const s = net.createServer()
        s.listen(0, DIRECCION_LOCAL, () => {
            const p = (s.address() as net.AddressInfo).port
            s.close(() => resolver(p))
        })
    })
}

let carpeta: string
let rutaEnv: string
const abiertos: (Server | net.Server | null)[] = []

beforeEach(() => {
    reiniciarEstado()
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-ui-'))
    rutaEnv = path.join(carpeta, '.env')
    fs.writeFileSync(rutaEnv, ENV_BASE, 'utf8')
})

afterEach(async () => {
    for (const s of abiertos.splice(0)) {
        if (s) await new Promise<void>(r => s.close(() => r()))
    }
    fs.rmSync(carpeta, { recursive: true, force: true })
})

async function levantar(cfg: Config): Promise<Server> {
    const servidor = await iniciarUi({ cfg, rutaEnv })
    abiertos.push(servidor)
    if (!servidor) throw new Error('la interfaz no levantó')
    return servidor
}

describe('la interfaz NUNCA se asoma fuera de esta PC', () => {
    it('escucha en 127.0.0.1, no en 0.0.0.0', async () => {
        const cfg = configDePrueba(await puertoLibre())
        const servidor = await levantar(cfg)

        const dir = servidor.address() as net.AddressInfo
        expect(dir.address).toBe('127.0.0.1')
        expect(dir.address).not.toBe('0.0.0.0')
        expect(dir.address).not.toBe('::')
    })

    it('no acepta conexiones por la IP de la red de la tienda', async () => {
        const cfg = configDePrueba(await puertoLibre())
        await levantar(cfg)

        // La IP con la que esta PC se ve desde el resto de la tienda. Si no
        // hay ninguna (una máquina de compilación sin red), no hay nada que
        // comprobar y la prueba de arriba ya cubre la intención.
        const ipLan = Object.values(os.networkInterfaces())
            .flat()
            .find(i => i && i.family === 'IPv4' && !i.internal)?.address

        if (!ipLan) return

        const alcanzable = await new Promise<boolean>(resolver => {
            const s = net.createConnection({ host: ipLan, port: cfg.uiPuerto, timeout: 1_200 })
            s.on('connect', () => { s.destroy(); resolver(true) })
            s.on('error', () => { s.destroy(); resolver(false) })
            s.on('timeout', () => { s.destroy(); resolver(false) })
        })

        expect(alcanzable).toBe(false)
    })

    it('rechaza una petición cuyo Host no es localhost (rebinding de DNS)', async () => {
        const cfg = configDePrueba(await puertoLibre())
        await levantar(cfg)

        // Con `fetch` no vale: `Host` es una cabecera prohibida y el
        // navegador (y undici) la reescriben. Hay que hablar HTTP a mano,
        // que es exactamente lo que haría quien intente esto de verdad.
        const respuesta = await peticionCruda(cfg.uiPuerto, 'pagina-maliciosa.example')
        expect(respuesta).toContain('403')

        // Y con el Host correcto, la misma petición sí pasa.
        expect(await peticionCruda(cfg.uiPuerto, `127.0.0.1:${cfg.uiPuerto}`)).toContain('200')
    })

    it('reconoce solo las direcciones de bucle como locales', () => {
        expect(esOrigenLocal('127.0.0.1')).toBe(true)
        expect(esOrigenLocal('::1')).toBe(true)
        expect(esOrigenLocal('::ffff:127.0.0.1')).toBe(true)
        expect(esOrigenLocal('192.168.1.44')).toBe(false)
        expect(esOrigenLocal('10.0.0.1')).toBe(false)
        expect(esOrigenLocal(undefined)).toBe(false)
    })

    it('reconoce solo localhost en la cabecera Host', () => {
        expect(esHostLocal('127.0.0.1:9110')).toBe(true)
        expect(esHostLocal('localhost:9110')).toBe(true)
        expect(esHostLocal('[::1]:9110')).toBe(true)
        expect(esHostLocal('caja1.tienda.local:9110')).toBe(false)
        expect(esHostLocal('127.0.0.1.evil.com:9110')).toBe(false)
        expect(esHostLocal(undefined)).toBe(false)
    })

    it('no deja que una página de fuera mande un formulario a este puerto', () => {
        // Un <form> solo puede enviar estos tres tipos, ninguno es JSON.
        expect(mutacionPermitida('application/x-www-form-urlencoded', undefined, 9110)).toBe(false)
        expect(mutacionPermitida('multipart/form-data', undefined, 9110)).toBe(false)
        expect(mutacionPermitida('text/plain', undefined, 9110)).toBe(false)

        expect(mutacionPermitida('application/json', undefined, 9110)).toBe(true)
        expect(mutacionPermitida('application/json; charset=utf-8', 'http://127.0.0.1:9110', 9110)).toBe(true)
        expect(mutacionPermitida('application/json', 'http://pagina-maliciosa.example', 9110)).toBe(false)
    })

    it('rechaza un POST que no venga como JSON', async () => {
        const cfg = configDePrueba(await puertoLibre())
        await levantar(cfg)

        const r = await fetch(`http://127.0.0.1:${cfg.uiPuerto}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'LOG_LEVEL=debug',
        })
        expect(r.status).toBe(403)
        expect(fs.readFileSync(rutaEnv, 'utf8')).toContain('LOG_LEVEL=info')
    })
})

describe('que la interfaz no arranque NO puede dejar la tienda sin imprimir', () => {
    it('devuelve null en vez de lanzar cuando el puerto está ocupado', async () => {
        const puerto = await puertoLibre()

        const okupa = net.createServer()
        abiertos.push(okupa)
        await new Promise<void>(r => okupa.listen(puerto, DIRECCION_LOCAL, () => r()))

        // Ni lanza, ni rechaza la promesa, ni tumba el proceso.
        const servidor = await iniciarUi({ cfg: configDePrueba(puerto), rutaEnv })
        expect(servidor).toBeNull()
    })

    it('con UI_PUERTO=0 no levanta nada y no se queja', async () => {
        expect(await iniciarUi({ cfg: configDePrueba(0), rutaEnv })).toBeNull()
    })

    it('un .env ilegible no impide que la página conteste', async () => {
        const cfg = configDePrueba(await puertoLibre())
        await levantar(cfg)
        fs.rmSync(rutaEnv)

        const r = await fetch(`http://127.0.0.1:${cfg.uiPuerto}/api/estado`)
        expect(r.status).toBe(200)
        expect((await r.json()).version).toBeTruthy()
    })
})

describe('el token no se puede leer desde la interfaz', () => {
    it('/api/estado enseña el token tapado y nunca el entero', async () => {
        const cfg = configDePrueba(await puertoLibre())
        await levantar(cfg)

        const r = await fetch(`http://127.0.0.1:${cfg.uiPuerto}/api/estado`)
        const texto = await r.text()

        expect(texto).not.toContain(cfg.token)
        expect(JSON.parse(texto).enEjecucion.ESTACION_TOKEN_TAPADO).toBe('8V-f••••••••EdTd')
    })

    it('la página en sí no lleva el token incrustado', async () => {
        const cfg = configDePrueba(await puertoLibre())
        await levantar(cfg)

        const html = await (await fetch(`http://127.0.0.1:${cfg.uiPuerto}/`)).text()
        expect(html).not.toContain(cfg.token)
        expect(html).toContain('Agente de impresión de boletos')
    })
})

describe('guardar la configuración', () => {
    it('escribe el .env sin tocar los comentarios y dice qué necesita reinicio', async () => {
        const cfg = configDePrueba(await puertoLibre())
        await levantar(cfg)

        const r = await fetch(`http://127.0.0.1:${cfg.uiPuerto}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ API_URL: 'http://10.0.0.9:3000', LOG_LEVEL: 'debug' }),
        })

        expect(r.status).toBe(200)
        const cuerpo = await r.json()
        expect(cuerpo.necesitanReinicio).toEqual(['la dirección del servidor'])

        const contenido = fs.readFileSync(rutaEnv, 'utf8')
        expect(contenido).toContain('# La dirección del servidor')
        expect(contenido).toContain('# El token, que solo se ve una vez')
        expect(contenido).toContain('API_URL=http://10.0.0.9:3000')
        // LOG_LEVEL se aplica en caliente: el agente ya lo tiene puesto.
        expect(cfg.logLevel).toBe('debug')
    })

    it('quitar el simulador se aplica al momento, sin reiniciar', async () => {
        const cfg = configDePrueba(await puertoLibre())
        cfg.modoSimulador = 'archivo'
        await levantar(cfg)

        const r = await fetch(`http://127.0.0.1:${cfg.uiPuerto}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ MODO_SIMULADOR: '' }),
        })

        expect((await r.json()).necesitanReinicio).toEqual([])
        expect(cfg.modoSimulador).toBe('')
    })

    it('no guarda nada si un valor rompería el arranque del agente', async () => {
        const cfg = configDePrueba(await puertoLibre())
        await levantar(cfg)

        const r = await fetch(`http://127.0.0.1:${cfg.uiPuerto}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ LOG_LEVEL: 'todo', API_URL: 'no-es-una-url' }),
        })

        expect(r.status).toBe(400)
        const cuerpo = await r.json()
        expect(cuerpo.errores.map((e: { clave: string }) => e.clave).sort())
            .toEqual(['API_URL', 'LOG_LEVEL'])
        expect(fs.readFileSync(rutaEnv, 'utf8')).toBe(ENV_BASE)
    })

    it('no escribe claves que la interfaz no debe tocar', async () => {
        const cfg = configDePrueba(await puertoLibre())
        await levantar(cfg)

        await fetch(`http://127.0.0.1:${cfg.uiPuerto}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ LOG_LEVEL: 'warn', SUPABASE_SERVICE_ROLE_KEY: 'nope' }),
        })

        expect(fs.readFileSync(rutaEnv, 'utf8')).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    })
})

describe('pendienteDeReinicio', () => {
    it('detecta un .env editado a mano que nadie llegó a aplicar', () => {
        const cfg = configDePrueba(9110)
        const enDisco = {
            API_URL: 'http://otro-servidor:3000',
            ESTACION_TOKEN: cfg.token,
            LOG_LEVEL: 'info',
            POLL_ESPERA_MS: '25000',
            MODO_SIMULADOR: '',
        }
        expect(pendienteDeReinicio(cfg, enDisco)).toEqual(['la dirección del servidor'])
    })

    it('no avisa de nada cuando el archivo y el agente dicen lo mismo', () => {
        const cfg = configDePrueba(9110)
        expect(pendienteDeReinicio(cfg, {
            API_URL: 'http://localhost:3000/',   // la barra final se normaliza igual
            ESTACION_TOKEN: cfg.token,
            LOG_LEVEL: 'info',
            POLL_ESPERA_MS: '25000',
            MODO_SIMULADOR: '',
        })).toEqual([])
    })

    it('avisa del simulador puesto a mano y sin reiniciar, que es el caso silencioso', () => {
        const cfg = configDePrueba(9110)
        cfg.modoSimulador = 'archivo'
        expect(pendienteDeReinicio(cfg, {
            API_URL: cfg.apiUrl,
            ESTACION_TOKEN: cfg.token,
            LOG_LEVEL: 'info',
            POLL_ESPERA_MS: '25000',
            MODO_SIMULADOR: '',
        })).toEqual(['el modo simulador'])
    })
})
