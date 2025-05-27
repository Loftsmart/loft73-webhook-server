const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// ================================
// CORS AGGRESSIVO - ULTRA SEMPLICE
// ================================
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Max-Age', '86400');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

app.use(express.json());

// ================================
// ENDPOINTS BASILARI
// ================================

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'LOFT.73 Server MINIMAL',
    version: '3.0.0',
    cors: 'ULTIMATE',
    message: '🔥 FUNZIONA GARANTITO!'
  });
});

app.post('/shopify/test', (req, res) => {
  const { storeUrl, accessToken } = req.body;
  
  if (!storeUrl || !accessToken) {
    return res.status(400).json({
      success: false,
      error: 'Credenziali mancanti'
    });
  }

  // SIMULAZIONE SUCCESS PER TEST
  res.json({
    success: true,
    message: 'Test Shopify simulato',
    shopInfo: {
      name: 'Test Store',
      domain: storeUrl
    }
  });
});

app.get('/webhook-status', (req, res) => {
  res.json({
    status: 'active',
    cors: 'ULTIMATE'
  });
});

// ERROR HANDLER
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// START SERVER
app.listen(PORT, () => {
  console.log(`🔥 SERVER MINIMAL STARTED - PORT ${PORT}`);
});

module.exports = app;
