const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['https://claude.ai', 'http://localhost:3000', '*'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'LOFT.73 Shopify Webhook Server',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Test Shopify endpoint
app.post('/shopify/test', (req, res) => {
  const { storeUrl, accessToken } = req.body;
  
  if (!storeUrl || !accessToken) {
    return res.status(400).json({
      success: false,
      error: 'Missing storeUrl or accessToken'
    });
  }

  res.json({
    success: true,
    message: 'Shopify connection test - server working',
    timestamp: new Date().toISOString()
  });
});

// Webhook status
app.get('/webhook-status', (req, res) => {
  res.json({
    status: 'active',
    server: 'Railway',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 LOFT.73 Webhook Server');
  console.log(`🚀 Server running on port ${PORT}`);
});
