const express = require('express');
const app = express();

// Mock de API 1 (fallará con 429)
app.get('/mock-api-1', (req, res) => {
  res.status(429).json({ error: "Límite de tokens alcanzado" });
});

// Mock de API 2 (éxito)
app.get('/mock-api-2', (req, res) => {
  res.json({ data: "Respuesta exitosa de API 2" });
});

app.listen(3002, () => {
  console.log("Mock APIs running on http://localhost:3002");
});