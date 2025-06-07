const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Shopify configuration - Prende direttamente dalle variabili d'ambiente
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = '2024-01';

// Log configuration on startup
console.log('Starting server with configuration:');
console.log('PORT:', PORT);
console.log('SHOPIFY_STORE_URL:', SHOPIFY_STORE_URL ? 'Configured' : 'NOT CONFIGURED');
console.log('SHOPIFY_ACCESS_TOKEN:', SHOPIFY_ACCESS_TOKEN ? 'Configured' : 'NOT CONFIGURED');

// Helper functions
function normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, '');
}

function extractProductCore(title) {
    return title
        .replace(/^LOFT\.?73\s*/i, '')
        .replace(/\s*-\s*$/, '')
        .trim();
}

// Health check
app.get('/api/health', (req, res) => {
    console.log('Health check requested');
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        shopify: {
            configured: !!(SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN),
            store: SHOPIFY_STORE_URL ? SHOPIFY_STORE_URL.replace('.myshopify.com', '') : null
        }
    });
});

// Search products endpoint
app.post('/api/shopify/search-products', async (req, res) => {
    console.log('\n🔍 === SEARCH PRODUCTS REQUEST ===');
    
    try {
        const { searchTerm } = req.body;
        console.log(`Searching for: "${searchTerm}"`);
        
        const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?title=${encodeURIComponent(searchTerm)}&limit=10`;
        
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
        console.log(`Found ${data.products.length} products`);
        
        res.json({
            success: true,
            products: data.products.map(p => ({
                id: p.id,
                title: p.title,
                handle: p.handle,
                variants: p.variants.map(v => ({
                    id: v.id,
                    sku: v.sku,
                    title: v.title,
                    available: v.inventory_quantity || 0
                }))
            }))
        });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Main products availability endpoint with enhanced matching
app.post('/api/shopify/products-availability', async (req, res) => {
    console.log('\n🚀 === PRODUCTS AVAILABILITY REQUEST ===');
    
    try {
        const { productNames, skuPrefixes } = req.body;
        
        console.log('📦 Request details:');
        console.log(`- Product names: ${productNames?.length || 0}`);
        console.log(`- SKU prefixes: ${skuPrefixes?.length || 0}`);
        
        // Log sample data
        if (productNames?.length > 0) {
            console.log('Sample product names:', productNames.slice(0, 3));
        }
        if (skuPrefixes?.length > 0) {
            console.log('Sample SKUs:', skuPrefixes.slice(0, 3));
        }
        
        // Fetch all products from Shopify
        let allProducts = [];
        let hasNextPage = true;
        let pageInfo = null;
        
        console.log('\n📥 Fetching products from Shopify...');
        
        while (hasNextPage) {
            const url = pageInfo 
                ? `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&page_info=${pageInfo}`
                : `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250`;
            
            const response = await fetch(url, {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            allProducts = allProducts.concat(data.products);
            
            // Check for next page
            const linkHeader = response.headers.get('link');
            if (linkHeader && linkHeader.includes('rel="next"')) {
                const matches = linkHeader.match(/<[^>]+page_info=([^>]+)>; rel="next"/);
                pageInfo = matches ? matches[1] : null;
                hasNextPage = !!pageInfo;
            } else {
                hasNextPage = false;
            }
        }
        
        console.log(`✅ Fetched ${allProducts.length} total products from Shopify`);
        
        // Enhanced matching logic
        const matchedProductsMap = new Map();
        
        // Prepare lookup maps for faster matching
        const csvSkuMap = new Map();
        const csvNameMap = new Map();
        
        if (skuPrefixes) {
            skuPrefixes.forEach(sku => {
                csvSkuMap.set(sku.toUpperCase(), sku);
                csvSkuMap.set(sku.replace(/[^A-Z0-9]/gi, '').toUpperCase(), sku);
            });
        }
        
        if (productNames) {
            productNames.forEach(name => {
                csvNameMap.set(normalizeString(name), name);
                csvNameMap.set(normalizeString(extractProductCore(name)), name);
            });
        }
        
        console.log('\n🔍 Starting combined matching (SKU + Name)...');
        
        // Match products
        for (const product of allProducts) {
            let matchScore = 0;
            let matchReasons = [];
            
            // SKU matching
            let skuMatch = false;
            if (csvSkuMap.size > 0) {
                for (const variant of product.variants) {
                    if (!variant.sku) continue;
                    
                    const variantSkuUpper = variant.sku.toUpperCase();
                    const variantSkuClean = variant.sku.replace(/[^A-Z0-9]/gi, '').toUpperCase();
                    
                    if (csvSkuMap.has(variantSkuUpper)) {
                        skuMatch = true;
                        matchScore += 10;
                        matchReasons.push(`SKU exact: ${variant.sku}`);
                        break;
                    }
                    
                    if (csvSkuMap.has(variantSkuClean)) {
                        skuMatch = true;
                        matchScore += 8;
                        matchReasons.push(`SKU clean: ${variant.sku}`);
                        break;
                    }
                    
                    for (const [csvSku, originalSku] of csvSkuMap) {
                        if (variantSkuUpper.startsWith(csvSku) || csvSku.startsWith(variantSkuUpper)) {
                            skuMatch = true;
                            matchScore += 5;
                            matchReasons.push(`SKU partial: ${variant.sku} ~ ${originalSku}`);
                            break;
                        }
                    }
                    
                    if (skuMatch) break;
                }
            }
            
            // Name matching
            let nameMatch = false;
            const productTitleNorm = normalizeString(product.title);
            const productCore = normalizeString(extractProductCore(product.title));
            
            if (csvNameMap.has(productTitleNorm)) {
                nameMatch = true;
                matchScore += 5;
                matchReasons.push(`Name exact: ${product.title}`);
            }
            else if (csvNameMap.has(productCore)) {
                nameMatch = true;
                matchScore += 4;
                matchReasons.push(`Name core: ${product.title}`);
            }
            else {
                for (const [csvName, originalName] of csvNameMap) {
                    if (productTitleNorm.includes(csvName) || csvName.includes(productTitleNorm)) {
                        nameMatch = true;
                        matchScore += 3;
                        matchReasons.push(`Name partial: ${product.title} ~ ${originalName}`);
                        break;
                    }
                }
            }
            
            // Include product if match score is sufficient
            if (matchScore >= 3) {
                console.log(`✅ Match found (score: ${matchScore}): ${product.title}`);
                console.log(`   Reasons: ${matchReasons.join(', ')}`);
                matchedProductsMap.set(product.id, product);
            }
        }
        
        const matchedProducts = Array.from(matchedProductsMap.values());
        console.log(`\n📊 Matched ${matchedProducts.length} products`);
        
        // Fetch inventory levels for matched products
        console.log('\n📦 Fetching inventory levels...');
        
        for (const product of matchedProducts) {
            for (const variant of product.variants) {
                if (variant.inventory_item_id) {
                    try {
                        const inventoryUrl = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels.json?inventory_item_ids=${variant.inventory_item_id}`;
                        
                        const invResponse = await fetch(inventoryUrl, {
                            headers: {
                                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (invResponse.ok) {
                            const invData = await invResponse.json();
                            if (invData.inventory_levels && invData.inventory_levels[0]) {
                                variant.available = invData.inventory_levels[0].available || 0;
                            }
                        }
                    } catch (error) {
                        console.error(`Error fetching inventory for variant ${variant.id}:`, error);
                        variant.available = 0;
                    }
                }
            }
        }
        
        // Format response
        const formattedProducts = matchedProducts.map(product => ({
            id: product.id,
            title: product.title,
            handle: product.handle,
            product_type: product.product_type,
            tags: product.tags,
            variants: product.variants.map(variant => ({
                id: variant.id,
                sku: variant.sku || '',
                color: variant.option2 || variant.option1 || 'Standard',
                size: variant.option1 || 'TU',
                price: variant.price,
                available: variant.available || 0,
                inventory_quantity: variant.inventory_quantity || 0
            }))
        }));
        
        // Summary
        console.log('\n📊 === RESPONSE SUMMARY ===');
        console.log(`Total products: ${formattedProducts.length}`);
        console.log(`Total variants: ${formattedProducts.reduce((sum, p) => sum + p.variants.length, 0)}`);
        console.log(`Total available items: ${formattedProducts.reduce((sum, p) => 
            sum + p.variants.reduce((vSum, v) => vSum + v.available, 0), 0)}`);
        
        res.json({
            success: true,
            products: formattedProducts,
            totalProducts: formattedProducts.length,
            totalVariants: formattedProducts.reduce((sum, p) => sum + p.variants.length, 0),
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error in products-availability:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📍 API endpoints:`);
    console.log(`   - GET  /api/health`);
    console.log(`   - POST /api/shopify/search-products`);
    console.log(`   - POST /api/shopify/products-availability`);
    
    if (SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN) {
        console.log(`\n✅ Shopify configured for store: ${SHOPIFY_STORE_URL}`);
    } else {
        console.log(`\n⚠️  Shopify NOT configured! Check your environment variables`);
    }
});
