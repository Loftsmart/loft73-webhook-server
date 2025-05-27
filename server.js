const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ================================
// CORS CONFIGURATION - FIX PRINCIPALE!
// ================================

// Configura CORS per permettere richieste da claude.ai
const corsOptions = {
  origin: [
    'https://claude.ai',
    'https://*.claude.ai',
    'http://localhost:3000',
    'http://localhost:3001',
    'https://loft73-webhook-server-production.up.railway.app',
    '*' // Permette TUTTI i domini per debug (puoi rimuovere dopo test)
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  optionsSuccessStatus: 200 // Per compatibilità con browser legacy
};

// APPLICA CORS A TUTTE LE ROUTE
app.use(cors(corsOptions));

// Middleware per JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================================
// LOGGING MIDDLEWARE
// ================================
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// ================================
// ROUTE PRINCIPALI
// ================================

// Home endpoint - Test connessione
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'LOFT.73 Shopify Webhook Server',
    version: '1.1.0',  // Aggiornato per CORS fix
    timestamp: new Date().toISOString(),
    cors: 'enabled',
    message: '🎉 CORS configurato per claude.ai!'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ================================
// SHOPIFY ENDPOINTS
// ================================

// Test autenticazione Shopify
app.post('/shopify/test', async (req, res) => {
  const { storeUrl, accessToken } = req.body;
  
  if (!storeUrl || !accessToken) {
    return res.status(400).json({
      success: false,
      error: 'storeUrl and accessToken required'
    });
  }

  try {
    // Costruisce URL per test Shopify
    const shopifyUrl = `https://${storeUrl}/admin/api/2023-10/shop.json`;
    
    console.log(`Testing Shopify connection: ${shopifyUrl}`);
    
    // Test chiamata a Shopify
    const fetch = require('node-fetch');
    const response = await fetch(shopifyUrl, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const shopData = await response.json();
      console.log('✅ Shopify test successful');
      
      res.json({
        success: true,
        message: 'Shopify authentication successful',
        shopInfo: {
          name: shopData.shop?.name || 'Unknown',
          domain: shopData.shop?.domain || storeUrl,
          id: shopData.shop?.id || 'Unknown'
        },
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`❌ Shopify test failed: ${response.status}`);
      const errorText = await response.text();
      
      res.status(400).json({
        success: false,
        error: 'Shopify authentication failed',
        details: `HTTP ${response.status}: ${errorText}`,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ Shopify test error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during Shopify test',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ================================
// WEBHOOK ENDPOINTS
// ================================

// Webhook status
app.get('/webhook-status', (req, res) => {
  res.json({
    status: 'active',
    service: 'webhook-listener',
    endpoints: [
      '/shopify/webhook/back-in-stock',
      '/shopify/webhook/product-update'
    ],
    timestamp: new Date().toISOString()
  });
});

// Webhook per back in stock
app.post('/shopify/webhook/back-in-stock', (req, res) => {
  console.log('📦 Back in stock webhook received:', req.body);
  
  // Qui processerai il webhook di Shopify
  // Per ora salviamo solo il log
  
  res.status(200).json({
    received: true,
    timestamp: new Date().toISOString(),
    message: 'Back in stock webhook processed'
  });
});

// Webhook generico prodotti
app.post('/shopify/webhook/product-update', (req, res) => {
  console.log('🔄 Product update webhook received:', req.body);
  
  res.status(200).json({
    received: true,
    timestamp: new Date().toISOString(),
    message: 'Product update webhook processed'
  });
});

// ================================
// ERROR HANDLING
// ================================

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Error handler globale
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// ================================
// START SERVER
// ================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 =================================');
  console.log(`🚀 LOFT.73 Server STARTED`);
  console.log(`🚀 Port: ${PORT}`);
  console.log(`🚀 CORS: ENABLED for claude.ai`);
  console.log(`🚀 Time: ${new Date().toISOString()}`);
  console.log('🚀 =================================');
});

module.exports = app;
