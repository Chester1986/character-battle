const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const server = http.createServer(async (req, res) => {
    console.log(`Request: ${req.method} ${req.url}`);
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // Handle API routes
    if (req.url === '/api/generate-image' && req.method === 'POST') {
        await handleImageGeneration(req, res);
        return;
    }
    
    // Remove query parameters from URL
    const urlPath = req.url.split('?')[0];
    let filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
    console.log(`File path: ${filePath}`);
    
    // Security: Prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
            return;
        }
        
        // Set content type based on file extension
        const ext = path.extname(filePath);
        let contentType = 'text/html';
        
        switch (ext) {
            case '.js':
                contentType = 'application/javascript; charset=utf-8';
                break;
            case '.css':
                contentType = 'text/css; charset=utf-8';
                break;
            case '.json':
                contentType = 'application/json; charset=utf-8';
                break;
            case '.html':
                contentType = 'text/html; charset=utf-8';
                break;
        }
        
        res.setHeader('Content-Type', contentType);
        res.writeHead(200);
        res.end(data);
    });
});

// Image generation handler
async function handleImageGeneration(req, res) {
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });
    
    req.on('end', async () => {
        try {
            const { prompt } = JSON.parse(body);
            
            if (!prompt) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Prompt is required' }));
                return;
            }

            console.log(`\n=== Image Generation Request ===`);
            console.log(`Prompt: ${prompt}`);
            console.log(`Timestamp: ${new Date().toISOString()}`);

            // Try FLUX.1-schnell model with updated API format
            const model = {
                name: 'FLUX.1-schnell',
                url: 'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
                timeout: 60000
            };

            console.log(`\n--- Attempting ${model.name} ---`);
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), model.timeout);

                const response = await fetch(model.url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.HF_TOKEN}`,
                        'Content-Type': 'application/json',
                        'x-wait-for-model': 'true'
                    },
                    body: JSON.stringify({
                        inputs: prompt
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                console.log(`Response status: ${response.status}`);

                if (response.ok) {
                    const imageBuffer = await response.arrayBuffer();
                    
                    if (imageBuffer.byteLength > 1000) {
                        const base64Image = Buffer.from(imageBuffer).toString('base64');
                        
                        console.log(`✅ SUCCESS with ${model.name}`);
                        console.log(`Generated image size: ${imageBuffer.byteLength} bytes`);
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: true,
                            imageUrl: `data:image/png;base64,${base64Image}`,
                            model: model.name
                        }));
                        return;
                    } else {
                        console.log(`❌ Received data too small to be an image: ${imageBuffer.byteLength} bytes`);
                    }
                } else {
                    const errorText = await response.text();
                    console.log(`❌ FAILED with ${model.name}: HTTP ${response.status}`);
                    console.log(`Error response: ${errorText}`);
                }
            } catch (error) {
                console.log(`❌ ERROR with ${model.name}: ${error.message}`);
                
                if (error.name === 'AbortError') {
                    console.log(`⏰ Request timed out after ${model.timeout}ms`);
                }
            }

            // If model fails, return placeholder
            console.log(`\n🔄 AI model failed, returning placeholder image`);
            
            const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
                <rect width="100%" height="100%" fill="#4ecdc4"/>
                <text x="50%" y="40%" font-family="Arial, sans-serif" font-size="24" fill="white" text-anchor="middle" dominant-baseline="middle">
                    AI Character
                </text>
                <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="18" fill="white" text-anchor="middle" dominant-baseline="middle">
                    Generation
                </text>
                <text x="50%" y="60%" font-family="Arial, sans-serif" font-size="18" fill="white" text-anchor="middle" dominant-baseline="middle">
                    Temporarily Unavailable
                </text>
                <text x="50%" y="75%" font-family="Arial, sans-serif" font-size="12" fill="white" text-anchor="middle" dominant-baseline="middle">
                    Using placeholder image
                </text>
            </svg>`;
            
            const placeholderBase64 = Buffer.from(placeholderSvg).toString('base64');
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                imageUrl: `data:image/svg+xml;base64,${placeholderBase64}`,
                model: 'Placeholder',
                message: 'AI image generation is temporarily unavailable. Using placeholder image.'
            }));
            
        } catch (error) {
            console.error('Error parsing request body:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});