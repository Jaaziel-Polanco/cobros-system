import { describe, it, expect } from 'vitest'
import { construirTirillaTicket, type TirillaInput } from './tirilla-ticket'
import { aBytes } from './codificacion'
import type { TicketSnapshot } from '@/lib/types'

const snapshot: TicketSnapshot = {
    cliente: {
        id: 'c1',
        nombre: 'Juan',
        apellido: 'Muñoz García',
        telefono: '8091112222',
        dni_ruc: '001-1234567-8',
    },
    sorteo: {
        id: 's1',
        nombre: 'Gran Sorteo Navideño',
        premio: 'Televisor 55 pulgadas',
        fecha_fin: '2026-12-31',
    },
    negocio: {
        nombre_comercial: 'Inversiones Cordero',
        rnc: '1-31-12345-6',
        direccion: 'Av. Principal 100',
        telefono: '8095551234',
        texto_legal: 'Participan solo boletos válidos al cierre del sorteo.',
        url_terminos: 'https://ejemplo.do/terminos',
        pie_impresion: 'Gracias por su preferencia',
        logo_url: null,
    },
    emitido_at_rd: '29/07/2026 03:14 PM',
    origen: 'automatico',
    version_snapshot: 1,
}

const base: TirillaInput = {
    numeroFormateado: 'BOL-000123',
    snapshot,
    esCopia: false,
    anchoCols: 48,
    codepage: 'cp850',
    urlPublica: 'http://192.168.1.50:3000/t/abc123',
}

describe('construirTirillaTicket', () => {
    it('empieza inicializando la impresora', () => {
        const { bytes } = construirTirillaTicket(base)
        expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]))
    })

    it('selecciona el codepage antes de imprimir texto', () => {
        const { bytes } = construirTirillaTicket(base)
        // ESC t 2 = CP850
        expect(bytes.includes(Buffer.from([0x1b, 0x74, 0x02]))).toBe(true)
    })

    it('termina cortando el papel', () => {
        const { bytes } = construirTirillaTicket(base)
        expect(bytes.subarray(-3)).toEqual(Buffer.from([0x1d, 0x56, 0x00]))
    })

    it('imprime el número del boleto', () => {
        const { preview } = construirTirillaTicket(base)
        expect(preview).toContain('BOL-000123')
    })

    it('codifica la eñe del apellido en CP850, no en UTF-8', () => {
        const { bytes } = construirTirillaTicket(base)
        expect(bytes.includes(0xa4)).toBe(true)              // ñ en CP850
        expect(bytes.includes(Buffer.from([0xc3, 0xb1]))).toBe(false)  // ñ en UTF-8
    })

    it('incluye el nombre del negocio, el cliente y el sorteo', () => {
        const { preview } = construirTirillaTicket(base)
        expect(preview).toContain('INVERSIONES CORDERO')
        expect(preview).toContain('Juan Muñoz García')
        expect(preview).toContain('Gran Sorteo Navideño')
    })

    it('no marca copia en la primera impresión', () => {
        const { preview } = construirTirillaTicket(base)
        expect(preview).not.toContain('COPIA')
    })

    it('marca COPIA en las reimpresiones', () => {
        const { preview } = construirTirillaTicket({ ...base, esCopia: true })
        expect(preview).toContain('*** COPIA ***')
    })

    it('incluye la secuencia de QR con la URL pública', () => {
        const { bytes } = construirTirillaTicket(base)
        // GS ( k con cn=49 fn=80 (guardar datos)
        expect(bytes.includes(Buffer.from([0x1d, 0x28, 0x6b]))).toBe(true)
        expect(bytes.includes(Buffer.from('http://192.168.1.50:3000/t/abc123', 'utf8'))).toBe(true)
    })

    it('ninguna línea de la vista previa excede el ancho', () => {
        const { preview } = construirTirillaTicket(base)
        for (const l of preview.split('\n')) {
            expect(l.length).toBeLessThanOrEqual(48)
        }
    })

    it('funciona sin sorteo asignado', () => {
        const sinSorteo = { ...base, snapshot: { ...snapshot, sorteo: null } }
        const { preview } = construirTirillaTicket(sinSorteo)
        expect(preview).toContain('BOL-000123')
        expect(preview).not.toContain('Sorteo:')
    })

    it('funciona sin cédula ni texto legal', () => {
        const minimo: TirillaInput = {
            ...base,
            snapshot: {
                ...snapshot,
                cliente: { ...snapshot.cliente, dni_ruc: null },
                negocio: { ...snapshot.negocio, texto_legal: null, pie_impresion: null },
            },
        }
        expect(() => construirTirillaTicket(minimo)).not.toThrow()
    })

    it('respeta un ancho de 32 columnas para papel de 58 mm', () => {
        const { preview } = construirTirillaTicket({ ...base, anchoCols: 32 })
        for (const l of preview.split('\n')) {
            expect(l.length).toBeLessThanOrEqual(32)
        }
    })
})

