const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();

// JSON 요청 본문을 파싱하기 위한 미들웨어
app.use(express.json());

// 정적 파일 제공 (html, css, js)
app.use(express.static(path.join(__dirname, '/')));

// Hugging Face Image Generation Proxy with Updated API
app.post('/api/generate-image', async (req, res) => {
    const { prompt } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log(`\n=== Image Generation Request ===`);
    console.log(`Prompt: ${prompt}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    // Try FLUX.1-schnell model with updated API format
    const model = {
        name: 'FLUX.1-schnell',
        url: 'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
        timeout: 60000 // Increased timeout for better success rate
    };

    console.log(`\n--- Attempting ${model.name} ---`);
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), model.timeout);

        // Updated request format for newer API
        const response = await fetch(model.url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.HF_TOKEN}`,
                'Content-Type': 'application/json',
                'x-wait-for-model': 'true' // Wait for model to load if needed
            },
            body: JSON.stringify({
                inputs: prompt
                // Removed parameters that might cause issues with newer API
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        console.log(`Response status: ${response.status}`);
        console.log(`Response headers:`, Object.fromEntries(response.headers.entries()));

        if (response.ok) {
            const imageBuffer = await response.arrayBuffer();
            
            // Check if we actually got image data
            if (imageBuffer.byteLength > 1000) { // Reasonable minimum for an image
                const base64Image = Buffer.from(imageBuffer).toString('base64');
                
                console.log(`✅ SUCCESS with ${model.name}`);
                console.log(`Generated image size: ${imageBuffer.byteLength} bytes`);
                
                return res.json({
                    success: true,
                    imageUrl: `data:image/png;base64,${base64Image}`,
                    model: model.name
                });
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
    
    res.json({
        success: false,
        imageUrl: `data:image/svg+xml;base64,${placeholderBase64}`,
        model: 'Placeholder',
        message: 'AI image generation is temporarily unavailable. Using placeholder image.'
    });
});

module.exports = app;
