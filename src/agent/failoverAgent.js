const fs = require('fs');
const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class FailoverAgent {
  constructor(env = 'prod') {
    this.config = JSON.parse(fs.readFileSync('config/apis.json'));
    // Si es prod usa OpenCode local, si es test usa el mock
    this.opencodeEndpoint = env === 'test' ? 'http://localhost:3002/mock-api' : 'http://127.0.0.1:4096/v1/chat/completions';
  }

  async callAPI(providerName, requestData) {
    const keys = this.config[providerName] || [];
    let currentIndex = 0;

    // Intentamos hasta quedarnos sin keys de respaldo
    while (currentIndex < keys.length) {
      try {
        console.log(`[FailoverAgent] Enviando petición a OpenCode local... (Intento ${currentIndex + 1})`);
        
        // Petición a OpenCode local (o al mock). OpenCode se encarga de hablar con OpenAI/Mistral.
        const response = await axios({
          method: 'POST',
          url: this.opencodeEndpoint,
          data: requestData,
          timeout: 10000
        });
        
        console.log(`[FailoverAgent] ¡Éxito! OpenCode procesó la petición.`);
        return response.data;

      } catch (error) {
        console.error(`[FailoverAgent] OpenCode devolvió un error:`, error.response?.data || error.message);
        
        currentIndex++;
        
        if (currentIndex < keys.length) {
          const nextApiKey = keys[currentIndex];
          const modelName = requestData?.model; // Extraemos el modelo de la petición original
          console.log(`[FailoverAgent] Cambiando OpenCode a la siguiente key de ${providerName}...`);
          
          try {
            // Actualizamos la key en el OpenCode local y aseguramos que use el mismo modelo
            let cmd = `opencode /connect ${providerName} --key ${nextApiKey}`;
            if (modelName) {
              cmd += ` --model ${modelName}`;
            }
            
            await execPromise(cmd);
            console.log(`[FailoverAgent] Key (y modelo) actualizados en OpenCode. Reintentando...`);
            // Esperar un poco para que OpenCode asimile la nueva key si es necesario
            await new Promise(r => setTimeout(r, 1000));
          } catch (err) {
            console.error("[FailoverAgent] Error al ejecutar /connect en OpenCode:", err.message);
          }
        } else {
          throw new Error(`Todas las keys de backup para ${providerName} han fallado. Último error: ${error.message}`);
        }
      }
    }
  }
}

module.exports = FailoverAgent;