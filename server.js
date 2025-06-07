// server.js - API per Dashboard Back in Stock con Shopify
const express = require('express');

// Polyfill per fetch se necessario (Node < 18)
if (!global.fetch) {
    global.fetch = require('node-fetch');
}

const app = express();

// IMPORTANTE: Railway imposta automaticamente la PORT
const PORT = process.env.PORT || 3000;

// Configurazione Shopify
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL || 'loft-73.myshopify.com';
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';

// Middleware - IMPORTANTE: l'ordine conta!
app.use(express.json());

// CORS permissivo
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
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
        shopify: {
            configured: !!SHOPIFY_ACCESS_TOKEN,
            store: SHOPIFY_STORE_URL,
            apiVersion: SHOPIFY_API_VERSION
        },
        cache: {
            productsCount: Object.keys(shopifyCache.products).length,
            inventoryCount: Object.keys(shopifyCache.inventory).length
        }
    });
});

// =====================================
// FUNZIONE PRINCIPALE: Fetch Prodotti con Varianti e Inventory
// =====================================
async function fetchProductsWithInventory(productHandles = []) {
    if (!SHOPIFY_ACCESS_TOKEN) {
        console.log('⚠️  Shopify non configurato');
        return [];
    }
    
    try {
        console.log(`📥 Recupero prodotti e inventory da Shopify...`);
        
        // Se abbiamo handles specifici, cerca solo quelli
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
                
                const response = await fetch(url, {
                    headers: {
                        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                        'Content-Type': 'application/json'
                    }
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
            }
        } else {
            // Fetch tutti i prodotti (con paginazione)
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

// Fetch tutti i prodotti con paginazione
async function fetchAllProducts() {
    let allProducts = [];
    let page_info = null;
    let hasNextPage = true;
    
    while (hasNextPage) {
        let url;
        
        if (page_info) {
            url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?page_info=${page_info}&limit=250`;
        } else {
            url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250`;
        }
        
        const response = await fetch(url, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            console.error(`❌ Errore Shopify API: ${response.status}`);
            break;
        }
        
        const data = await response.json();
        allProducts = allProducts.concat(data.products);
        
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
    }
    
    return allProducts;
}

// Fetch inventory levels per variant IDs
async function fetchInventoryLevels(variantIds) {
    const inventoryData = {};
    
    // Shopify limita a 50 inventory items per chiamata
    const chunks = [];
    for (let i = 0; i < variantIds.length; i += 50) {
        chunks.push(variantIds.slice(i, i + 50));
    }
    
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
                }
            });
            
            if (variantResponse.ok) {
                const variantData = await variantResponse.json();
                const inventoryItemIds = variantData.variants.map(v => v.inventory_item_id);
                
                // Poi fetch i livelli di inventory
                const inventoryUrl = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels.json?inventory_item_ids=${inventoryItemIds.join(',')}`;
                
                const inventoryResponse = await fetch(inventoryUrl, {
                    headers: {
                        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                        'Content-Type': 'application/json'
                    }
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
        } catch (error) {
            console.error('Errore fetch inventory per chunk:', error);
        }
    }
    
    return inventoryData;
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
        
        // Fetch tutti i prodotti o solo quelli richiesti
        const products = await fetchProductsWithInventory(productHandles || []);
        
        // Filtra per match con i dati del CSV
        let matchedProducts = products;
        
        if (productNames && productNames.length > 0) {
            matchedProducts = products.filter(product => {
                // Match per nome prodotto
                return productNames.some(name => 
                    product.title.toLowerCase().includes(name.toLowerCase())
                );
            });
        }
        
        if (skuPrefixes && skuPrefixes.length > 0) {
            matchedProducts = matchedProducts.filter(product => {
                // Match per SKU prefix
                return product.variants.some(variant => 
                    skuPrefixes.some(prefix => 
                        variant.sku && variant.sku.startsWith(prefix)
                    )
                );
            });
        }
        
        // Formatta risposta per la Dashboard
        const formattedProducts = matchedProducts.map(product => ({
            id: product.id,
            title: product.title,
            handle: product.handle,
            product_type: product.product_type,
            variants: product.variants.map(variant => ({
                id: variant.id,
                sku: variant.sku,
                color: variant.option2 || variant.option1, // Assumendo option2 = colore
                size: variant.option1 || 'TU', // Assumendo option1 = taglia
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
            cached: false
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
// ENDPOINT: Search prodotti per nome/SKU
// =====================================
app.post('/api/shopify/search-products', async (req, res) => {
    try {
        const { searchTerm } = req.body;
        
        if (!searchTerm || searchTerm.length < 2) {
            return res.json({ success: true, products: [] });
        }
        
        const products = await fetchProductsWithInventory();
        
        const matchedProducts = products.filter(product => {
            const searchLower = searchTerm.toLowerCase();
            
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
            totalResults: matchedProducts.length
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
// ENDPOINT: Clear cache (utile per testing)
// =====================================
app.post('/api/cache/clear', (req, res) => {
    shopifyCache = {
        products: {},
        inventory: {},
        timestamps: {},
        TTL: 5 * 60 * 1000
    };
    
    res.json({
        success: true,
        message: 'Cache cleared successfully'
    });
});

// =====================================
// AVVIO SERVER - IMPORTANTE PER RAILWAY
// =====================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀 Back in Stock Dashboard API
    ✅ Server attivo su porta ${PORT}
    🏪 Store: ${SHOPIFY_STORE_URL}
    📦 API Version: ${SHOPIFY_API_VERSION}
    🔐 Token configurato: ${!!SHOPIFY_ACCESS_TOKEN}
    `);
    
    if (!SHOPIFY_ACCESS_TOKEN) {
        console.log('⚠️  ATTENZIONE: SHOPIFY_ACCESS_TOKEN non configurato!');
    }
});

// Gestione errori non catturati
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
});
