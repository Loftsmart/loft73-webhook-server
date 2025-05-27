const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// ================================
// CORS DEFINITIVO - APPROCCIO ESPERTO
// ================================

// CORS Headers manuali - PIÙ AGGRESSIVO DI MIDDLEWARE
app.use((req, res, next) => {
  // PERMETTI TUTTO - NESSUNA RESTRIZIONE
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,HEAD,PATCH');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Credentials', 'false'); // false per wildcard
  res.header('Access-Control-Max-Age', '86400');
  
  // HEADERS AGGIUNTIVI PER CSP E SICUREZZA
  res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
  res.header('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  
  // DISABLE CSP CHE CAUSA PROBLEMI
  res.header('Content-Security-Policy', '');
  res.header('X-Content-Security-Policy', '');
  res.header('X-WebKit-CSP', '');
  
  // RISPOSTA IMMEDIATA PER PREFLIGHT
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  next();
});

// Middleware per JSON
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// LOGGING AVANZATO
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  console.log(`Origin: ${req.headers.origin || 'NONE'}`);
  console.log(`User-Agent: ${req.headers['user-agent'] || 'NONE'}`);
  console.log(`Headers:`, Object.keys(req.headers));
  next();
});

// ================================
// ENDPOINTS PRINCIPALI
// ================================

// ROOT - Test connessione
app.get('/', (req, res) => {
  const response = {
    status: 'online',
    service: 'LOFT.73 Webhook Server - CORS ULTIMATE',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    cors: 'AGGRESSIVO',
    headers_sent: {
      'access-control-allow-origin': res.getHeader('Access-Control-Allow-Origin'),
      'access-control-allow-methods': res.getHeader('Access-Control-Allow-Methods'),
      'access-control-allow-headers': res.getHeader('Access-Control-Allow-Headers')
    },
    message: '🔥 CORS DEFINITIVO ATTIVO - NESSUNA RESTRIZIONE'
  };
  
  console.log('🎯 ROOT REQUEST - Sending response:', response);
  res.json(response);
});

// ENDPOINT DEBUG SPECIFICO
app.get('/debug-cors', (req, res) => {
  res.json({
    success: true,
    message: 'CORS DEBUG ENDPOINT',
    request_headers: req.headers,
    response_headers: {
      'Access-Control-Allow-Origin': res.getHeader('Access-Control-Allow-Origin'),
      'Access-Control-Allow-Methods': res.getHeader('Access-Control-Allow-Methods'),
      'Access-Control-Allow-Headers': res.getHeader('Access-Control-Allow-Headers')
    },
    timestamp: new Date().toISOString()
  });
});

// HEALTH CHECK
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// ================================
// SHOPIFY ENDPOINTS
// ================================

// Test Shopify - VERSIONE ROBUSTA
app.post('/shopify/test', async (req, res) => {
  console.log('🔐 SHOPIFY TEST REQUEST:', req.body);
  
  const { storeUrl, accessToken } = req.body;
  
  if (!storeUrl || !accessToken) {
    console.log('❌ Missing credentials');
    return res.status(400).json({
      success: false,
      error: 'storeUrl and accessToken required',
      received: { storeUrl: !!storeUrl, accessToken: !!accessToken }
    });
  }

  try {
    // IMPORTA fetch dinamicamente
    const fetch = (await import('node-fetch')).default;
    
    // Pulisci storeUrl
    const cleanStoreUrl = storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const shopifyUrl = `https://${cleanStoreUrl}/admin/api/2023-10/shop.json`;
    
    console.log(`🔗 Testing: ${shopifyUrl}`);
    
    const response = await fetch(shopifyUrl, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        'User-Agent': 'LOFT73-Webhook-Server/2.0'
      },
      timeout: 10000
    });

    console.log(`📊 Shopify Response: ${response.status}`);

    if (response.ok) {
      const shopData = await response.json();
      console.log('✅ Shopify SUCCESS');
      
      res.json({
        success: true,
        message: 'Shopify authentication successful',
        shopInfo: {
          name: shopData.shop?.name || 'Unknown',
          domain: shopData.shop?.domain || cleanStoreUrl,
          id: shopData.shop?.id || 'Unknown',
          email: shopData.shop?.email || 'Unknown'
        },
        endpoint_tested: shopifyUrl,
        timestamp: new Date().toISOString()
      });
    } else {
      const errorText = await response.text();
      console.log(`❌ Shopify FAILED: ${response.status} - ${errorText}`);
      
      res.status(400).json({
        success: false,
        error: 'Shopify authentication failed',
        details: `HTTP ${response.status}`,
        response_body: errorText.substring(0, 500),
        endpoint_tested: shopifyUrl,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('💥 Shopify ERROR:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during Shopify test',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

// WEBHOOK STATUS
app.get('/webhook-status', (req, res) => {
  res.json({
    status: 'active',
    service: 'webhook-listener-v2',
    endpoints: [
      '/shopify/webhook/back-in-stock',
      '/shopify/webhook/product-update',
      '/debug-cors'
    ],
    cors: 'ULTIMATE',
    timestamp: new Date().toISOString()
  });
});

// WEBHOOK BACK IN STOCK
app.post('/shopify/webhook/back-in-stock', (req, res) => {
  console.log('📦 BACK IN STOCK WEBHOOK:', req.body);
  
  res.json({
    received: true,
    webhook: 'back-in-stock',
    timestamp: new Date().toISOString(),
    message: 'Webhook processed successfully'
  });
});

// ================================
// ERROR HANDLING DEFINITIVO
// ================================

// 404 - NOT FOUND
app.use('*', (req, res) => {
  console.log(`❌ 404 - ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    available_endpoints: [
      'GET /',
      'GET /health',
      'GET /debug-cors',
      'POST /shopify/test',
      'GET /webhook-status'
    ],
    timestamp: new Date().toISOString()
  });
});

// ERROR HANDLER GLOBALE
app.use((err, req, res, next) => {
  console.error('💥 GLOBAL ERROR:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// ================================
// START SERVER
// ================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('🔥 ===================================');
  console.log('🔥 LOFT.73 SERVER - CORS ULTIMATE');
  console.log(`🔥 PORT: ${PORT}`);
  console.l
