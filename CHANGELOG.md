# Change Log

All notable changes to the "opencode-mcp" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Released]

## [1.0.12] - 2026-06-10

### Documentación
- **README**: Corregida la alineación visual de las capturas de pantalla para el Marketplace usando tablas Markdown.
- **Marketplace**: Actualizadas las instrucciones de instalación añadiendo los enlaces directos a la tienda.

## [1.0.11] - 2026-06-10

### Nuevas Funcionalidades y Refactorización
- **OpenCodeService**: Nuevo servicio para gestionar conexiones del servidor, sesiones y el ciclo de vida del streaming.
- **Webview Controller**: Implementada lógica del controlador para la UI del chat, estado del streaming y seguimiento de costos.
- **Webview UI**: Añadida implementación de la interfaz de chat y seguimiento de ejecución de herramientas.
- **Branding**: Actualizada metadata de la extensión, branding y URLs de las imágenes del README.

## [1.0.8] - 2026-06-07

### Seguridad y Optimización
- **Protección de API Keys**: Se migró el almacenamiento de llaves maestras de failover de `apis.json` al almacenamiento seguro del sistema (SecretStorage). Se añadieron los comandos `opencode.setApiKeys` y `opencode.clearApiKeys`.
- **Límite de memoria**: Los archivos adjuntos al contexto se limitan a 1MB para prevenir cuelgues o problemas de tokens.
- **Soporte Multi-idioma (i18n)**: La interfaz y los comandos ahora se adaptan automáticamente al español o al inglés según la configuración de VS Code.

## [1.0.7] - 2026-06-07

### Integración con Git
- **Contexto de Git**: Nuevo botón en la barra de herramientas para añadir información completa del repositorio al contexto.
- **Detalles incluidos**: Branch actual, estado del repositorio (archivos modificados/staged), y los últimos 5 commits.
- **Nuevo comando**: `opencode.addGitContext` disponible para añadir información de Git rápidamente.
- **Sincronización en tiempo real**: Actualización automática de la información de Git en la interfaz mediante eventos `gitInfoUpdate`.

## [1.0.6] - 2026-06-07

### Mejoras en UI
- **Separación de controles**: Extraídos los selectores de "Agente" y "Modo" a sus propios botones desplegables independientes en la barra superior.
- **Acceso directo a opciones**: El botón de "Configuración" ahora filtra y abre directamente los ajustes específicos de la extensión (`@ext:local.opencode-mcp-vscode`).
- **Filtrado de agentes internos**: Se ocultan los agentes del sistema (`plan`, `compaction`, `summary`, `title`) del menú para evitar errores conversacionales.
- **Panel de costos**: Añadido un botón de cerrar explícito en la cabecera del panel de costos.

## [1.0.5] - 2026-06-07
### Mejoras en UI
- **Selección de botones**: Reemplazados selectores frágiles por IDs específicos en el frontend.
- **Feedback visual**: Implementada respuesta visual en botones de herramientas al hacer clic.
- **Menú de contexto**: Opciones expandidas con botones dedicados (archivo actual, selección, archivos abiertos).
- **Eventos seguros**: Validación de existencia de elementos al registrar eventos para evitar errores de inicialización.

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