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

<h2>Diagnóstico</h2>
<div id="diagnostico"></div>
<div class="fila-botones">
  <button class="principal" id="btn-diag" onclick="lanzarDiagnostico()">Comprobar de nuevo</button>
  <span class="momento" id="momento-diag"></span>
</div>

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
</div>

<h2>Actividad reciente</h2>
<div class="tarjeta" id="actividad"></div>

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
  var banderas = "";
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
  if (!formularioTocado) rellenarFormulario(e);
  document.getElementById("token-tapado").textContent = e.enEjecucion.ESTACION_TOKEN_TAPADO;
  document.getElementById("pie").innerHTML =
    "Esta página solo se ve desde esta PC (127.0.0.1:" + esc(e.uiPuerto) + "). " +
    "El agente lleva encendido desde las " + esc(reloj(e.iniciadoEn)) + ". " +
    "El registro completo está en <code>agente.log</code>, en la carpeta del agente.";
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

function refrescarEstado() {
  return pedir("/api/estado").then(function (e) {
    if (!e.error) pintarEstado(e);
  }).catch(function () {
    document.getElementById("veredicto").className = "veredicto mal";
    document.getElementById("veredicto").innerHTML =
      "<span>El agente dejó de responder. ¿Se cerró la ventana donde estaba corriendo?</span>";
  });
}

// ─── Diagnóstico ──────────────────────────────────────────────
function pintarDiagnostico(d) {
  var html = "";
  var hayError = false, hayAviso = false, hayDesconocido = false;

  for (var i = 0; i < d.puntos.length; i++) {
    var p = d.puntos[i];
    if (p.nivel === "error") hayError = true;
    if (p.nivel === "aviso") hayAviso = true;
    if (p.nivel === "desconocido") hayDesconocido = true;

    var lista = "";
    if (p.lista) {
      lista = '<div class="lista"><strong>' + esc(p.tituloLista) + "</strong>";
      if (p.lista.length) {
        lista += "<ul>";
        for (var j = 0; j < p.lista.length; j++) lista += "<li><code>" + esc(p.lista[j]) + "</code></li>";
        lista += "</ul>";
      } else {
        lista += '<p class="vacio" style="margin:4px 0 0">Ninguna.</p>';
      }
      lista += "</div>";
    }

    html += '<div class="tarjeta"><div class="cabecera-punto">' +
      '<span class="punto ' + esc(p.nivel) + '"></span>' +
      '<span class="titulo-punto">' + esc(p.titulo) + "</span>" +
      '<span class="etiqueta ' + esc(p.nivel) + '">' +
      (p.nivel === "ok" ? "bien" : p.nivel === "error" ? "mal" : p.nivel === "aviso" ? "ojo" : "sin saber") +
      "</span></div>" +
      '<p class="resumen">' + esc(p.resumen) + "</p>" +
      '<p class="quehacer">' + esc(p.queHacer) + "</p>" + lista + "</div>";
  }

  document.getElementById("diagnostico").innerHTML = html;
  document.getElementById("momento-diag").textContent = "Comprobado a las " + reloj(d.at);

  var v = document.getElementById("veredicto");
  if (hayError) {
    v.className = "veredicto mal";
    v.innerHTML = "<span>Hay algo que no está bien. Mira los puntos en rojo.</span>";
  } else if (estadoActual && estadoActual.enEjecucion.MODO_SIMULADOR === "archivo") {
    v.className = "veredicto mal";
    v.innerHTML = "<span>El simulador está puesto: no va a salir ni un boleto por la impresora.</span>";
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

refrescarEstado().then(lanzarDiagnostico);
setInterval(refrescarEstado, 3000);
</script>
</body>
</html>
`
