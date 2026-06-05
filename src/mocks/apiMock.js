const express = require('express');
const app = express();

let attempts = 0;

app.post('/mock-api', (req, res) => {
  attempts++;
  if (attempts === 1) {
    // Simulamos que OpenCode devuelve el 429 del proveedor original
    res.status(429).json({ error: "Límite de tokens alcanzado" });
  } else {
    // Al segundo intento (después del /connect), simulamos éxito
    res.json({ data: "Respuesta exitosa de OpenCode con la nueva key" });
  }
});

app.listen(3002, () => {
  console.log("Mock APIs running on http://localhost:3002");
});