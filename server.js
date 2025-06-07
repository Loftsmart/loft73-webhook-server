// server.js - Versione con Debug Avanzato
const express = require('express');
const cors = require('cors');

// Polyfill per fetch
if (!global.fetch) {
    try {
        global.fetch = require('node-fetch');
    } catch (e) {
        console.log('node-fetch non disponibile');
    }
}

const app = express();

const PORT = process.env.PORT || 3000;

// Configurazione Shopify
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL || 'loft-73.myshopify.com';
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

// Debug middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    if (req.method === 'POST') {
        console.log('Body preview:', JSON.stringify(req.body).substring(0, 200) + '...');
    }
    next();
});

// Cache
let shopifyCache = {
    products: {},
    inventory: {},
    timestamps: {},
    TTL: 5 * 60 * 1000
};

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: '🚀 Back in Stock Dashboard API',
        version: '1.1.0',
        status: 'running',
        debug: 'ENABLED',
        endpoints: [
            'GET /api/health',
            'POST /api/shopify/products-availability',
            'POST /api/shopify/search-products',
            'GET /api/debug/sample-products'
        ]
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        shopify: {
            configured: !!SHOPIFY_ACCESS_TOKEN,
            store: SHOPIFY_STORE_URL,
            apiVersion: SHOPIFY_API_VERSION,
            tokenLength: SHOPIFY_ACCESS_TOKEN ? SHOPIFY_ACCESS_TOKEN.length : 0
        },
        cache: {
            productsCount: Object.keys(shopifyCache.products).length,
            inventoryCount: Object.keys(shopifyCache.inventory).length
        }
    });
});

