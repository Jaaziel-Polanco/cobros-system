import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { volcarASimulador } from './simulador-archivo'

const CARPETA = path.join(__dirname, '..', 'volcado-simulador')

afterEach(() => {
    fs.rmSync(CARPETA, { recursive: true, force: true })
})

describe('volcarASimulador', () => {
    it('escribe un archivo .bin con los bytes exactos', async () => {
        const bytes = Buffer.from([0x1b, 0x40, 0x41, 0x42])
        await volcarASimulador({ tipo_conexion: 'red', ip: '10.0.0.5', port: 9100, nombre: null }, bytes)

        const archivos = fs.readdirSync(CARPETA).filter(f => f.endsWith('.bin'))
        expect(archivos.length).toBe(1)
        expect(fs.readFileSync(path.join(CARPETA, archivos[0]))).toEqual(bytes)
    })

    it('no rechaza nunca: el simulador no puede fallar como una impresora real', async () => {
        await expect(
            volcarASimulador({ tipo_conexion: 'windows', ip: null, port: 9100, nombre: 'POS-80' }, Buffer.from([0x41])),
        ).resolves.toBeUndefined()
    })
})
