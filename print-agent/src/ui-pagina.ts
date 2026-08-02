/**
 * La página entera: HTML, CSS y JavaScript en un solo texto.
 *
 * Sin CDN, sin fuentes externas, sin ningún archivo aparte. La PC de una
 * sucursal puede estar sin internet —de hecho, si está sin internet es
 * justo cuando alguien va a abrir esta página— y la interfaz tiene que
 * verse exactamente igual. Todo lo que necesita el navegador viaja en esta
 * misma respuesta.
 *
 * El JavaScript de cliente se escribe con comillas normales y concatenación
 * a propósito: este archivo YA es una plantilla de TypeScript, y meter
 * plantillas dentro obliga a escapar cada `$` y cada acento grave, que es
 * como se cuelan los errores tontos en un texto que nadie compila.
 */
export const PAGINA_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Agente de impresión</title>
<style>
:root {
  --fondo: #f4f5f7;
  --tarjeta: #ffffff;
  --borde: #d9dce1;
  --texto: #1d2126;
  --suave: #5b636d;
  --ok: #12704a;
  --ok-fondo: #e6f4ec;
  --mal: #a8261d;
  --mal-fondo: #fbeae8;
  --aviso: #7a5300;
  --aviso-fondo: #fdf2dc;
  --gris: #5b636d;
  --gris-fondo: #eceef1;
  --acento: #1f4fd8;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fondo: #14171c;
    --tarjeta: #1c2027;
    --borde: #333944;
    --texto: #e8eaee;
    --suave: #a2abb7;
    --ok: #6ddba2;
    --ok-fondo: #14301f;
    --mal: #ff9b90;
    --mal-fondo: #3a1a17;
    --aviso: #f0c274;
    --aviso-fondo: #33280f;
    --gris: #a2abb7;
    --gris-fondo: #262b33;
    --acento: #86a9ff;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0 16px 64px;
  font-family: "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif;
  background: var(--fondo); color: var(--texto); line-height: 1.5;
}
.envoltorio { max-width: 900px; margin: 0 auto; }
header { padding: 24px 0 8px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 32px 0 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--suave); }
.identidad { color: var(--suave); font-size: 14px; }
.veredicto {
  display: flex; align-items: center; gap: 12px;
  margin-top: 16px; padding: 14px 16px; border-radius: 10px;
  font-size: 18px; font-weight: 600; border: 1px solid transparent;
}
.veredicto.ok { background: var(--ok-fondo); color: var(--ok); border-color: var(--ok); }
.veredicto.mal { background: var(--mal-fondo); color: var(--mal); border-color: var(--mal); }
.veredicto.aviso { background: var(--aviso-fondo); color: var(--aviso); border-color: var(--aviso); }
.veredicto.gris { background: var(--gris-fondo); color: var(--gris); border-color: var(--borde); }
.aviso-fuerte {
  margin-top: 16px; padding: 16px; border-radius: 10px;
  background: var(--mal-fondo); border: 2px solid var(--mal); color: var(--mal);
}
.aviso-fuerte strong { display: block; font-size: 17px; margin-bottom: 4px; }
.aviso-flojo {
  margin-top: 16px; padding: 14px 16px; border-radius: 10px;
  background: var(--aviso-fondo); border: 1px solid var(--aviso); color: var(--aviso);
}
/* ─── La pausa tiene que ser imposible de no ver ───────────────
   No es adorno. Un agente pausado y olvidado es un fallo silencioso:
   la caja parece encendida, la página parece normal, y los boletos se
   quedan en el servidor sin que nadie lo note hasta que un cliente
   reclama. Por eso el cartel ocupa toda la pantalla de ancho, la página
   entera se enmarca en ámbar, el título de la pestaña cambia (se ve
   aunque la ventana esté detrás de otra) y el texto sube de tono con
   los minutos. */
body.pausado { box-shadow: inset 0 0 0 8px var(--aviso); }
.cartel-pausa {
  margin: 16px 0 0; padding: 18px 20px; border-radius: 12px;
  background: var(--aviso-fondo); border: 3px solid var(--aviso); color: var(--aviso);
}
.cartel-pausa .grande {
  display: block; font-size: 26px; font-weight: 800; letter-spacing: .02em;
  line-height: 1.2; margin-bottom: 6px;
}
.cartel-pausa .rato { font-weight: 700; }
.cartel-pausa.mucho-rato { animation: latir 2s ease-in-out infinite; }
@keyframes latir {
  0%, 100% { border-color: var(--aviso); }
  50% { border-color: var(--mal); }
}
@media (prefers-reduced-motion: reduce) {
  .cartel-pausa.mucho-rato { animation: none; border-color: var(--mal); }
}
button.peligro { border-color: var(--mal); color: var(--mal); }
button.peligro:hover:not(:disabled) { background: var(--mal-fondo); border-color: var(--mal); color: var(--mal); }
button.mini { font-size: 12.5px; padding: 4px 9px; font-weight: 600; }
a.boton {
  font: inherit; font-weight: 600; text-decoration: none; display: inline-block;
  border-radius: 8px; padding: 9px 16px;
  border: 1px solid var(--borde); background: var(--tarjeta); color: var(--texto);
}
a.boton:hover { border-color: var(--acento); color: var(--acento); }
.insignia {
  display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .04em; padding: 1px 7px; border-radius: 999px; margin-left: 6px;
  border: 1px solid var(--borde); color: var(--suave); white-space: nowrap;
}
.insignia.pedida { border-color: var(--acento); color: var(--acento); }
.est-lista { color: var(--ok); font-weight: 600; }
.est-pausa, .est-error, .est-sin-conexion { color: var(--mal); font-weight: 600; }
.est-desconocido { color: var(--gris); font-weight: 600; }
.est-atascado { color: var(--mal); font-weight: 600; }
.est-imprimiendo { color: var(--ok); font-weight: 600; }
.est-esperando { color: var(--suave); font-weight: 600; }
tr.atascada td { background: var(--mal-fondo); }
.nombre-impresora {
  font-family: Consolas, "Courier New", monospace;
  /* Un espacio al final de un nombre es exactamente el fallo que hay que
     poder ver: sin esto el navegador lo colapsa y se vuelve invisible. */
  white-space: pre-wrap; word-break: break-word;
}
pre.registro {
  margin: 12px 0 0; padding: 12px; max-height: 420px; overflow: auto;
  background: var(--gris-fondo); border-radius: 8px;
  font-family: Consolas, "Courier New", monospace; font-size: 12px; line-height: 1.4;
  white-space: pre-wrap; word-break: break-word;
}
.nota {
  margin: 12px 0 0; padding: 12px 14px; border-radius: 8px;
  background: var(--gris-fondo); font-size: 13.5px; color: var(--suave);
}
.nota strong { color: var(--texto); }
.tarjeta {
  background: var(--tarjeta); border: 1px solid var(--borde);
  border-radius: 10px; padding: 14px 16px; margin-bottom: 10px;
}
.cabecera-punto { display: flex; align-items: baseline; gap: 10px; }
.punto { width: 11px; height: 11px; border-radius: 50%; flex: 0 0 auto; position: relative; top: -1px; }
.punto.ok { background: var(--ok); }
.punto.error { background: var(--mal); }
.punto.aviso { background: var(--aviso); }
.punto.desconocido { background: var(--gris); }
.titulo-punto { font-weight: 600; }
.etiqueta {
  margin-left: auto; font-size: 12px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .05em;
}
.etiqueta.ok { color: var(--ok); }
.etiqueta.error { color: var(--mal); }
.etiqueta.aviso { color: var(--aviso); }
.etiqueta.desconocido { color: var(--gris); }
.resumen { margin: 6px 0 0; }
.quehacer { margin: 6px 0 0; color: var(--suave); font-size: 14px; }
.intro { margin: 0 0 20px; color: var(--suave); font-size: 14px; }
.lista {
  margin: 10px 0 0; padding: 10px 12px; border-radius: 8px;
  background: var(--gris-fondo); font-size: 14px;
}
.lista ul { margin: 6px 0 0; padding-left: 20px; }
.lista code { font-family: Consolas, "Courier New", monospace; }
button {
  font: inherit; font-weight: 600; cursor: pointer;
  border-radius: 8px; padding: 9px 16px;
  border: 1px solid var(--borde); background: var(--tarjeta); color: var(--texto);
}
button:hover:not(:disabled) { border-color: var(--acento); color: var(--acento); }
button:disabled { opacity: .55; cursor: progress; }
button.principal { background: var(--acento); border-color: var(--acento); color: #fff; }
button.principal:hover:not(:disabled) { color: #fff; filter: brightness(1.1); }
.fila-botones { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.momento { color: var(--suave); font-size: 13px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--borde); vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--suave); }
tr:last-child td { border-bottom: none; }
td.res-impreso { color: var(--ok); font-weight: 600; }
td.res-error { color: var(--mal); font-weight: 600; }
td.res-descartado { color: var(--aviso); font-weight: 600; }
td.res-simulado { color: var(--aviso); font-weight: 600; }
.error-crudo {
  font-family: Consolas, "Courier New", monospace; font-size: 12.5px;
  white-space: pre-wrap; word-break: break-word; color: var(--mal);
}
.campo { margin-bottom: 14px; }
.campo label { display: block; font-weight: 600; margin-bottom: 3px; }
.campo .ayuda { display: block; color: var(--suave); font-size: 13px; margin-bottom: 6px; }
input[type=text], select {
  font: inherit; width: 100%; padding: 8px 10px;
  border: 1px solid var(--borde); border-radius: 8px;
  background: var(--fondo); color: var(--texto);
}
.reinicio { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--aviso); }
.envivo { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--ok); }
.mal-campo { color: var(--mal); font-size: 13px; margin-top: 4px; }
.vacio { color: var(--suave); font-style: italic; }
pre.papel {
  margin: 10px 0 0; padding: 12px; overflow-x: auto;
  background: var(--gris-fondo); border-radius: 8px;
  font-family: Consolas, "Courier New", monospace; font-size: 12.5px; line-height: 1.35;
}
footer { margin-top: 40px; color: var(--suave); font-size: 13px; }
</style>
</head>
<body>
<div class="envoltorio">

