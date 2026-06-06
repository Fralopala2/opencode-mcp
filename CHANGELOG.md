# Change Log

All notable changes to the "opencode-mcp" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [1.0.4] - 2026-06-06

### Corrección de Bugs
- **Race condition en `activeStream`**: Asegurado que `handleTimeout` verifique existencia y borre antes de emitir, eliminando la doble emisión `done:true`.
- **Doble `done:true` en timeout**: Separada la lectura/borrado de `activeStream` de la llamada a `abortSession(true)`.
- **Múltiples `session.idle` ignorados**: Agregado guard `activeStream.has(sessionId)` para evitar procesar idles duplicados.
- **`sendPrompt` ahora espera la respuesta**: Implementado `pendingPrompts` Map que resuelve la promesa al recibir `done:true`, previniendo que el frontend quede colgado si la conexión SSE se cae.
- **`lastPromptInfo.model` ya no se muta en failover**: Creada variable local `failoverModel` en lugar de sobrescribir `this.lastPromptInfo.model`.
- **`partsToDisplayText` con placeholder incorrecto**: Agregada verificación `parts.length > 0` para no mostrar "(sin contenido de texto)" cuando hay partes de herramientas.
- **SSE parsing con saltos de línea mixtos CRLF/LF**: Cambiado `split('\n')` por `split(/\r?\n/)` y `split('\n\n')` por `split(/\r?\n\r?\n/)`; agregado `.trim()` al extraer JSON de `data:`.
- **Ruta relativa en `failoverAgent.js`**: Reemplazado `'config/apis.json'` por `path.resolve(__dirname, '..', '..', 'config', 'apis.json')`.
- **`addOpenFiles` con manejo de errores**: Envuelto `openTextDocument` en try/catch para ignorar tabs que no se pueden abrir como texto.
- **SSE caída permanente**: Emitido `done:true` con mensaje de error cuando la reconexión agota los intentos.

## [1.0.3] - 2026-06-06

### Mejoras y Limpieza
- Documentada la configuración `opencode.quickActions` en `README.md`.
- Eliminado archivo de prueba manual redundante `src/testFailover.js` para mantener el repositorio limpio.

## [1.0.2] - 2026-06-06

### Seguridad
- Reforzada CSP del webview: restringido `img-src` a solo `data: {{cspSource}}` (eliminados `https:` y `vscode-resource:`).
- Sanitizada la función `renderBody()` en el frontend para escapar HTML inline code y prevenir XSS.
- Reemplazado `child_process.exec` por `execFile` en el comando `git diff` para eliminar la dependencia en shell.
- Ruta de `auth.json` ahora configurable vía variable de entorno `OPENCODE_AUTH_PATH`.
- Eliminado `taskkill /F /IM node.exe` en el failover agent para evitar matar procesos Node.js no relacionados.

## [1.0.1] - 2026-06-05

- Refactor de `opencode-adapter.mjs` para usar HTTP API nativa.
- Creado subagente `@opencode-local` para integración con Antigravity.
- Añadida sección de Solución de problemas en `README.md`.

## [1.0.0] - 2026-06-04

- Panel lateral de chat conectado a OpenCode local (HTTP API)
- Auto-arranque de `opencode serve`, selector de agents, streaming SSE
- Contexto: archivo actual, selección, archivos abiertos
- Configuración de URL, auth, agente por defecto y permisos