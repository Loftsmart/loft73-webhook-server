const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// ================================
// CORS AGGRESSIVO + JSONP SUPPORT
// ================================
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Credentials', 'false');
  
  // HEADERS PER CSP BYPASS
  res.header('Content-Security-Policy', '');
  res.header('X-Content-Security-Policy', '');
  res.header('X-Frame-Options', 'ALLOWALL');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ================================
// JSONP ENDPOINTS - CSP BYPASS
// ================================

// Root endpoint - JSONP Support
app.get('/', (req, res) => {
  const data = {
    status: 'online',
    service: 'LOFT.73 Server JSONP',
    version: '4.0.0',
    cors: 'ULTIMATE',
    jsonp: 'ENABLED',
    csp_bypass: 'ACTIVE',
    message: '🔥 JSONP BYPASS ATTIVO!'
  };
  
  // Se è richiesta JSONP
  if (req.query.callback) {
    res.header('Content-Type', 'application/javascript');
    res.send(`${req.query.callback}(${JSON.stringify(data)});`);
    return;
  }
  
  res.json(data);
});

// Test connessione JSONP
app.get('/test-connection', (req, res) => {
  const data = {
    success: true,
    message: 'Server raggiungibile via JSONP',
    timestamp: new Date().toISOString(),
    method: 'JSONP_BYPASS'
  };
  
  if (req.query.callback) {
    res.header('Content-Type', 'application/javascript');
    res.send(`${req.query.callback}(${JSON.stringify(data)});`);
    return;
  }
  
  res.json(data);
});

// Shopify test JSONP
app.get('/shopify/test-jsonp', (req, res) => {
  const { storeUrl, accessToken, callback } = req.query;
  
  const data = {
    success: true,
    message: 'Shopify test simulato via JSONP',
    shopInfo: {
      name: 'Test Store JSONP',
      domain: storeUrl || 'test.myshopify.com',
      method: 'JSONP_BYPASS'
    },
    timestamp: new Date().toISOString()
  };
  
  if (callback) {
    res.header('Content-Type', 'application/javascript');
    res.send(`${callback}(${JSON.stringify(data)});`);
    return;
  }
  
  res.json(data);
});

// ================================
// TRADITIONAL ENDPOINTS (BACKUP)
// ================================

app.post('/shopify/test', (req, res) => {
  const { storeUrl, accessToken } = req.body;
  
  res.json({
    success: true,
    message: 'Test Shopify simulato',
    shopInfo: {
      name: 'Test Store',
      domain: storeUrl || 'unknown'
    },
    method: 'POST_TRADITIONAL'
  });
});

app.get('/webhook-status', (req, res) => {
  const data = {
    status: 'active',
    service: 'webhook-listener',
    jsonp: 'enabled',
    endpoints: [
      '/test-connection?callback=myCallback',
      '/shopify/test-jsonp?callback=myCallback'
    ]
  };
  
  if (req.query.callback) {
    res.header('Content-Type', 'application/javascript');
    res.send(`${req.query.callback}(${JSON.stringify(data)});`);
    return;
  }
  
  res.json(data);
});

// ================================
// IFRAME SANDBOX ENDPOINT
// ================================
app.get('/sandbox', (req, res) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <title>LOFT.73 Sandbox</title>
    <meta charset="utf-8">
</head>
<body>
    <h1>🔥 LOFT.73 Server Sandbox</h1>
    <p>Status: <span style="color: green; font-weight: bold;">ONLINE</span></p>
    <p>JSONP: <span style="color: blue; font-weight: bold;">ENABLED</span></p>
    <p>CSP Bypass: <span style="color: orange; font-weight: bold;">ACTIVE</span></p>
    
    <script>
        // Test JSONP callback
        function testCallback(data) {
            console.log('JSONP Success:', data);
            document.body.innerHTML += '<div style="color: green;">✅ JSONP Test Successful!</div>';
        }
        
        // Auto-test JSONP
        const script = document.createElement('script');
        script.src = '/test-connection?callback=testCallback';
        document.head.appendChild(script);
        
        // PostMessage per parent
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'LOFT73_READY',
                status: 'online',
                method: 'iframe_sandbox'
            }, '*');
        }
    </script>
</body>
</html>`;
  
  res.header('Content-Type', 'text/html');
  res.send(html);
});

// ================================
// ERROR HANDLING
// ================================
app.use('*', (req, res) => {
  const data = {
    error: 'Endpoint not found',
    path: req.originalUrl,
    available: [
      '/?callback=myFunc',
      '/test-connection?callback=myFunc',
      '/shopify/test-jsonp?callback=myFunc',
      '/sandbox'
    ]
  };
  
  if (req.query.callback) {
    res.header('Content-Type', 'application/javascript');
    res.send(`${req.query.callback}(${JSON.stringify(data)});`);
    return;
  }
  
  res.status(404).json(data);
});

app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  
  const data = {
    error: 'Internal server error',
    message: err.message
  };
  
  if (req.query.callback) {
    res.header('Content-Type', 'application/javascript');
    res.send(`${req.query.callback}(${JSON.stringify(data)});`);
    return;
  }
  
  res.status(500).json(data);
});

// ================================
// START SERVER
// ================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('🔥 =====================================');
  console.log('🔥 LOFT.73 SERVER - JSONP BYPASS MODE');
  console.log(`🔥 PORT: ${PORT}`);
  console.log('🔥 CORS: ULTIMATE');
  console.log('🔥 JSONP: ENABLED');
  console.log('🔥 CSP BYPASS: ACTIVE');
  console.log('🔥 IFRAME SANDBOX: READY');
  console.log('🔥 =====================================');
});

module.exports = app;