<header>
  <h1>Agente de impresión de boletos</h1>
  <div class="identidad" id="identidad">Cargando…</div>
  <div class="veredicto gris" id="veredicto"><span>Comprobando…</span></div>
  <div id="banderas"></div>
</header>

<h2>Pausar mientras arreglas la impresora</h2>
<div class="tarjeta">
  <p class="resumen" id="texto-pausa">—</p>
  <p class="quehacer">Úsalo para cambiar el rollo de papel o destrabar la impresora. En pausa
  el agente <strong>deja de pedir boletos</strong>: los que se generen se quedan esperando en el
  sistema y salen todos solos en cuanto reanudes. Nada se pierde y nada falla.</p>
  <div class="fila-botones" style="margin-top:12px">
    <button class="principal" id="btn-pausa" onclick="cambiarPausa()">Pausar el agente</button>
    <span class="momento" id="momento-pausa"></span>
  </div>
</div>

<h2>Diagnóstico</h2>
<div id="diagnostico"></div>
<div class="fila-botones">
  <button class="principal" id="btn-diag" onclick="lanzarDiagnostico()">Comprobar de nuevo</button>
  <span class="momento" id="momento-diag"></span>
</div>

<h2>Impresoras de esta PC</h2>
<div class="tarjeta" id="impresoras"><p class="vacio" style="margin:0">Preguntando a Windows…</p></div>
<div class="fila-botones">
  <button id="btn-impresoras" onclick="cargarImpresoras()">Actualizar la lista</button>
  <span class="momento" id="momento-impresoras"></span>
</div>

<h2>La cola de Windows</h2>
<div class="tarjeta" id="cola"><p class="vacio" style="margin:0">Cargando…</p></div>

<h2>Prueba de impresión</h2>
<div class="tarjeta">
  <p class="resumen">Manda una hoja de prueba a la impresora desde esta misma PC, sin pasar
  por el servidor ni por la cola de boletos. Es la única comprobación que de verdad convence:
  o sale papel, o no sale.</p>
  <div class="fila-botones" style="margin-top:12px">
    <button class="principal" id="btn-prueba" onclick="imprimirPrueba()">Imprimir hoja de prueba</button>
    <button id="btn-papel" onclick="verPapel()">Ver cómo debería quedar</button>
  </div>
  <div id="resultado-prueba"></div>
  <div class="nota"><strong>Esto no reimprime boletos, y es a propósito.</strong>
  Un boleto reimpreso desde aquí sería papel del que el sistema no se entera: su contador de
  impresiones dejaría de cuadrar y saldrían dos papeles con el mismo número de rifa sin rastro
  de ninguno. Para volver a sacar un boleto, hazlo desde el sistema, en el perfil del cliente:
  ahí queda contado y sale marcado <code>***** COPIA *****</code>.</div>
</div>

<h2>Actividad reciente</h2>
<div class="tarjeta" id="actividad"></div>

<h2>Registro (agente.log)</h2>
<div class="tarjeta">
  <p class="resumen">El histórico completo de lo que ha hecho el agente. Es lo primero que va a
  pedirte soporte por teléfono.</p>
  <div class="fila-botones" style="margin-top:12px">
    <button id="btn-registro" onclick="cargarRegistro()">Ver las últimas líneas</button>
    <a class="boton" href="/api/registro/descargar" download>Descargar el archivo</a>
    <button id="btn-informe" onclick="copiarInforme()">Copiar informe para soporte</button>
    <span class="momento" id="momento-registro"></span>
  </div>
  <div id="caja-registro"></div>
</div>

