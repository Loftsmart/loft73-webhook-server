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

// Get total products count
app.get('/api/shopify/products-count', async (req, res) => {
    try {
        const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products/count.json`;
        const response = await fetch(url, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) throw new Error(`Shopify error: ${response.status}`);
        
        const data = await response.json();
        console.log(`Total products in Shopify: ${data.count}`);
        res.json({ success: true, count: data.count });
        
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// TEST ENDPOINT - Get all products with brand breakdown
app.get('/api/test-names/:encodedBrands?', async (req, res) => {
    try {
        console.log('\n🔍 === FETCHING ALL PRODUCTS WITH since_id ===');
        
        let allProducts = [];
        let sinceId = 0;
        let pageCount = 0;
        let hasMore = true;
        
        // Get total count first
        const countUrl = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products/count.json`;
        const countResponse = await fetch(countUrl, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });
        const countData = await countResponse.json();
        const totalProducts = countData.count;
        
        console.log(`📊 Total products expected: ${totalProducts}`);
        
        // Fetch products using since_id
        while (hasMore) {
            pageCount++;
            const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&since_id=${sinceId}`;
            
            console.log(`📄 Fetching page ${pageCount} (since_id: ${sinceId})...`);
            
            const response = await fetch(url, {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Shopify error: ${response.status}`);
            }
            
            const data = await response.json();
            const productsInPage = data.products.length;
            
            if (productsInPage === 0) {
                hasMore = false;
                console.log('✅ No more products to fetch');
            } else {
                allProducts = allProducts.concat(data.products);
                // Get the highest ID from this batch for next iteration
                sinceId = Math.max(...data.products.map(p => p.id));
                console.log(`   ✅ Page ${pageCount}: ${productsInPage} products (Total: ${allProducts.length}, Next since_id: ${sinceId})`);
            }
            
            // Safety check
            if (allProducts.length >= totalProducts) {
                hasMore = false;
                console.log('✅ All products fetched');
            }
        }
        
        console.log(`\n✅ FETCH COMPLETE: ${allProducts.length} products retrieved`);
        
        // Brand breakdown
        const brandBreakdown = {};
        allProducts.forEach(p => {
            const vendor = p.vendor || 'Unknown';
            brandBreakdown[vendor] = (brandBreakdown[vendor] || 0) + 1;
        });
        
        // Extract all unique product names
        const names = allProducts.map(p => p.title);
        
        res.json({
            totalProducts: allProducts.length,
            brandBreakdown,
            names: names.slice(0, 100), // First 100 for preview
            message: `Successfully fetched ${allProducts.length} products using since_id pagination`
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Enhanced products availability endpoint with since_id
app.post('/api/shopify/products-availability', async (req, res) => {
    console.log('\n🚀 === PRODUCTS AVAILABILITY REQUEST ===');
    
    try {
        const { products: csvProducts } = req.body;
        console.log(`📦 Received ${csvProducts?.length} products to match`);
        
        // Get total count first
        const countUrl = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products/count.json`;
        const countResponse = await fetch(countUrl, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });
        const countData = await countResponse.json();
        const totalProducts = countData.count;
        console.log(`📊 Total products in Shopify: ${totalProducts}`);
        
        // Fetch ALL products using since_id pagination
        let allProducts = [];
        let sinceId = 0;
        let pageCount = 0;
        let hasMore = true;
        
        console.log('Starting to fetch all products with since_id...');
        
        while (hasMore && pageCount < 100) { // Safety limit
            pageCount++;
            
            const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250&since_id=${sinceId}`;
            
            console.log(`📄 Fetching page ${pageCount} (since_id: ${sinceId}, current total: ${allProducts.length})...`);
            
            const response = await fetch(url, {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                console.error(`Error on page ${pageCount}: ${response.status}`);
                throw new Error(`Shopify error: ${response.status}`);
            }
            
            const data = await response.json();
            const productsInPage = data.products.length;
            
            if (productsInPage === 0) {
                hasMore = false;
                console.log('✅ No more products to fetch');
            } else {
                allProducts = allProducts.concat(data.products);
                // Get the highest ID from this batch
                sinceId = Math.max(...data.products.map(p => p.id));
                console.log(`   ✅ Page ${pageCount}: ${productsInPage} products (Next since_id: ${sinceId})`);
                
                // Log some sample products from this page
                if (pageCount <= 3) {
                    console.log(`   Sample products from page ${pageCount}:`);
                    data.products.slice(0, 2).forEach(p => {
                        console.log(`     - "${p.title}" (ID: ${p.id}, Vendor: ${p.vendor})`);
                    });
                }
            }
            
            // Safety check
            if (allProducts.length >= totalProducts) {
                hasMore = false;
                console.log('✅ All expected products fetched');
            }
            
            // Small delay every 10 pages to avoid rate limiting
            if (pageCount % 10 === 0 && hasMore) {
                console.log('⏸️ Pausing for 1 second to avoid rate limits...');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log(`\n✅ FETCH COMPLETE: ${allProducts.length} products retrieved from Shopify`);
        
        if (allProducts.length < totalProducts) {
            console.warn(`⚠️ WARNING: Expected ${totalProducts} products but only got ${allProducts.length}`);
        }
        
        // Brand breakdown for debugging
        const brandBreakdown = {};
        allProducts.forEach(p => {
            const vendor = p.vendor || 'Unknown';
            brandBreakdown[vendor] = (brandBreakdown[vendor] || 0) + 1;
        });
        console.log('\n📊 Brand breakdown:');
        Object.entries(brandBreakdown).forEach(([brand, count]) => {
            console.log(`   ${brand}: ${count} products`);
        });
        
        // Now match with CSV products
        console.log('\n🔍 Starting matching process...');
        const results = [];
        let matchCount = 0;
        
        for (let i = 0; i < csvProducts.length; i++) {
            const csvProduct = csvProducts[i];
            
            if (i % 500 === 0) {
                console.log(`   Processing CSV product ${i}/${csvProducts.length}...`);
            }
            
            // Clean CSV data
            const csvName = (csvProduct.name || '').trim();
            const csvSku = (csvProduct.sku || '').trim();
            
            // Try multiple matching strategies
            const matchedProduct = allProducts.find(shopifyProduct => {
                const shopifyTitle = (shopifyProduct.title || '').trim();
                
                // 1. Exact match
                if (shopifyTitle === csvName) return true;
                
                // 2. Case insensitive match
                if (shopifyTitle.toLowerCase() === csvName.toLowerCase()) return true;
                
                // 3. Remove brand prefix and match
                const nameWithoutBrand = csvName
                    .replace(/^LOFT\.73\s*-\s*/i, '')
                    .replace(/^LOFT73\s*-\s*/i, '')
                    .trim();
                
                if (shopifyTitle.toLowerCase() === nameWithoutBrand.toLowerCase()) return true;
                if (shopifyTitle.toLowerCase().includes(nameWithoutBrand.toLowerCase())) return true;
                
                // 4. Check if Shopify title contains CSV name
                if (shopifyTitle.toLowerCase().includes(csvName.toLowerCase())) return true;
                
                // 5. Check if CSV name contains Shopify title
                if (csvName.toLowerCase().includes(shopifyTitle.toLowerCase())) return true;
                
                // 6. SKU matching
                if (csvSku && shopifyProduct.variants) {
                    return shopifyProduct.variants.some(variant => {
                        if (!variant.sku) return false;
                        
                        const variantSku = variant.sku.trim();
                        
                        // Exact SKU match
                        if (variantSku === csvSku) return true;
                        
                        // Partial SKU match
                        if (variantSku.includes(csvSku) || csvSku.includes(variantSku)) return true;
                        
                        // SKU without spaces/dashes
                        const cleanSku1 = variantSku.replace(/[\s-]/g, '').toLowerCase();
                        const cleanSku2 = csvSku.replace(/[\s-]/g, '').toLowerCase();
                        return cleanSku1 === cleanSku2;
                    });
                }
                
                return false;
            });
            
            if (matchedProduct) {
                matchCount++;
                
                // Get inventory levels
                let totalAvailable = 0;
                for (const variant of matchedProduct.variants) {
                    if (variant.inventory_quantity !== undefined) {
                        variant.available = variant.inventory_quantity;
                        totalAvailable += variant.inventory_quantity;
                    }
                }
                
                results.push({
                    csvProduct,
                    shopifyProduct: matchedProduct,
                    available: totalAvailable
                });
                
                // Log successful matches for first few
                if (matchCount <= 10) {
                    console.log(`   ✅ Match #${matchCount}: "${csvName}" → "${matchedProduct.title}"`);
                }
            }
        }
        
        console.log(`\n✅ MATCHING COMPLETE:`);
        console.log(`   CSV Products: ${csvProducts.length}`);
        console.log(`   Shopify Products: ${allProducts.length}`);
        console.log(`   Matched: ${matchCount}`);
        console.log(`   Match Rate: ${((matchCount / csvProducts.length) * 100).toFixed(1)}%`);
        
        // Log some unmatched examples
        if (matchCount < csvProducts.length) {
            console.log('\n❌ Examples of unmatched CSV products:');
            const unmatched = csvProducts.filter(csv => 
                !results.some(r => r.csvProduct.name === csv.name)
            );
            unmatched.slice(0, 10).forEach(p => {
                console.log(`   - "${p.name}" (SKU: ${p.sku || 'none'})`);
            });
        }
        
        res.json({
            success: true,
            results,
            stats: {
                totalCsvProducts: csvProducts.length,
                totalShopifyProducts: allProducts.length,
                matchedProducts: matchCount,
                matchRate: ((matchCount / csvProducts.length) * 100).toFixed(1),
                brandBreakdown
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
