// server.js - API per Dashboard Back in Stock con Shopify - Ottimizzata per Railway
const express = require('express');
const cors = require('cors');

// Polyfill per fetch solo se necessario (Node < 18)
if (!global.fetch) {
    try {
        global.fetch = require('node-fetch');
    } catch (e) {
        console.log('node-fetch non disponibile, usando fetch nativo');
    }
}

const app = express();

// IMPORTANTE: Railway imposta automaticamente la PORT
const PORT = process.env.PORT || 3000;

// Configurazione Shopify
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL || 'loft-73.myshopify.com';
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';

// Middleware essenziali
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS - usa il middleware standard
app.use(cors({
    origin: '*', // In produzione, specifica i domini permessi
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Sistema di cache
let shopifyCache = {
    products: {},
    inventory: {},
    timestamps: {},
    TTL: 5 * 60 * 1000 // 5 minuti
};

// Helper per verificare cache
function isCacheValid(key) {
    const timestamp = shopifyCache.timestamps[key];
    return timestamp && (Date.now() - timestamp < shopifyCache.TTL);
}

// =====================================
// ENDPOINT: Root - IMPORTANTE per Railway
// =====================================
app.get('/', (req, res) => {
    res.json({
        message: '🚀 Back in Stock Dashboard API',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: [
            'GET /api/health',
            'POST /api/shopify/products-availability',
            'POST /api/shopify/search-products',
            'POST /api/cache/clear'
        ]
    });
});

// =====================================
// ENDPOINT: Health check
// =====================================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        shopify: {
            configured: !!SHOPIFY_ACCESS_TOKEN,
            store: SHOPIFY_STORE_URL,
            apiVersion: SHOPIFY_API_VERSION
        },
        cache: {
            productsCount: Object.keys(shopifyCache.products).length,
            inventoryCount: Object.keys(shopifyCache.inventory).length
        },
        environment: {
            node: process.version,
            platform: process.platform,
            port: PORT
        }
    });
});

// =====================================
// FUNZIONE: Fetch tutti i prodotti con paginazione
// =====================================
async function fetchAllProducts() {
    let allProducts = [];
    let page_info = null;
    let hasNextPage = true;
    let pageCount = 0;
    
    while (hasNextPage && pageCount < 10) { // Limita a 10 pagine per sicurezza
        pageCount++;
        let url;
        
        if (page_info) {
            url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?page_info=${page_info}&limit=250`;
        } else {
            url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250`;
        }
        
        try {
            const response = await fetch(url, {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 secondi timeout
            });
            
            if (!response.ok) {
                console.error(`❌ Errore Shopify API: ${response.status} ${response.statusText}`);
                break;
            }
            
            const data = await response.json();
            allProducts = allProducts.concat(data.products || []);
            
            // Check paginazione
            const linkHeader = response.headers.get('Link');
            if (linkHeader && linkHeader.includes('rel="next"')) {
                const matches = linkHeader.match(/page_info=([^&>]+).*?rel="next"/);
                if (matches && matches[1]) {
                    page_info = matches[1];
                } else {
                    hasNextPage = false;
                }
            } else {
                hasNextPage = false;
            }
        } catch (error) {
            console.error('Errore nel fetch dei prodotti:', error);
            break;
        }
    }
    
    console.log(`✅ Recuperati ${allProducts.length} prodotti in ${pageCount} pagine`);
    return allProducts;
}