<h2>Configuración</h2>
<div class="tarjeta">
  <p class="intro">Se guarda en el archivo <code>.env</code> de esta PC,
  respetando los comentarios que ya tiene. Nada de esto se manda al servidor.</p>

  <div class="campo">
    <label for="API_URL">Dirección del servidor de cobros <span class="reinicio">necesita reiniciar</span></label>
    <span class="ayuda">La dirección donde corre el sistema, por ejemplo http://192.168.1.50:3000</span>
    <input type="text" id="API_URL" spellcheck="false" autocomplete="off">
    <div class="mal-campo" id="mal-API_URL"></div>
  </div>

  <div class="campo">
    <label for="ESTACION_TOKEN">Token de la estación <span class="reinicio">necesita reiniciar</span></label>
    <span class="ayuda">Se enseña tapado y no se puede leer desde aquí: solo sustituir.
    Déjalo en blanco para conservar el que ya está puesto.
    Token actual: <strong id="token-tapado">—</strong></span>
    <input type="text" id="ESTACION_TOKEN" spellcheck="false" autocomplete="off"
           placeholder="Pega aquí un token nuevo para cambiarlo">
    <div class="mal-campo" id="mal-ESTACION_TOKEN"></div>
  </div>

  <div class="campo">
    <label for="MODO_SIMULADOR">Modo simulador <span class="envivo">al instante</span></label>
    <span class="ayuda">Con el simulador puesto NO sale papel: los boletos se guardan en un
    archivo. Solo sirve para desarrollo.</span>
    <select id="MODO_SIMULADOR">
      <option value="">Imprimir de verdad (lo normal en una tienda)</option>
      <option value="archivo">Simulador: NO imprime, vuelca a un archivo</option>
    </select>
    <div class="mal-campo" id="mal-MODO_SIMULADOR"></div>
  </div>

  <div class="campo">
    <label for="LOG_LEVEL">Detalle del registro <span class="envivo">al instante</span></label>
    <span class="ayuda">Qué se apunta en <code>agente.log</code>. Sube a "debug" solo mientras
    soporte te lo pida: llena el archivo muy rápido.</span>
    <select id="LOG_LEVEL">
      <option value="debug">debug — todo</option>
      <option value="info">info — lo normal</option>
      <option value="warn">warn — solo avisos y errores</option>
      <option value="error">error — solo errores</option>
    </select>
    <div class="mal-campo" id="mal-LOG_LEVEL"></div>
  </div>

  <div class="campo">
    <label for="POLL_ESPERA_MS">Espera al preguntar por boletos <span class="reinicio">necesita reiniciar</span></label>
    <span class="ayuda">En milisegundos. 25000 es lo normal. Ponlo en 0 solo si la red de la
    tienda corta las conexiones largas y los boletos tardan en salir.</span>
    <input type="text" id="POLL_ESPERA_MS" spellcheck="false" autocomplete="off" inputmode="numeric">
    <div class="mal-campo" id="mal-POLL_ESPERA_MS"></div>
  </div>

  <div class="fila-botones">
    <button class="principal" id="btn-guardar" onclick="guardarConfig()">Guardar cambios</button>
    <span class="momento" id="momento-guardar"></span>
  </div>
</div>

<footer id="pie"></footer>

</div>
<script>
"use strict";

var CLAVES = ["API_URL", "ESTACION_TOKEN", "MODO_SIMULADOR", "LOG_LEVEL", "POLL_ESPERA_MS"];
var estadoActual = null;
var formularioTocado = false;
var diagnosticoActual = null;
var impresorasActuales = [];
var colaActual = { impresora: null, trabajos: [] };
var TITULO = document.title;

// A partir de este rato en pausa el cartel sube de tono: media hora
// pausado ya no es "estoy cambiando el papel", es "alguien se fue".
var MINUTOS_PAUSA_PREOCUPANTE = 10;

