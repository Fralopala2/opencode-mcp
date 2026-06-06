# Change Log

All notable changes to the "opencode-mcp" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Seguridad
- Reforzada CSP del webview: restringido `img-src` a solo `data: {{cspSource}}` (eliminados `https:` y `vscode-resource:`).
- Sanitizada la función `renderBody()` en el frontend para escapar HTML inline code y prevenir XSS.
- Reemplazado `child_process.exec` por `execFile` en el comando `git diff` para eliminar la依赖encia en shell.
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