// `ESC ! n` es una máscara de bits: TAMANO.MAXIMO activa doble ancho, así
// que a `cols` columnas físicas solo caben `cols / 2` caracteres. El número
// de boleto "huérfano" (sin sorteo asignado) llega a 22 caracteres
// (`{prefijo hasta 12}-SN-{6 dígitos}`), que no siempre entra en tamaño
// máximo. Estas pruebas verifican que, aun así, el número nunca se recorta
// —se degrada de tamaño— y que la vista previa no oculta ningún recorte que
// sí ocurra en los bytes reales (el nombre comercial sí puede recortarse).
describe('construirTirillaTicket — ancho físico real de los modos de impresión', () => {
    // 12 (máximo del prefijo) + '-SN-' (4) + 6 dígitos = 22 caracteres.
    const numeroHuerfanoMaximo = 'ABCDEFGHIJKL-SN-000123'

    it('nunca trunca el número del boleto a 48 columnas, aunque no quepa en tamaño máximo', () => {
        const { bytes, preview } = construirTirillaTicket({
            ...base,
            numeroFormateado: numeroHuerfanoMaximo,
            anchoCols: 48,
        })
        expect(bytes.includes(aBytes(numeroHuerfanoMaximo, 'cp850'))).toBe(true)
        expect(preview).toContain(numeroHuerfanoMaximo)
    })

    it('nunca trunca el número del boleto a 32 columnas (degrada de MAXIMO a DOBLE)', () => {
        const { bytes, preview } = construirTirillaTicket({
            ...base,
            numeroFormateado: numeroHuerfanoMaximo,
            anchoCols: 32,
        })
        expect(bytes.includes(aBytes(numeroHuerfanoMaximo, 'cp850'))).toBe(true)
        expect(preview).toContain(numeroHuerfanoMaximo)
    })

    it('recorta el nombre comercial demasiado largo a 48 columnas, igual en preview y en bytes', () => {
        const nombreLargo = 'Inversiones y Distribuidora Cordero del Caribe SRL'
        const esperado = nombreLargo.toUpperCase().slice(0, 48)

        const { bytes, preview } = construirTirillaTicket({
            ...base,
            anchoCols: 48,
            snapshot: { ...snapshot, negocio: { ...snapshot.negocio, nombre_comercial: nombreLargo } },
        })

        expect(preview).toContain(esperado)
        expect(bytes.includes(aBytes(esperado, 'cp850'))).toBe(true)
        // El nombre completo (sin recortar) no debe aparecer en ningún lado:
        // si el preview lo recorta, los bytes reales también deben recortarlo.
        expect(bytes.includes(aBytes(nombreLargo.toUpperCase(), 'cp850'))).toBe(false)
        expect(preview).not.toContain(nombreLargo.toUpperCase())
    })

    it('recorta el nombre comercial demasiado largo a 32 columnas, igual en preview y en bytes', () => {
        const nombreLargo = 'Inversiones y Distribuidora Cordero del Caribe SRL'
        const esperado = nombreLargo.toUpperCase().slice(0, 32)

        const { bytes, preview } = construirTirillaTicket({
            ...base,
            anchoCols: 32,
            snapshot: { ...snapshot, negocio: { ...snapshot.negocio, nombre_comercial: nombreLargo } },
        })

        expect(preview).toContain(esperado)
        expect(bytes.includes(aBytes(esperado, 'cp850'))).toBe(true)
        expect(bytes.includes(aBytes(nombreLargo.toUpperCase(), 'cp850'))).toBe(false)
        expect(preview).not.toContain(nombreLargo.toUpperCase())
    })
})
