const fs = require('fs');
const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const os = require('os');
const path = require('path');
const execPromise = util.promisify(exec);

class FailoverAgent {
  constructor(env = 'prod') {
    this.env = env;
    this.config = JSON.parse(fs.readFileSync('config/apis.json'));
    // Si es prod usa OpenCode local, si es test usa el mock
    this.opencodeEndpoint = env === 'test' ? 'http://localhost:3002/mock-api' : 'http://127.0.0.1:4096/v1/chat/completions';
  }

  async callAPI(providerName, requestData) {
    let currentProvider = providerName;
    let currentRequestData = { ...requestData };
    
    // Intentamos hasta que encontremos una clave exitosa o se agoten todos los proveedores
    while (true) {
      const keys = this.config[currentProvider] || [];
      
      // 1. Obtener la clave activa actual desde auth.json
      const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
      let activeKey;
      if (fs.existsSync(authPath)) {
        try {
          const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
          activeKey = auth[currentProvider]?.key;
        } catch (e) {
          console.error('[FailoverAgent] Error leyendo auth.json:', e.message);
        }
      }

      // 2. Determinar el siguiente índice de clave
      let nextIndex = 0;
      if (activeKey) {
        const idx = keys.indexOf(activeKey);
        if (idx !== -1) {
          nextIndex = idx + 1;
        }
      }

      let nextApiKey;
      if (nextIndex < keys.length) {
        nextApiKey = keys[nextIndex];
      } else {
        // Rotar al siguiente proveedor
        const providers = Object.keys(this.config);
        const currentProvIdx = providers.indexOf(currentProvider);
        let found = false;

        for (let i = 1; i <= providers.length; i++) {
          const nextProvIdx = (currentProvIdx + i) % providers.length;
          const prov = providers[nextProvIdx];
          if (this.config[prov] && this.config[prov].length > 0) {
            currentProvider = prov;
            nextApiKey = this.config[prov][0];
            found = true;
            break;
          }
        }

        if (!found || !nextApiKey) {
          throw new Error(`Todas las keys de todos los proveedores han fallado.`);
        }
      }

      try {
        console.log(`[FailoverAgent] Enviando petición a OpenCode local... (Proveedor: ${currentProvider})`);
        
        const response = await axios({
          method: 'POST',
          url: this.opencodeEndpoint,
          data: currentRequestData,
          timeout: 10000
        });
        
        console.log(`[FailoverAgent] ¡Éxito! OpenCode procesó la petición.`);
        return response.data;

      } catch (error) {
        console.error(`[FailoverAgent] OpenCode devolvió un error:`, error.response?.data || error.message);
        
        console.log(`[FailoverAgent] Cambiando OpenCode a la siguiente key/proveedor...`);
        
        // 3. Escribir la nueva clave en auth.json
        if (fs.existsSync(authPath)) {
          try {
            const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
            if (!auth[currentProvider]) {
              auth[currentProvider] = { type: 'api' };
            }
            auth[currentProvider].key = nextApiKey;
            fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), 'utf8');
            console.log(`[FailoverAgent] Clave actualizada en auth.json.`);
          } catch (err) {
            console.error("[FailoverAgent] Error al escribir en auth.json:", err.message);
          }
        }

        // 4. Si es prod, reiniciar el servidor local de OpenCode para cargar cambios
        if (this.env !== 'test') {
          console.log(`[FailoverAgent] Reiniciando servidor local de OpenCode...`);
          try {
            if (process.platform === 'win32') {
              await execPromise('taskkill /F /IM opencode.exe').catch(() => {});
              await execPromise('taskkill /F /IM node.exe /FI "WINDOWTITLE eq opencode*"').catch(() => {});
            } else {
              await execPromise('pkill -f "opencode serve"').catch(() => {});
            }
            await new Promise(r => setTimeout(r, 1000));
            const { spawn } = require('child_process');
            const proc = spawn('opencode', ['serve', '--port=4096'], {
              shell: true,
              detached: true,
              stdio: 'ignore'
            });
            proc.unref();
            await new Promise(r => setTimeout(r, 2000));
            console.log(`[FailoverAgent] Servidor de OpenCode reiniciado.`);
          } catch (err) {
            console.error("[FailoverAgent] Error al reiniciar OpenCode:", err.message);
          }
        } else {
          // En test, solo esperamos un momento para simular
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }
}

module.exports = FailoverAgent;