// =====================================
// FUNZIONE: Fetch inventory levels
// =====================================
async function fetchInventoryLevels(variantIds) {
    const inventoryData = {};
    
    // Shopify limita a 50 inventory items per chiamata
    const chunks = [];
    for (let i = 0; i < variantIds.length; i += 50) {
        chunks.push(variantIds.slice(i, i + 50));
    }
    
    console.log(`📦 Recupero inventory per ${variantIds.length} varianti in ${chunks.length} chiamate`);
    
    for (const chunk of chunks) {
        const cacheKey = `inventory_${chunk.join('_')}`;
        
        if (isCacheValid(cacheKey) && shopifyCache.inventory[cacheKey]) {
            Object.assign(inventoryData, shopifyCache.inventory[cacheKey]);
            continue;
        }
        
        try {
            // Prima ottieni gli inventory_item_ids dalle varianti
            const variantUrl = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/variants.json?ids=${chunk.join(',')}`;
            
            const variantResponse = await fetch(variantUrl, {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });
            
            if (variantResponse.ok) {
                const variantData = await variantResponse.json();
                const inventoryItemIds = variantData.variants.map(v => v.inventory_item_id).filter(Boolean);
                
                if (inventoryItemIds.length > 0) {
                    // Poi fetch i livelli di inventory
                    const inventoryUrl = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels.json?inventory_item_ids=${inventoryItemIds.join(',')}`;
                    
                    const inventoryResponse = await fetch(inventoryUrl, {
                        headers: {
                            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    });
                    
                    if (inventoryResponse.ok) {
                        const invData = await inventoryResponse.json();
                        
                        // Mappa inventory_item_id a variant_id
                        const variantToInventory = {};
                        variantData.variants.forEach(variant => {
                            const invLevel = invData.inventory_levels.find(
                                il => il.inventory_item_id === variant.inventory_item_id
                            );
                            variantToInventory[variant.id] = {
                                available: invLevel ? invLevel.available : 0
                            };
                        });
                        
                        Object.assign(inventoryData, variantToInventory);
                        shopifyCache.inventory[cacheKey] = variantToInventory;
                        shopifyCache.timestamps[cacheKey] = Date.now();
                    }
                }
            }
        } catch (error) {
            console.error('Errore fetch inventory per chunk:', error.message);
        }
    }
    
    return inventoryData;
}