function esc(t) {
  return String(t === null || t === undefined ? "" : t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function hace(iso) {
  if (!iso) return null;
  var seg = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 0) seg = 0;
  if (seg < 10) return "hace un momento";
  if (seg < 60) return "hace " + seg + " segundos";
  var min = Math.round(seg / 60);
  if (min < 60) return "hace " + min + (min === 1 ? " minuto" : " minutos");
  var h = Math.round(min / 60);
  if (h < 48) return "hace " + h + (h === 1 ? " hora" : " horas");
  return "hace " + Math.round(h / 24) + " días";
}

function reloj(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  var p = function (n) { return String(n).padStart(2, "0"); };
  return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

function pedir(ruta, cuerpo) {
  var opciones = { headers: { "Content-Type": "application/json" } };
  if (cuerpo !== undefined) {
    opciones.method = "POST";
    opciones.body = JSON.stringify(cuerpo);
  }
  return fetch(ruta, opciones).then(function (r) {
    return r.json().catch(function () { return { error: "El agente contestó algo que no se entiende" }; });
  });
}

function tamano(bytes) {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * Copiar al portapapeles.
 *
 * navigator.clipboard funciona en 127.0.0.1 (el navegador lo trata como
 * origen seguro aunque sea http), pero no en cualquier navegador viejo que
 * pueda haber en la PC de una tienda. El respaldo con un <textarea> y
 * execCommand es feo y está obsoleto, y es exactamente por eso que sigue
 * funcionando en todas partes: copiar el nombre exacto de la impresora es
 * medio motivo de que este botón exista, así que no puede depender de qué
 * navegador tenga instalado la caja.
 */
function copiar(texto) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(texto).catch(function () { return copiarALaAntigua(texto); });
  }
  return Promise.resolve(copiarALaAntigua(texto));
}

function copiarALaAntigua(texto) {
  var caja = document.createElement("textarea");
  caja.value = texto;
  caja.setAttribute("readonly", "");
  caja.style.position = "fixed";
  caja.style.left = "-9999px";
  document.body.appendChild(caja);
  caja.select();
  var ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  document.body.removeChild(caja);
  if (!ok) throw new Error("Este navegador no dejó copiar");
}

function avisar(idMomento, texto) {
  var el = document.getElementById(idMomento);
  if (!el) return;
  el.textContent = texto;
}

// ─── Estado (se refresca solo, no cuesta nada) ───────────────
function pintarEstado(e) {
  estadoActual = e;

  var identidad = e.estacion
    ? "Estación " + esc(e.estacion) + " · sucursal " + esc(e.sucursal)
    : "Todavía sin datos de la estación: el servidor no ha contestado";
  document.getElementById("identidad").innerHTML =
    identidad + " · versión " + esc(e.version);

  // Ojo: el aviso mira lo que el agente ESTÁ USANDO, no lo que dice el
  // archivo. Si alguien quitó el simulador del .env y no reinició, el papel
  // sigue sin salir y este aviso tiene que seguir puesto.
  var banderas = pintarPausa(e.pausa);
  if (e.enEjecucion.MODO_SIMULADOR === "archivo") {
    banderas += '<div class="aviso-fuerte"><strong>NO SE ESTÁ IMPRIMIENDO NADA</strong>' +
      "El modo simulador está puesto: los boletos se guardan en un archivo en vez de salir " +
      "por la impresora. En una tienda esto es un fallo: nadie recibe su boleto y el sistema " +
      "los da por impresos. Cámbialo abajo, en Configuración, a “Imprimir de verdad”.</div>";
  }
  if (e.pendienteReinicio && e.pendienteReinicio.length) {
    banderas += '<div class="aviso-flojo"><strong>Hay cambios guardados que aún no se aplican.</strong> ' +
      "El agente sigue usando lo de antes para: " + esc(e.pendienteReinicio.join(", ")) +
      ". Reinicia el agente (o su servicio de Windows) para que valgan.</div>";
  }
  document.getElementById("banderas").innerHTML = banderas;

  pintarActividad(e);
  actualizarVeredicto();
  if (!formularioTocado) rellenarFormulario(e);
  document.getElementById("token-tapado").textContent = e.enEjecucion.ESTACION_TOKEN_TAPADO;
  document.getElementById("pie").innerHTML =
    "Esta página solo se ve desde esta PC (127.0.0.1:" + esc(e.uiPuerto) + "). " +
    "El agente lleva encendido desde las " + esc(reloj(e.iniciadoEn)) + ". " +
    "El registro completo está en <code>agente.log</code>, en la carpeta del agente.";
}

/**
 * El cartel de pausa, la caja de control y el título de la pestaña.
 *
 * Devuelve el HTML del cartel para que vaya el primero de todos, antes
 * incluso del aviso del simulador: si el agente está pausado, todo lo demás
 * que diga esta página es secundario.
 */
function pintarPausa(p) {
  var pausado = !!(p && p.pausado);
  var minutos = pausado ? p.minutos : 0;

  document.body.className = pausado ? "pausado" : "";
  document.title = pausado ? "⏸ EN PAUSA — " + TITULO : TITULO;

  var boton = document.getElementById("btn-pausa");
  boton.textContent = pausado ? "Reanudar el agente" : "Pausar el agente";
  boton.className = pausado ? "principal" : "peligro";

  var rato = minutos < 1
    ? "hace menos de un minuto"
    : "desde hace " + minutos + (minutos === 1 ? " minuto" : " minutos");

  document.getElementById("texto-pausa").innerHTML = pausado
    ? "<strong>Está EN PAUSA</strong> " + esc(rato) +
      ". No está pidiendo boletos: se están quedando pendientes en el sistema."
    : "<strong>Está funcionando.</strong> Pide boletos al servidor y los imprime en cuanto llegan.";

  if (!pausado) return "";

  var extra = minutos >= MINUTOS_PAUSA_PREOCUPANTE
    ? "<strong>Lleva " + minutos + " minutos así.</strong> Si ya terminaste con la impresora, " +
      "dale a «Reanudar el agente»: hasta que lo hagas, en esta caja no sale ni un boleto."
    : "Los boletos que se generen se quedan esperando en el sistema y salen todos solos al reanudar.";

  return '<div class="cartel-pausa' + (minutos >= MINUTOS_PAUSA_PREOCUPANTE ? " mucho-rato" : "") + '">' +
    '<span class="grande">⏸ EL AGENTE ESTÁ EN PAUSA</span>' +
    '<span class="rato">Pausado ' + esc(rato) + ".</span> " + extra +
    "</div>";
}

function cambiarPausa() {
  var b = document.getElementById("btn-pausa");
  var pausadoAhora = !!(estadoActual && estadoActual.pausa && estadoActual.pausa.pausado);

  b.disabled = true;
  pedir("/api/pausa", { pausado: !pausadoAhora }).then(function (r) {
    if (r.error) { avisar("momento-pausa", "No se pudo: " + r.error); return; }
    avisar("momento-pausa", r.pausa.pausado
      ? "Pausado. Acuérdate de reanudarlo al terminar."
      : "Reanudado. Los boletos pendientes salen en unos segundos.");
    refrescarEstado();
  }).catch(function (err) {
    avisar("momento-pausa", "No se pudo: " + err.message);
  }).then(function () { b.disabled = false; });
}

function pintarActividad(e) {
  var partes = [];

  var latido = e.ultimoLatido
    ? "Último contacto con el servidor: " + esc(hace(e.ultimoLatido)) + " (" + esc(reloj(e.ultimoLatido)) + ")"
    : "Todavía no ha habido ni un solo contacto con el servidor desde que arrancó el agente.";
  var claseLatido = "ok";
  if (!e.ultimoLatido) claseLatido = "error";
  else if (Date.now() - new Date(e.ultimoLatido).getTime() > 90000) claseLatido = "aviso";

  var ultima = null;
  for (var i = 0; i < e.actividad.length; i++) {
    if (e.actividad[i].tipo === "boleto") { ultima = e.actividad[i]; break; }
  }
  var textoUltima = ultima
    ? "Último boleto: " + esc(hace(ultima.at)) + " (" + esc(reloj(ultima.at)) + ") · " + esc(ultima.resultado)
    : "Ningún boleto impreso desde que arrancó el agente.";

  partes.push(
    '<div class="cabecera-punto"><span class="punto ' + claseLatido + '"></span>' +
    '<span class="titulo-punto">Contacto y última impresión</span></div>' +
    '<p class="resumen">' + latido + "</p>" +
    '<p class="resumen">' + textoUltima + "</p>" +
    (e.ultimoFallo
      ? '<p class="quehacer">Último fallo hablando con el servidor (' + esc(reloj(e.ultimoFallo.at)) +
        '): <span class="error-crudo">' + esc(e.ultimoFallo.mensaje) + "</span></p>"
      : "")
  );

  if (!e.actividad.length) {
    partes.push('<p class="vacio" style="margin-bottom:0">Todavía no ha pasado nada. ' +
      "En cuanto se imprima un boleto o una hoja de prueba, aparecerá aquí.</p>");
  } else {
    var filas = "";
    for (var j = 0; j < e.actividad.length; j++) {
      var a = e.actividad[j];
      filas += "<tr><td>" + esc(reloj(a.at)) + "</td><td>" + esc(a.detalle) + "</td>" +
        '<td class="res-' + esc(a.resultado) + '">' + esc(a.resultado) + "</td>" +
        "<td>" + esc(a.destino) +
        (a.error ? '<div class="error-crudo">' + esc(a.error) + "</div>" : "") +
        "</td></tr>";
    }
    partes.push('<table style="margin-top:14px"><thead><tr><th>Hora</th><th>Qué</th>' +
      "<th>Resultado</th><th>Dónde / error</th></tr></thead><tbody>" + filas + "</tbody></table>");
  }

  document.getElementById("actividad").innerHTML = partes.join("");
}

function rellenarFormulario(e) {
  document.getElementById("API_URL").value = e.config.API_URL;
  document.getElementById("MODO_SIMULADOR").value = e.config.MODO_SIMULADOR;
  document.getElementById("LOG_LEVEL").value = e.config.LOG_LEVEL;
  document.getElementById("POLL_ESPERA_MS").value = e.config.POLL_ESPERA_MS;
}

// Un sondeo suelto puede fallar sin que pase nada: la pestaña que despierta
// tras estar en segundo plano, el PC que vuelve de suspensión, una pausa del
// navegador. Esta pestaña se queda abierta días en un mostrador, así que
// gritar "el agente murió" al primer tropiezo enseña a la gente a ignorar el
// cartel rojo — y entonces el rojo deja de servir el día que es de verdad.
// Se exigen SONDEOS_FALLIDOS_PARA_ALARMA seguidos (unos 9 s) antes de avisar.
var SONDEOS_FALLIDOS_PARA_ALARMA = 3;
var sondeosFallidos = 0;

function refrescarEstado() {
  return pedir("/api/estado").then(function (e) {
    if (!e.error) {
      sondeosFallidos = 0;
      pintarEstado(e);
    }
  }).catch(function () {
    sondeosFallidos++;
    if (sondeosFallidos < SONDEOS_FALLIDOS_PARA_ALARMA) return;
    document.getElementById("veredicto").className = "veredicto mal";
    document.getElementById("veredicto").innerHTML =
      "<span>El agente dejó de responder. ¿Se cerró la ventana donde estaba corriendo?</span>";
  });
}

// ─── Diagnóstico ──────────────────────────────────────────────
function pintarDiagnostico(d) {
  diagnosticoActual = d;
  var html = "";

  for (var i = 0; i < d.puntos.length; i++) {
    var p = d.puntos[i];
    html += '<div class="tarjeta"><div class="cabecera-punto">' +
      '<span class="punto ' + esc(p.nivel) + '"></span>' +
      '<span class="titulo-punto">' + esc(p.titulo) + "</span>" +
      '<span class="etiqueta ' + esc(p.nivel) + '">' +
      (p.nivel === "ok" ? "bien" : p.nivel === "error" ? "mal" : p.nivel === "aviso" ? "ojo" : "sin saber") +
      "</span></div>" +
      '<p class="resumen">' + esc(p.resumen) + "</p>" +
      '<p class="quehacer">' + esc(p.queHacer) + "</p></div>";
  }

  document.getElementById("diagnostico").innerHTML = html;
  document.getElementById("momento-diag").textContent = "Comprobado a las " + reloj(d.at);

  // La lista de impresoras viaja con el diagnóstico: ya se la preguntó a
  // Windows para poder decidir el veredicto de la impresora, y volver a
  // preguntarlo serían dos PowerShell por cada comprobación.
  pintarImpresoras(d.impresoras, d.errorImpresoras, d.impresoraPedida);
  actualizarVeredicto();
}

/**
 * El veredicto de arriba del todo, la única línea que mucha gente va a leer.
 *
 * Mira el diagnóstico Y el estado a la vez, y por orden de qué impide
 * cobrar ahora mismo: la pausa primero (nada va a salir, y es lo único de
 * esta lista que se arregla con un clic desde aquí), luego el simulador,
 * luego los rojos del diagnóstico.
 */
function actualizarVeredicto() {
  var v = document.getElementById("veredicto");

  if (estadoActual && estadoActual.pausa && estadoActual.pausa.pausado) {
    v.className = "veredicto aviso";
    v.innerHTML = "<span>⏸ En pausa: no va a salir ningún boleto hasta que lo reanudes.</span>";
    return;
  }

  if (estadoActual && estadoActual.enEjecucion.MODO_SIMULADOR === "archivo") {
    v.className = "veredicto mal";
    v.innerHTML = "<span>El simulador está puesto: no va a salir ni un boleto por la impresora.</span>";
    return;
  }

  if (!diagnosticoActual) return;

  var hayError = false, hayAviso = false, hayDesconocido = false;
  for (var i = 0; i < diagnosticoActual.puntos.length; i++) {
    var n = diagnosticoActual.puntos[i].nivel;
    if (n === "error") hayError = true;
    if (n === "aviso") hayAviso = true;
    if (n === "desconocido") hayDesconocido = true;
  }

  if (hayError) {
    v.className = "veredicto mal";
    v.innerHTML = "<span>Hay algo que no está bien. Mira los puntos en rojo.</span>";
  } else if (hayAviso || hayDesconocido) {
    v.className = "veredicto aviso";
    v.innerHTML = "<span>Casi todo bien, pero hay algo que conviene mirar.</span>";
  } else {
    v.className = "veredicto ok";
    v.innerHTML = "<span>Todo listo: esta caja puede imprimir boletos.</span>";
  }
}

function lanzarDiagnostico() {
  var b = document.getElementById("btn-diag");
  b.disabled = true;
  b.textContent = "Comprobando…";
  document.getElementById("momento-diag").textContent = "";
  return pedir("/api/diagnostico", {}).then(function (d) {
    if (d.error) {
      document.getElementById("diagnostico").innerHTML =
        '<div class="tarjeta"><p class="resumen">No se pudo comprobar: ' + esc(d.error) + "</p></div>";
    } else {
      pintarDiagnostico(d);
    }
  }).catch(function (err) {
    document.getElementById("diagnostico").innerHTML =
      '<div class="tarjeta"><p class="resumen">No se pudo comprobar: ' + esc(err.message) + "</p></div>";
  }).then(function () {
    b.disabled = false;
    b.textContent = "Comprobar de nuevo";
  });
}

// ─── Impresoras de esta PC ────────────────────────────────────
var ETIQUETA_ESTADO = {
  "lista": "Lista",
  "pausa": "EN PAUSA",
  "sin-conexion": "Sin conexión",
  "error": "Con problema",
  "desconocido": "Sin saber"
};

/**
 * La tabla de impresoras.
 *
 * "impresoras" a null significa «no se pudo preguntar a Windows», que no es
 * lo mismo que una lista vacía («aquí no hay ninguna instalada»). La
 * primera no dice nada de la impresora; la segunda apunta directa al fallo
 * de instalación más común, así que se enseñan distinto.
 */
function pintarImpresoras(impresoras, error, pedida) {
  var caja = document.getElementById("impresoras");
  impresorasActuales = impresoras || [];

  if (!impresoras) {
    caja.innerHTML = '<p class="resumen">No se pudo preguntar a Windows qué impresoras hay.</p>' +
      '<p class="quehacer">No significa que la impresora esté mal: significa que esta consulta no ' +
      'salió. El agente sigue imprimiendo igual.</p>' +
      '<div class="error-crudo">' + esc(error || "motivo desconocido") + "</div>";
    return;
  }

  if (!impresoras.length) {
    caja.innerHTML = '<p class="resumen">Este PC no tiene <strong>ninguna</strong> impresora ' +
      "instalada para la cuenta con la que corre el agente.</p>" +
      '<p class="quehacer">Es el fallo de instalación más común: la impresora está instalada, pero ' +
      "para otro usuario de Windows. Instálala con la misma cuenta con la que corre el agente (o " +
      "cambia esa cuenta en el servicio: ver el apartado de NSSM en el README).</p>";
    return;
  }

  var filas = "";
  for (var i = 0; i < impresoras.length; i++) {
    var p = impresoras[i];
    var esLaPedida = pedida !== null && pedida !== undefined &&
      String(pedida).trim().toLowerCase() === p.nombre.trim().toLowerCase();

    var insignias = "";
    if (esLaPedida) insignias += '<span class="insignia pedida">la que pide el servidor</span>';
    if (p.predeterminada) insignias += '<span class="insignia">predeterminada de Windows</span>';

    var cola = p.enCola === null
      ? '<span class="vacio">no se pudo contar</span>'
      : (p.enCola === 0 ? "vacía" : "<strong>" + p.enCola + "</strong>");
    if (p.enCola) {
      cola += ' <button class="mini" onclick="cargarCola(' + i + ')">Ver cola</button>';
    }

    filas += "<tr>" +
      '<td><span class="nombre-impresora">' + esc(p.nombre) + "</span>" + insignias +
      '<div style="margin-top:6px"><button class="mini" onclick="copiarNombre(' + i +
      ')">Copiar nombre exacto</button></div></td>' +
      '<td class="est-' + esc(p.estado) + '">' + esc(ETIQUETA_ESTADO[p.estado] || p.estado) +
      '<div class="quehacer" style="margin-top:2px">' + esc(p.estadoTexto) + "</div></td>" +
      "<td>" + cola + "</td>" +
      "<td>" + esc(p.puerto) + '<div class="quehacer" style="margin-top:2px">' +
      esc(p.controlador) + "</div></td>" +
      "</tr>";
  }

  caja.innerHTML = '<p class="resumen">Estas son las impresoras que ve la cuenta de Windows con ' +
    "la que corre el agente — que no siempre son las mismas que ves tú al abrir «Impresoras y " +
    "escáneres».</p>" +
    '<p class="quehacer">El nombre hay que escribirlo en el sistema, en Estaciones, EXACTO. Los ' +
    "espacios cuentan y no se ven; cópialo con el botón en vez de teclearlo.</p>" +
    '<table style="margin-top:12px"><thead><tr><th>Nombre</th><th>Cómo está</th>' +
    "<th>En cola</th><th>Puerto / controlador</th></tr></thead><tbody>" + filas + "</tbody></table>";
}

function copiarNombre(i) {
  var p = impresorasActuales[i];
  if (!p) return;
  copiar(p.nombre).then(function () {
    avisar("momento-impresoras", "Copiado: «" + p.nombre + "». Pégalo en Estaciones, en el sistema.");
  }).catch(function (err) {
    avisar("momento-impresoras", "No se pudo copiar (" + err.message + "). El nombre es: " + p.nombre);
  });
}

function cargarImpresoras() {
  var b = document.getElementById("btn-impresoras");
  b.disabled = true;
  avisar("momento-impresoras", "Preguntando a Windows…");
  return pedir("/api/impresoras").then(function (r) {
    pintarImpresoras(r.impresoras, r.error, diagnosticoActual ? diagnosticoActual.impresoraPedida : null);
    avisar("momento-impresoras", r.error ? "" : "Actualizado a las " + reloj(new Date().toISOString()));
  }).catch(function (err) {
    avisar("momento-impresoras", "No se pudo: " + err.message);
  }).then(function () { b.disabled = false; });
}

// ─── La cola de Windows ───────────────────────────────────────

/** Qué impresora toca mirar por defecto: la que pide el servidor. */
function impresoraDeLaCola() {
  if (colaActual.impresora) return colaActual.impresora;
  if (estadoActual && estadoActual.destinoTipo === "windows" && estadoActual.destinoNombre) {
    return estadoActual.destinoNombre;
  }
  return null;
}

function cargarCola(indiceImpresora) {
  var nombre = indiceImpresora === undefined || indiceImpresora === null
    ? impresoraDeLaCola()
    : (impresorasActuales[indiceImpresora] || {}).nombre;

  if (!nombre) { pintarCola(null, null, null); return Promise.resolve(); }

  colaActual.impresora = nombre;
  var caja = document.getElementById("cola");
  caja.innerHTML = '<p class="vacio" style="margin:0">Mirando la cola de «' + esc(nombre) + "»…</p>";

  return pedir("/api/cola?impresora=" + encodeURIComponent(nombre)).then(function (r) {
    colaActual.trabajos = r.trabajos || [];
    pintarCola(nombre, r.trabajos, r.error);
  }).catch(function (err) {
    pintarCola(nombre, null, err.message);
  });
}

/**
 * Por qué esos trabajos no están saliendo, si es que se puede saber.
 *
 * Hay un detalle que engaña y que hay que decir aquí: con la IMPRESORA en
 * pausa, Windows deja cada TRABAJO en «Normal». La tabla de abajo diría
 * «esperando su turno» de tres boletos que no van a salir nunca. El estado
 * de la impresora ya se preguntó al hacer la lista de arriba, así que basta
 * con mirarlo y decirlo.
 */
function porQueNoSale(nombre) {
  var p = null;
  for (var i = 0; i < impresorasActuales.length; i++) {
    if (impresorasActuales[i].nombre === nombre) { p = impresorasActuales[i]; break; }
  }
  if (!p || p.estado === "lista" || p.estado === "desconocido") return "";

  return '<div class="aviso-fuerte"><strong>La impresora no está en condiciones de imprimir</strong>' +
    esc(p.estadoTexto) + ". Mientras siga así, lo que haya en esta cola no va a salir; en cuanto " +
    "se arregle, sale solo y sin cancelar nada.</div>";
}

function pintarCola(nombre, trabajos, error) {
  var caja = document.getElementById("cola");

  var explicacion = '<p class="resumen">La cola de Windows es el sitio donde se quedan los boletos ' +
    "cuando la impresora no los saca. Importa porque el agente da un boleto por impreso en cuanto " +
    "Windows se lo acepta: si se queda aquí, el sistema dice «impreso» y del papel no sale nada.</p>";

  var esRed = estadoActual && estadoActual.destinoTipo === "red";
  if (!nombre && esRed) {
    caja.innerHTML = explicacion +
      '<p class="quehacer">Esta caja imprime <strong>por red</strong>, directo a la impresora: no ' +
      "pasa por la cola de Windows, así que aquí no hay nada que mirar. Si quieres ver la cola de " +
      "alguna impresora de este PC, usa el botón «Ver cola» de la lista de arriba.</p>";
    return;
  }

  if (!nombre) {
    caja.innerHTML = explicacion +
      '<p class="quehacer">Todavía no se sabe qué impresora usa esta caja: el nombre lo manda el ' +
      "servidor. Puedes mirar la cola de cualquier impresora con el botón «Ver cola» de la lista " +
      "de arriba.</p>";
    return;
  }

  var cabecera = explicacion +
    '<p class="quehacer">Cola de <span class="nombre-impresora">' + esc(nombre) + "</span></p>" +
    porQueNoSale(nombre);

  if (!trabajos) {
    caja.innerHTML = cabecera +
      '<p class="resumen">No se pudo mirar la cola.</p><div class="error-crudo">' +
      esc(error || "motivo desconocido") + "</div>" + botonesCola(nombre, 0);
    return;
  }

  if (!trabajos.length) {
    caja.innerHTML = cabecera +
      '<p class="resumen" style="color:var(--ok)"><strong>La cola está vacía.</strong> Todo lo que ' +
      "se mandó a esta impresora ya salió (o al menos ya no está esperando).</p>" +
      botonesCola(nombre, 0);
    return;
  }

  var atascados = 0;
  var filas = "";
  for (var i = 0; i < trabajos.length; i++) {
    var t = trabajos[i];
    if (t.estado === "atascado") atascados++;
    filas += '<tr class="' + (t.estado === "atascado" ? "atascada" : "") + '">' +
      "<td>" + t.id + "</td>" +
      "<td>" + esc(t.documento) +
      '<div class="quehacer" style="margin-top:2px">' + esc(t.propietario) +
      (t.bytes ? " · " + tamano(t.bytes) : "") + "</div></td>" +
      '<td class="est-' + esc(t.estado) + '">' + esc(t.estado) +
      '<div class="quehacer" style="margin-top:2px">' + esc(t.estadoTexto) + "</div></td>" +
      "<td>" + (t.enviadoEn ? esc(reloj(t.enviadoEn)) : "—") + "</td>" +
      '<td><button class="mini peligro" onclick="cancelarTrabajo(' + t.id + "," + i +
      ')">Cancelar</button></td>' +
      "</tr>";
  }

  var alarma = atascados
    ? '<div class="aviso-fuerte" style="margin-top:12px"><strong>Hay ' + atascados +
      " trabajo(s) atascados aquí</strong>Si eran boletos, el sistema los tiene como impresos y " +
      "el cliente no los recibió. Revisa la impresora (papel, pausa, encendido): en cuanto se " +
      "arregle salen solos, sin cancelar nada.</div>"
    : "";

  caja.innerHTML = cabecera + alarma +
    '<table style="margin-top:12px"><thead><tr><th>Nº</th><th>Documento</th><th>Cómo está</th>' +
    "<th>Enviado</th><th></th></tr></thead><tbody>" + filas + "</tbody></table>" +
    botonesCola(nombre, trabajos.length) +
    '<div class="nota"><strong>Cancelar tira ese papel a la basura.</strong> El boleto no se ' +
    "vuelve a imprimir solo: el sistema ya lo dio por impreso. Cancela solo lo que sepas que no " +
    "hace falta, y si el cliente sí necesita su boleto, vuelve a imprimirlo desde el sistema " +
    "(sale marcado como copia y queda contado).</div>";
}

function botonesCola(nombre, cuantos) {
  return '<div class="fila-botones" style="margin-top:12px">' +
    '<button id="btn-cola" onclick="cargarCola()">Actualizar la cola</button>' +
    (cuantos > 1
      ? '<button class="peligro" onclick="cancelarTodaLaCola()">Cancelar los ' + cuantos +
        " trabajos</button>"
      : "") +
    '<span class="momento" id="momento-cola"></span></div>';
}

function cancelarTrabajo(id, indice) {
  var t = colaActual.trabajos[indice] || { documento: "" };
  var nombre = colaActual.impresora;
  if (!nombre) return;

  var seguro = window.confirm(
    "¿Cancelar el trabajo " + id + " («" + t.documento + "») de la impresora " + nombre + "?\\n\\n" +
    "Ese papel NO va a salir. Si era un boleto, el sistema ya lo tiene como impreso: habrá que " +
    "volver a imprimirlo desde el sistema para que el cliente lo reciba."
  );
  if (!seguro) return;

  pedir("/api/cola/cancelar", { impresora: nombre, id: id }).then(function (r) {
    if (!r.ok) { avisar("momento-cola", "No se pudo cancelar: " + (r.error || "motivo desconocido")); return; }
    avisar("momento-cola", "Cancelado. Queda anotado en agente.log.");
    cargarCola();
  }).catch(function (err) {
    avisar("momento-cola", "No se pudo cancelar: " + err.message);
  });
}

function cancelarTodaLaCola() {
  var nombre = colaActual.impresora;
  var cuantos = colaActual.trabajos.length;
  if (!nombre || !cuantos) return;

  var seguro = window.confirm(
    "¿Cancelar los " + cuantos + " trabajos que hay en la cola de " + nombre + "?\\n\\n" +
    "Ninguno de esos papeles va a salir. Los que fueran boletos, el sistema ya los tiene como " +
    "impresos: habrá que volver a imprimirlos desde el sistema uno por uno."
  );
  if (!seguro) return;

  pedir("/api/cola/cancelar", { impresora: nombre, todos: true }).then(function (r) {
    if (!r.ok) { avisar("momento-cola", "No se pudo vaciar la cola: " + (r.error || "motivo desconocido")); return; }
    avisar("momento-cola", "Cancelados " + r.cancelados + ". Queda anotado en agente.log.");
    cargarCola();
  }).catch(function (err) {
    avisar("momento-cola", "No se pudo vaciar la cola: " + err.message);
  });
}

// ─── Registro ─────────────────────────────────────────────────
function cargarRegistro() {
  var b = document.getElementById("btn-registro");
  b.disabled = true;
  avisar("momento-registro", "Leyendo…");

  return pedir("/api/registro?lineas=200").then(function (r) {
    var caja = document.getElementById("caja-registro");
    if (!r.existe) {
      caja.innerHTML = '<p class="vacio" style="margin-top:12px">Todavía no hay archivo de ' +
        "registro, o no se pudo leer.</p>";
      avisar("momento-registro", "");
      return;
    }
    caja.innerHTML = '<pre class="registro">' + esc(r.lineas.join("\\n")) + "</pre>";
    avisar("momento-registro", "Últimas " + r.lineas.length + " líneas · el archivo pesa " + tamano(r.bytes));
  }).catch(function (err) {
    avisar("momento-registro", "No se pudo leer: " + err.message);
  }).then(function () { b.disabled = false; });
}

/**
 * Un texto plano con todo lo que soporte va a preguntar, listo para pegar.
 *
 * Es lo que sustituye a la llamada de veinte minutos: qué estación es, qué
 * impresora pide el servidor, cómo la ve Windows, qué hay atascado en la
 * cola y las últimas líneas del registro. Se arma con lo que ya está en
 * pantalla más una lectura del registro; no manda nada a ninguna parte.
 */
function copiarInforme() {
  var b = document.getElementById("btn-informe");
  b.disabled = true;

  pedir("/api/registro?lineas=60").then(function (reg) {
    var e = estadoActual || {};
    var l = [];
    l.push("INFORME DEL AGENTE DE IMPRESIÓN");
    l.push("Generado: " + new Date().toString());
    l.push("Versión del agente: " + (e.version || "?"));
    l.push("Estación: " + (e.estacion || "(el servidor no ha contestado)") +
      " · sucursal: " + (e.sucursal || "?"));
    l.push("Impresora que pide el servidor: " + (e.destinoTexto || "?"));
    l.push("Papel: " + (e.anchoCols || "?") + " columnas · codepage " + (e.codepage || "?"));
    l.push("Token puesto: " + ((e.enEjecucion || {}).ESTACION_TOKEN_TAPADO || "?"));
    l.push("Modo simulador: " + (((e.enEjecucion || {}).MODO_SIMULADOR === "archivo")
      ? "SÍ (NO IMPRIME NADA DE VERDAD)" : "no"));
    l.push("Pausado: " + (e.pausa && e.pausa.pausado ? "SÍ, desde hace " + e.pausa.minutos + " min" : "no"));
    l.push("Último contacto con el servidor: " + (e.ultimoLatido || "nunca"));
    if (e.ultimoFallo) l.push("Último fallo con el servidor: " + e.ultimoFallo.mensaje);
    if (e.pendienteReinicio && e.pendienteReinicio.length) {
      l.push("Cambios guardados sin aplicar: " + e.pendienteReinicio.join(", "));
    }

    l.push("");
    l.push("— DIAGNÓSTICO —");
    if (!diagnosticoActual) {
      l.push("(no se llegó a ejecutar)");
    } else {
      for (var i = 0; i < diagnosticoActual.puntos.length; i++) {
        var p = diagnosticoActual.puntos[i];
        l.push("[" + p.nivel.toUpperCase() + "] " + p.titulo + ": " + p.resumen);
      }
    }

    l.push("");
    l.push("— IMPRESORAS DE ESTA PC —");
    if (!impresorasActuales.length) {
      l.push("(ninguna, o no se pudo preguntar a Windows)");
    } else {
      for (var j = 0; j < impresorasActuales.length; j++) {
        var im = impresorasActuales[j];
        l.push("- [" + im.nombre + "] estado=" + im.estadoCrudo + " puerto=" + im.puerto +
          " controlador=" + im.controlador + (im.predeterminada ? " (predeterminada)" : "") +
          " enCola=" + (im.enCola === null ? "?" : im.enCola));
      }
    }

    l.push("");
    l.push("— COLA DE WINDOWS (" + (colaActual.impresora || "sin mirar") + ") —");
    if (!colaActual.trabajos.length) {
      l.push("(vacía o sin mirar)");
    } else {
      for (var k = 0; k < colaActual.trabajos.length; k++) {
        var t = colaActual.trabajos[k];
        l.push("- #" + t.id + " " + t.documento + " · " + t.estado + " · " + t.estadoTexto +
          " · enviado " + (t.enviadoEn || "?"));
      }
    }

    l.push("");
    l.push("— ÚLTIMAS LÍNEAS DE agente.log —");
    l.push(reg.existe ? reg.lineas.join("\\n") : "(no se pudo leer)");

    return copiar(l.join("\\n")).then(function () {
      avisar("momento-registro", "Informe copiado. Pégalo en el chat con soporte.");
    });
  }).catch(function (err) {
    avisar("momento-registro", "No se pudo copiar el informe: " + err.message);
  }).then(function () { b.disabled = false; });
}

// ─── Prueba de impresión ──────────────────────────────────────
function imprimirPrueba() {
  var b = document.getElementById("btn-prueba");
  var caja = document.getElementById("resultado-prueba");
  b.disabled = true;
  b.textContent = "Mandando a la impresora…";
  caja.innerHTML = "";

  pedir("/api/prueba", {}).then(function (r) {
    if (r.ok) {
      caja.innerHTML = '<div class="aviso-flojo" style="background:var(--ok-fondo);border-color:var(--ok);color:var(--ok)">' +
        "<strong>Se mandó a " + esc(r.destino) + ".</strong> " + esc(r.matiz) + "</div>";
    } else {
      caja.innerHTML = '<div class="aviso-fuerte"><strong>No se pudo imprimir</strong>' +
        "Destino: " + esc(r.destino) + '<div class="error-crudo" style="margin-top:8px">' +
        esc(r.error) + "</div></div>";
    }
    refrescarEstado();
    // Si la hoja de prueba se queda en la cola de Windows en vez de salir,
    // es AHÍ donde se ve. Refrescarla sola ahorra el paso que nadie da.
    if (estadoActual && estadoActual.destinoTipo === "windows") cargarCola();
  }).catch(function (err) {
    caja.innerHTML = '<div class="aviso-fuerte"><strong>No se pudo imprimir</strong>' + esc(err.message) + "</div>";
  }).then(function () {
    b.disabled = false;
    b.textContent = "Imprimir hoja de prueba";
  });
}

function verPapel() {
  var caja = document.getElementById("resultado-prueba");
  pedir("/api/prueba-vista").then(function (r) {
    caja.innerHTML = r.vistaPrevia
      ? '<pre class="papel">' + esc(r.vistaPrevia) + "</pre>"
      : '<div class="aviso-flojo">' + esc(r.error || "No se pudo preparar la vista previa") + "</div>";
  });
}

// ─── Configuración ────────────────────────────────────────────
function guardarConfig() {
  var b = document.getElementById("btn-guardar");
  b.disabled = true;
  for (var i = 0; i < CLAVES.length; i++) document.getElementById("mal-" + CLAVES[i]).textContent = "";

  var cambios = {
    API_URL: document.getElementById("API_URL").value.trim(),
    MODO_SIMULADOR: document.getElementById("MODO_SIMULADOR").value,
    LOG_LEVEL: document.getElementById("LOG_LEVEL").value,
    POLL_ESPERA_MS: document.getElementById("POLL_ESPERA_MS").value.trim()
  };
  var tokenNuevo = document.getElementById("ESTACION_TOKEN").value.trim();
  if (tokenNuevo) cambios.ESTACION_TOKEN = tokenNuevo;

  pedir("/api/config", cambios).then(function (r) {
    var momento = document.getElementById("momento-guardar");
    if (r.errores) {
      for (var i = 0; i < r.errores.length; i++) {
        var campo = document.getElementById("mal-" + r.errores[i].clave);
        if (campo) campo.textContent = r.errores[i].mensaje;
      }
      momento.textContent = "No se guardó nada: revisa lo marcado en rojo.";
      return;
    }
    if (r.error) { momento.textContent = "No se pudo guardar: " + r.error; return; }

    document.getElementById("ESTACION_TOKEN").value = "";
    formularioTocado = false;
    momento.textContent = r.necesitanReinicio.length
      ? "Guardado. Hay que reiniciar el agente para: " + r.necesitanReinicio.join(", ") + "."
      : "Guardado y aplicado al momento.";
    refrescarEstado();
  }).catch(function (err) {
    document.getElementById("momento-guardar").textContent = "No se pudo guardar: " + err.message;
  }).then(function () { b.disabled = false; });
}

for (var k = 0; k < CLAVES.length; k++) {
  document.getElementById(CLAVES[k]).addEventListener("input", function () { formularioTocado = true; });
  document.getElementById(CLAVES[k]).addEventListener("change", function () { formularioTocado = true; });
}

/**
 * Cada consulta a la cola es un powershell.exe: medio segundo largo de una
 * PC que tiene que estar imprimiendo. Por eso NO se refresca con el resto
 * de la página (cada 3 s), y solo se repite sola cuando se dan las dos
 * condiciones en las que sirve de algo: que haya algo atascado ahí dentro y
 * que alguien esté mirando la pestaña. Con la cola vacía, o con la ventana
 * detrás de otra, no se pregunta nada.
 */
var SEGUNDOS_REFRESCO_COLA = 20;

function quizaRefrescarCola() {
  if (document.hidden) return;
  if (!colaActual.impresora || !colaActual.trabajos.length) return;
  cargarCola();
}

refrescarEstado()
  .then(lanzarDiagnostico)
  .then(function () { return cargarCola(); });

setInterval(refrescarEstado, 3000);
setInterval(quizaRefrescarCola, SEGUNDOS_REFRESCO_COLA * 1000);
</script>
</body>
</html>
`
