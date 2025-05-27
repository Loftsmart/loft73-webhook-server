// server.js - Webhook Server per Shopify + LOFT.73 Dashboard
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'https://claude.ai', '*'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'application/json', limit: '10mb' }));

// Log middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Root endpoint - Status
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'LOFT.73 Shopify Webhook Server',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    endpoints: {
      'GET /': 'Status server',
      'POST /shopify/test': 'Test autenticazione Shopify',
      'POST /shopify/products': 'Recupera prodotti Shopify',
      'POST /webhook/inventory': 'Webhook aggiornamenti inventario',
      'GET /webhook-status': 'Status webhook attivi'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

async function callShopifyAPI(storeUrl, accessToken, endpoint, method = 'GET', data = null) {
  const url = `https://${storeUrl}/admin/api/2023-10/shop.json`;
  
  const options = {
    method,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };

  if (data && method !== 'GET') {
    options.body = JSON.stringify(data);
  }

  try {
    console.log(`🔗 Calling Shopify API: ${url}`);
    const response = await fetch(url, options);
    
    if (!response.ok) {
      throw new Error(`Shopify API Error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('✅ Shopify API Success');
    return { success: true, data: result };

  } catch (error) {
    console.error('❌ Shopify API Error:', error.message);
    return { success: false, error: error.message };
  }
}

async function getShopifyProducts(storeUrl, accessToken, skus = []) {
  const url = `https://${storeUrl}/admin/api/2023-10/products.json?limit=250`;
  
  try {
    console.log(`🛍️ Fetching products from: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Products API Error: ${response.status}`);
    }

    const result = await response.json();
    const products = {};
    let totalVariants = 0;

    if (result.products) {
      result.products.forEach(product => {
        if (product.variants) {
          product.variants.forEach(variant => {
            if (!skus.length || skus.includes(variant.sku)) {
              products[variant.sku] = {
                id: product.id,
                title: product.title,
                handle: product.handle,
                image: product.images && product.images[0] ? product.images[0].src : null,
                variant: {
                  id: variant.id,
                  sku: variant.sku,
                  price: variant.price,
                  inventory_quantity: variant.inventory_quantity,
                  inventory_policy: variant.inventory_policy
                }
              };
              totalVariants++;
            }
          });
        }
      });
    }

    console.log(`✅ Found ${totalVariants} variants`);
    return { success: true, products, totalVariants };

  } catch (error) {
    console.error('❌ Products fetch error:', error.message);
    return { success: false, error: error.message };
  }
}

app.post('/shopify/test', async (req, res) => {
  const { storeUrl, accessToken } = req.body;
  
  console.log('🔐 Testing Shopify connection...');
  
  if (!storeUrl || !accessToken) {
    return res.status(400).json({
      success: false,
      error: 'Missing storeUrl or accessToken'
    });
  }

  try {
    const result = await callShopifyAPI(storeUrl, accessToken, 'shop.json');
    
    if (result.success) {
      res.json({
        success: true,
        shop: result.data.shop,
        message: 'Shopify connection successful',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(401).json(result);
    }
  } catch (error) {
    console.error('Test connection error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/shopify/products', async (req, res) => {
  const { storeUrl, accessToken, skus } = req.body;
  
  console.log(`📦 Fetching products for ${skus ? skus.length : 0} SKUs`);
  
  if (!storeUrl || !accessToken) {
    return res.status(400).json({
      success: false,
      error: 'Missing storeUrl or accessToken'
    });
  }

  try {
    const result = await getShopifyProducts(storeUrl, accessToken, skus);
    res.json(result);
  } catch (error) {
    console.error('Products fetch error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/webhook-status', (req, res) => {
  res.json({
    status: 'active',
    webhooks: {
      inventory: '/webhook/inventory',
      products: '/webhook/products',
      orders: '/webhook/orders'
    },
    timestamp: new Date().toISOString(),
    server: 'Railway'
  });
});

app.post('/webhook/inventory', (req, res) => {
  console.log('🔔 Inventory webhook received');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  
  res.json({
    success: true,
    message: 'Inventory webhook processed',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 LOFT.73 Shopify Webhook Server');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🚀 Time: ${new Date().toISOString()}`);
});

module.exports = app;
