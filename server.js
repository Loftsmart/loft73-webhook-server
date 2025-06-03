const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configurazione Shopify dalle variabili d'ambiente Railway
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2023-10';

// Helper per le chiamate Shopify REST API
const shopifyAPI = axios.create({
  baseURL: `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}`,
  headers: {
    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    'Content-Type': 'application/json'
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'LOFT.73 Shopify Webhook Server',
    version: '1.0.0',
    endpoints: [
      '/api/shopify/products',
      '/api/generate-names',
      '/api/check-name'
    ]
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    shopify: !!SHOPIFY_ACCESS_TOKEN,
    store: SHOPIFY_STORE_URL
  });
});

// Endpoint per recuperare prodotti esistenti per stagione
app.post('/api/shopify/products', async (req, res) => {
  try {
    const { season } = req.body;
    console.log(`Caricando prodotti per stagione: ${season}`);
    
    // Usa REST API invece di GraphQL per semplicità
    const response = await shopifyAPI.get('/products.json', {
      params: {
        limit: 250,
        fields: 'id,title,tags'
      }
    });
    
    // Filtra prodotti per stagione basandosi sui tag
    const allProducts = response.data.products || [];
    const seasonProducts = allProducts.filter(product => {
      const tags = product.tags ? product.tags.toLowerCase() : '';
      return tags.includes(season.toLowerCase());
    });
    
    // Estrai solo i nomi
    const productNames = seasonProducts.map(p => p.title);
    const uniqueNames = [...new Set(productNames)].sort();
    
    console.log(`Trovati ${uniqueNames.length} prodotti per ${season}`);
    
    res.json({
      success: true,
      season,
      count: uniqueNames.length,
      names: uniqueNames
    });
    
  } catch (error) {
    console.error('Errore Shopify:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.errors || 'Errore nel recupero prodotti Shopify',
      details: error.message
    });
  }
});

// Endpoint per generare nomi (placeholder per ora)
app.post('/api/generate-names', async (req, res) => {
  try {
    const { prompt, count, season, existingNames = [] } = req.body;
    
    // Per ora generiamo nomi di esempio
    // Sostituisci con OpenAI quando hai la chiave API
    const sampleNames = [
      'Aurora', 'Luna', 'Stella', 'Alba', 'Chiara', 'Serena', 'Marina', 'Viola',
      'Rosa', 'Bianca', 'Elena', 'Sofia', 'Giulia', 'Emma', 'Giorgia', 'Marta',
      'Iris', 'Flora', 'Diana', 'Silvia', 'Gemma', 'Perla', 'Asia', 'Eva',
      'Brezza', 'Onda', 'Neve', 'Rugiada', 'Nebbia', 'Nuvola', 'Pioggia', 'Schiuma'
    ];
    
    // Filtra nomi già esistenti
    const availableNames = sampleNames.filter(name => !existingNames.includes(name));
    const selectedNames = availableNames.slice(0, count);
    
    res.json({
      success: true,
      names: selectedNames.map((name, index) => ({
        id: Date.now() + index,
        name: name
      }))
    });
    
  } catch (error) {
    console.error('Errore generazione:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nella generazione nomi'
    });
  }
});

// Verifica singolo nome
app.post('/api/check-name', async (req, res) => {
  try {
    const { name } = req.body;
    
    const response = await shopifyAPI.get('/products.json', {
      params: {
        title: name,
        limit: 1
      }
    });
    
    const exists = response.data.products.length > 0;
    
    res.json({
      success: true,
      exists,
      name
    });
    
  } catch (error) {
    console.error('Errore verifica nome:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nella verifica del nome'
    });
  }
});

// CORS headers per Shopify webhooks
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Credentials', 'false');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  next();
});

app.listen(PORT, () => {
  console.log(`🚀 LOFT.73 Server attivo su porta ${PORT}`);
  console.log(`📦 Shopify Store: ${SHOPIFY_STORE_URL}`);
  console.log(`🔧 API Version: ${SHOPIFY_API_VERSION}`);
});
