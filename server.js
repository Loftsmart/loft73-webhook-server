const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Shopify configuration
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = '2024-01';

// Health check
app.get('/api/health', (req, res) => {
    console.log('Health check requested');
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        shopify: {
            configured: !!(SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN),
            store: SHOPIFY_STORE_URL
        }
    });
});

// DEBUG ENDPOINT - Get sample products to understand format
app.get('/api/shopify/sample-products', async (req, res) => {
    console.log('\n🔍 === SAMPLE PRODUCTS DEBUG ===');
    
    try {
        const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=10`;
        const response = await fetch(url, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) throw new Error(`Shopify error: ${response.status}`);
        
        const data = await response.json();
        
        // Log dettagliato per debug
        console.log('=== SHOPIFY PRODUCTS SAMPLE ===');
        data.products.forEach((p, idx) => {
            console.log(`\nProduct ${idx + 1}:`);
            console.log(`  Title: "${p.title}"`);
            console.log(`  Handle: "${p.handle}"`);
            console.log(`  Vendor: "${p.vendor}"`);
            console.log(`  Product Type: "${p.product_type}"`);
            console.log(`  Tags: "${p.tags}"`);
            console.log('  Variants:');
            p.variants.slice(0, 2).forEach(v => {
                console.log(`    - SKU: "${v.sku}"`);
                console.log(`      Title: "${v.title}"`);
                console.log(`      Option1: "${v.option1}"`);
                console.log(`      Option2: "${v.option2}"`);
            });
        });
        
        res.json({
            success: true,
            sampleProducts: data.products,
            formats: {
                titles: data.products.map(p => p.title),
                skus: data.products.flatMap(p => p.variants.map(v => v.sku)).filter(Boolean).slice(0, 10),
                vendors: [...new Set(data.products.map(p => p.vendor))]
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DEBUG ENDPOINT - Search specific product
app.post('/api/shopify/debug-search', async (req, res) => {
    console.log('\n🔍 === DEBUG SEARCH ===');
    
    try {
        const { searchTerm } = req.body;
        console.log(`Searching for: "${searchTerm}"`);
        
        // Try different search strategies
        const searches = [
            { query: searchTerm, description: 'Exact search' },
            { query: searchTerm.replace('LOFT.73 - ', ''), description: 'Without brand prefix' },
            { query: searchTerm.replace('LOFT.73', 'LOFT73'), description: 'Brand without dot' },
            { query: searchTerm.split(' - ')[1] || searchTerm, description: 'Only product name' },
            { query: searchTerm.split(' ')[2] || searchTerm, description: 'First word after brand' }
        ];
        
        const results = {};
        
        for (const search of searches) {
            const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?title=${encodeURIComponent(search.query)}&limit=5`;
            const response = await fetch(url, {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                results[search.description] = {
                    query: search.query,
                    count: data.products.length,
                    products: data.products.map(p => ({
                        title: p.title,
                        sku: p.variants[0]?.sku
                    }))
                };
            }
        }
        
        console.log('Search results:', JSON.stringify(results, null, 2));
        res.json({ success: true, results });
        
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Enhanced matching function
function findMatches(csvProduct, shopifyProducts) {
    const matches = [];
    
    // Prepare CSV product data for matching
    const csvName = csvProduct.name || '';
    const csvSku = csvProduct.sku || '';
    
    // Generate variations of the CSV name
    const nameVariations = [
        csvName,
        csvName.replace('LOFT.73 - ', ''),
        csvName.replace('LOFT.73', 'LOFT73'),
        csvName.replace(' - ', ' '),
        csvName.split(' - ')[1] || csvName,
        csvName.toLowerCase(),
        csvName.toUpperCase()
    ];
    
    // Generate SKU variations
    const skuVariations = [
        csvSku,
        csvSku.split(' - ')[0],
        csvSku.split(' - ')[1],
        csvSku.replace(/ /g, ''),
        csvSku.replace(/-/g, '')
    ].filter(Boolean);
    
    for (const shopifyProduct of shopifyProducts) {
        let matchScore = 0;
        let matchReasons = [];
        
        // Check name matches
        const shopifyTitle = shopifyProduct.title || '';
        for (const variation of nameVariations) {
            if (variation && shopifyTitle.toLowerCase().includes(variation.toLowerCase())) {
                matchScore += 10;
                matchReasons.push(`Name match: "${variation}"`);
                break;
            }
        }
        
        // Check SKU matches
        for (const variant of shopifyProduct.variants || []) {
            const variantSku = variant.sku || '';
            for (const skuVar of skuVariations) {
                if (skuVar && variantSku && (
                    variantSku === skuVar ||
                    variantSku.includes(skuVar) ||
                    skuVar.includes(variantSku)
                )) {
                    matchScore += 20;
                    matchReasons.push(`SKU match: "${skuVar}"`);
                    break;
                }
            }
        }
        
        if (matchScore > 0) {
            matches.push({
                shopifyProduct,
                matchScore,
                matchReasons
            });
        }
    }
    
    // Sort by match score
    return matches.sort((a, b) => b.matchScore - a.matchScore);
}

// Enhanced products availability endpoint
app.post('/api/shopify/products-availability', async (req, res) => {
    console.log('\n🚀 === PRODUCTS AVAILABILITY REQUEST ===');
    
    try {
        const { products: csvProducts } = req.body;
        console.log(`📦 Received ${csvProducts?.length} products to match`);
        
        // Log first few CSV products for debug
        console.log('\nSample CSV products:');
        csvProducts.slice(0, 3).forEach((p, idx) => {
            console.log(`  ${idx + 1}. Name: "${p.name}", SKU: "${p.sku}"`);
        });
        
        // Fetch ALL products from Shopify
        let allProducts = [];
        let pageInfo = null;
        let hasNextPage = true;
        let pageCount = 0;
        
        while (hasNextPage && pageCount < 50) { // Limit pages for safety
            pageCount++;
            const url = pageInfo 
                ? `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&page_info=${pageInfo}`
                : `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250`;
            
            console.log(`Fetching page ${pageCount}...`);
            
            const response = await fetch(url, {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) throw new Error(`Shopify error: ${response.status}`);
            
            const data = await response.json();
            allProducts = allProducts.concat(data.products);
            
            const linkHeader = response.headers.get('link');
            hasNextPage = linkHeader && linkHeader.includes('rel="next"');
            if (hasNextPage) {
                const matches = linkHeader.match(/<[^>]+page_info=([^>]+)>; rel="next"/);
                pageInfo = matches ? matches[1] : null;
            }
        }
        
        console.log(`✅ Fetched ${allProducts.length} total products from Shopify`);
        
        // Log sample Shopify products for debug
        console.log('\nSample Shopify products:');
        allProducts.slice(0, 3).forEach((p, idx) => {
            console.log(`  ${idx + 1}. Title: "${p.title}", SKU: "${p.variants[0]?.sku}"`);
        });
        
        // Match products with enhanced algorithm
        const results = [];
        let totalMatches = 0;
        
        for (const csvProduct of csvProducts) {
            const matches = findMatches(csvProduct, allProducts);
            
            if (matches.length > 0) {
                totalMatches++;
                const bestMatch = matches[0];
                
                // Get inventory for best match
                const product = bestMatch.shopifyProduct;
                for (const variant of product.variants) {
                    if (variant.inventory_item_id) {
                        try {
                            const invUrl = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels.json?inventory_item_ids=${variant.inventory_item_id}`;
                            const invResponse = await fetch(invUrl, {
                                headers: {
                                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                                    'Content-Type': 'application/json'
                                }
                            });
                            
                            if (invResponse.ok) {
                                const invData = await invResponse.json();
                                variant.available = invData.inventory_levels[0]?.available || 0;
                            }
                        } catch (e) {
                            console.error('Inventory error:', e);
                        }
                    }
                }
                
                results.push({
                    csvProduct,
                    shopifyProduct: product,
                    matchReasons: bestMatch.matchReasons,
                    available: product.variants.reduce((sum, v) => sum + (v.available || 0), 0)
                });
            }
        }
        
        console.log(`\n📊 FINAL RESULTS:`);
        console.log(`  Total CSV products: ${csvProducts.length}`);
        console.log(`  Matched products: ${totalMatches}`);
        console.log(`  Match rate: ${((totalMatches / csvProducts.length) * 100).toFixed(1)}%`);
        
        res.json({
            success: true,
            results,
            stats: {
                totalCsvProducts: csvProducts.length,
                totalShopifyProducts: allProducts.length,
                matchedProducts: totalMatches,
                matchRate: ((totalMatches / csvProducts.length) * 100).toFixed(1)
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`Shopify configured: ${!!(SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN)}`);
});