// DEBUG: Get sample products
app.get('/api/debug/sample-products', async (req, res) => {
    console.log('🔍 DEBUG: Fetching sample products...');
    
    try {
        const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=5`;
        const response = await fetch(url, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Shopify API error: ${response.status}`);
        }
        
        const data = await response.json();
        const sampleProducts = data.products.map(p => ({
            title: p.title,
            handle: p.handle,
            variants: p.variants.slice(0, 2).map(v => ({
                sku: v.sku,
                title: v.title
            }))
        }));
        
        console.log('Sample products:', sampleProducts);
        
        res.json({
            success: true,
            count: sampleProducts.length,
            products: sampleProducts
        });
        
    } catch (error) {
        console.error('Debug sample error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Search products
app.post('/api/shopify/search-products', async (req, res) => {
    const { searchTerm } = req.body;
    
    console.log(`🔍 SEARCH: Looking for "${searchTerm}"`);
    
    if (!searchTerm || searchTerm.length < 2) {
        return res.json({ success: true, products: [] });
    }

    try {
        // Prima prova a cercare per titolo
        let url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?title=${encodeURIComponent(searchTerm)}&limit=50`;
        
        console.log(`Searching URL: ${url}`);
        
        const response = await fetch(url, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`);
        }

        const data = await response.json();
        let products = data.products || [];
        
        console.log(`Found ${products.length} products by title`);
        
        // Se non trova nulla, prova con tutti i prodotti e filtra
        if (products.length === 0) {
            console.log('No products found by title, fetching all and filtering...');
            
            const allProductsUrl = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250`;
            const allResponse = await fetch(allProductsUrl, {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            });
            
            if (allResponse.ok) {
                const allData = await allResponse.json();
                const searchLower = searchTerm.toLowerCase();
                
                products = allData.products.filter(product => {
                    // Cerca nel titolo
                    if (product.title.toLowerCase().includes(searchLower)) return true;
                    
                    // Cerca negli SKU delle varianti
                    return product.variants.some(v => 
                        v.sku && v.sku.toLowerCase().includes(searchLower)
                    );
                });
                
                console.log(`Found ${products.length} products by filtering`);
            }
        }
        
        // Log primi risultati
        products.slice(0, 3).forEach(p => {
            console.log(`- ${p.title} (${p.variants.length} variants)`);
        });
        
        res.json({
            success: true,
            products: products,
            totalResults: products.length,
            searchTerm: searchTerm
        });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Main sync endpoint
app.post('/api/shopify/products-availability', async (req, res) => {
    console.log('\n🚀 === PRODUCTS AVAILABILITY REQUEST ===');
    
    try {
        const { productNames, skuPrefixes } = req.body;
        
        console.log('📦 Request details:');
        console.log(`- Product names: ${productNames?.length || 0}`);
        console.log(`- SKU prefixes: ${skuPrefixes?.length || 0}`);
        
        if (productNames && productNames.length > 0) {
            console.log('First 5 product names:', productNames.slice(0, 5));
        }
        
        if (skuPrefixes && skuPrefixes.length > 0) {
            console.log('First 5 SKU prefixes:', skuPrefixes.slice(0, 5));
        }

        // Fetch all products
        console.log('\n📥 Fetching products from Shopify...');
        let allProducts = [];
        let page_info = null;
        let pageCount = 0;
        
        while (pageCount < 10) { // Limit pages for safety
            pageCount++;
            
            let url;
            if (page_info) {
                url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?page_info=${page_info}&limit=250`;
            } else {
                url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250`;
            }
            
            console.log(`Fetching page ${pageCount}...`);
            
            const response = await fetch(url, {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                console.error(`❌ Shopify API error: ${response.status}`);
                break;
            }
            
            const data = await response.json();
            allProducts = allProducts.concat(data.products || []);
            
            // Check for next page
            const linkHeader = response.headers.get('Link');
            if (linkHeader && linkHeader.includes('rel="next"')) {
                const matches = linkHeader.match(/page_info=([^&>]+).*?rel="next"/);
                if (matches && matches[1]) {
                    page_info = matches[1];
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        
        console.log(`✅ Fetched ${allProducts.length} total products from Shopify`);
        
        // Log some product names for debugging
        console.log('\nSample Shopify product titles:');
        allProducts.slice(0, 5).forEach(p => {
            console.log(`- "${p.title}" (SKU: ${p.variants[0]?.sku || 'N/A'})`);
        });
        
        // Filter products based on request
        let matchedProducts = [];
        
        if (productNames && productNames.length > 0) {
            console.log('\n🔍 Matching by product names...');
            
            matchedProducts = allProducts.filter(product => {
                // Try multiple matching strategies
                const productTitle = product.title;
                
                // Strategy 1: Exact match
                if (productNames.includes(productTitle)) {
                    console.log(`✅ Exact match: "${productTitle}"`);
                    return true;
                }
                
                // Strategy 2: Case insensitive match
                const titleLower = productTitle.toLowerCase();
                const found = productNames.some(name => {
                    if (name.toLowerCase() === titleLower) {
                        console.log(`✅ Case-insensitive match: "${productTitle}" = "${name}"`);
                        return true;
                    }
                    return false;
                });
                
                if (found) return true;
                
                // Strategy 3: Contains match
                const containsMatch = productNames.some(name => {
                    if (titleLower.includes(name.toLowerCase()) || name.toLowerCase().includes(titleLower)) {
                        console.log(`✅ Contains match: "${productTitle}" ~ "${name}"`);
                        return true;
                    }
                    return false;
                });
                
                return containsMatch;
            });
            
            console.log(`Matched ${matchedProducts.length} products by name`);
        }
        
        if (skuPrefixes && skuPrefixes.length > 0) {
            console.log('\n🔍 Matching by SKU prefixes...');
            
            const skuMatched = allProducts.filter(product => {
                return product.variants.some(variant => {
                    if (!variant.sku) return false;
                    
                    return skuPrefixes.some(prefix => {
                        if (variant.sku.startsWith(prefix)) {
                            console.log(`✅ SKU match: "${variant.sku}" starts with "${prefix}"`);
                            return true;
                        }
                        return false;
                    });
                });
            });
            
            console.log(`Matched ${skuMatched.length} products by SKU`);
            
            // Merge with name matches
            skuMatched.forEach(product => {
                if (!matchedProducts.find(p => p.id === product.id)) {
                    matchedProducts.push(product);
                }
            });
        }
        
        console.log(`\n📊 FINAL: Matched ${matchedProducts.length} products total`);
        
        // Format response
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
                available: variant.inventory_quantity || 0,
                inventory_quantity: variant.inventory_quantity
            }))
        }));
        
        console.log('✅ Sending response with products');
        
        res.json({
            success: true,
            products: formattedProducts,
            totalProducts: formattedProducts.length,
            totalVariants: formattedProducts.reduce((sum, p) => sum + p.variants.length, 0),
            debug: {
                requestedNames: productNames?.length || 0,
                requestedSkus: skuPrefixes?.length || 0,
                shopifyTotal: allProducts.length,
                matched: matchedProducts.length
            }
        });
        
    } catch (error) {
        console.error('❌ Error in products-availability:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.stack
        });
    }
});

// Clear cache
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
        message: 'Cache cleared successfully'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`
    🚀 Back in Stock Dashboard API - DEBUG VERSION
    ✅ Server running on port ${PORT}
    🏪 Store: ${SHOPIFY_STORE_URL}
    📦 API Version: ${SHOPIFY_API_VERSION}
    🔐 Token configured: ${!!SHOPIFY_ACCESS_TOKEN}
    🔍 Debug mode: ENABLED
    📅 Started: ${new Date().toISOString()}
    `);
    
    if (!SHOPIFY_ACCESS_TOKEN) {
        console.log('⚠️  WARNING: SHOPIFY_ACCESS_TOKEN not configured!');
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