// =====================================
// FUNZIONE PRINCIPALE: Fetch Prodotti con Inventory
// =====================================
async function fetchProductsWithInventory(productHandles = []) {
    if (!SHOPIFY_ACCESS_TOKEN) {
        console.log('⚠️  Shopify non configurato');
        return [];
    }
    
    try {
        console.log(`📥 Recupero prodotti e inventory da Shopify...`);
        
        let products = [];
        
        if (productHandles.length > 0) {
            // Fetch prodotti specifici per handle
            for (const handle of productHandles) {
                const cacheKey = `product_${handle}`;
                
                if (isCacheValid(cacheKey) && shopifyCache.products[cacheKey]) {
                    products.push(shopifyCache.products[cacheKey]);
                    continue;
                }
                
                const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?handle=${handle}`;
                
                try {
                    const response = await fetch(url, {
                        headers: {
                            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        if (data.products && data.products.length > 0) {
                            const product = data.products[0];
                            shopifyCache.products[cacheKey] = product;
                            shopifyCache.timestamps[cacheKey] = Date.now();
                            products.push(product);
                        }
                    }
                } catch (error) {
                    console.error(`Errore fetch prodotto ${handle}:`, error.message);
                }
            }
        } else {
            // Fetch tutti i prodotti
            const cacheKey = 'all_products';
            
            if (isCacheValid(cacheKey) && shopifyCache.products[cacheKey]) {
                products = shopifyCache.products[cacheKey];
            } else {
                products = await fetchAllProducts();
                shopifyCache.products[cacheKey] = products;
                shopifyCache.timestamps[cacheKey] = Date.now();
            }
        }
        
        // Ora fetch inventory levels per tutte le varianti
        const variantIds = products.flatMap(p => 
            p.variants.map(v => v.id)
        );
        
        const inventoryData = await fetchInventoryLevels(variantIds);
        
        // Combina dati prodotti con inventory
        const productsWithInventory = products.map(product => {
            const variantsWithInventory = product.variants.map(variant => {
                const inventory = inventoryData[variant.id] || { available: 0 };
                
                return {
                    id: variant.id,
                    product_id: product.id,
                    title: variant.title,
                    sku: variant.sku,
                    price: variant.price,
                    option1: variant.option1, // Taglia
                    option2: variant.option2, // Colore
                    option3: variant.option3,
                    available: inventory.available,
                    inventory_quantity: variant.inventory_quantity,
                    inventory_item_id: variant.inventory_item_id
                };
            });
            
            return {
                id: product.id,
                title: product.title,
                handle: product.handle,
                product_type: product.product_type,
                vendor: product.vendor,
                tags: product.tags,
                variants: variantsWithInventory
            };
        });
        
        console.log(`✅ Recuperati ${productsWithInventory.length} prodotti con inventory`);
        return productsWithInventory;
        
    } catch (error) {
        console.error('❌ Errore durante il recupero prodotti:', error);
        return [];
    }
}

// =====================================
// ENDPOINT: Ottieni varianti disponibili per prodotti
// =====================================
app.post('/api/shopify/products-availability', async (req, res) => {
    try {
        const { productNames, productHandles, skuPrefixes } = req.body;
        
        console.log('📋 Richiesta disponibilità per:', {
            productNames: productNames?.length || 0,
            productHandles: productHandles?.length || 0,
            skuPrefixes: skuPrefixes?.length || 0
        });
        
        // Fetch prodotti
        const products = await fetchProductsWithInventory(productHandles || []);
        
        // Filtra per match con i dati del CSV
        let matchedProducts = products;
        
        if (productNames && productNames.length > 0) {
            matchedProducts = products.filter(product => {
                return productNames.some(name => 
                    product.title.toLowerCase().includes(name.toLowerCase())
                );
            });
        }
        
        if (skuPrefixes && skuPrefixes.length > 0) {
            matchedProducts = matchedProducts.filter(product => {
                return product.variants.some(variant => 
                    skuPrefixes.some(prefix => 
                        variant.sku && variant.sku.startsWith(prefix)
                    )
                );
            });
        }
        
        // Formatta risposta
        const formattedProducts = matchedProducts.map(product => ({
            id: product.id,
            title: product.title,
            handle: product.handle,
            product_type: product.product_type,
            variants: product.variants.map(variant => ({
                id: variant.id,
                sku: variant.sku,
                color: variant.option2 || variant.option1,
                size: variant.option1 || 'TU',
                price: variant.price,
                available: variant.available,
                inventory_quantity: variant.inventory_quantity
            }))
        }));
        
        res.json({
            success: true,
            products: formattedProducts,
            totalProducts: formattedProducts.length,
            totalVariants: formattedProducts.reduce((sum, p) => sum + p.variants.length, 0),
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error in /api/shopify/products-availability:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch product availability',
            details: error.message 
        });
    }
});

// =====================================
// ENDPOINT: Search prodotti
// =====================================
app.post('/api/shopify/search-products', async (req, res) => {
    try {
        const { searchTerm } = req.body;
        
        if (!searchTerm || searchTerm.length < 2) {
            return res.json({ 
                success: true, 
                products: [],
                message: 'Search term too short'
            });
        }
        
        const products = await fetchProductsWithInventory();
        
        const searchLower = searchTerm.toLowerCase();
        const matchedProducts = products.filter(product => {
            // Match per titolo
            if (product.title.toLowerCase().includes(searchLower)) {
                return true;
            }
            
            // Match per SKU
            return product.variants.some(variant => 
                variant.sku && variant.sku.toLowerCase().includes(searchLower)
            );
        });
        
        res.json({
            success: true,
            products: matchedProducts,
            totalResults: matchedProducts.length,
            searchTerm: searchTerm
        });
        
    } catch (error) {
        console.error('Error in search:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Search failed',
            details: error.message 
        });
    }
});

// =====================================
// ENDPOINT: Clear cache
// =====================================
app.post('/api/cache/clear', (req, res) => {
    shopifyCache = {
        products: {},
        inventory: {},
        timestamps: {},
        TTL: 5 * 60 * 1000
    };
    
    console.log('🧹 Cache cleared');
    
    res.json({
        success: true,
        message: 'Cache cleared successfully',
        timestamp: new Date().toISOString()
    });
});

// =====================================
// Error handler
// =====================================
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message
    });
});

// =====================================
// 404 handler
// =====================================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path
    });
});

// =====================================
// AVVIO SERVER
// =====================================
const server = app.listen(PORT, () => {
    console.log(`
    🚀 Back in Stock Dashboard API
    ✅ Server attivo su porta ${PORT}
    🏪 Store: ${SHOPIFY_STORE_URL}
    📦 API Version: ${SHOPIFY_API_VERSION}
    🔐 Token configurato: ${!!SHOPIFY_ACCESS_TOKEN}
    🌐 URL: http://localhost:${PORT}
    📅 Started: ${new Date().toISOString()}
    `);
    
    if (!SHOPIFY_ACCESS_TOKEN) {
        console.log('⚠️  ATTENZIONE: SHOPIFY_ACCESS_TOKEN non configurato!');
    }
});

// Timeout per Railway
server.timeout = 120000; // 2 minuti

// Gestione errori
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
