const express = require('express');
const path = require('path');
require('dotenv').config();

// Hugging Face 토큰 설정
const HF_TOKEN_PRIMARY = process.env.HF_TOKEN;
const HF_TOKEN_FALLBACK = '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';

const app = express();

// JSON 요청 본문을 파싱하기 위한 미들웨어
app.use(express.json());

// 정적 파일 제공 (html, css, js)
app.use(express.static(path.join(__dirname, '/')));

// Hugging Face 이미지 생성 API (HF 메인, HF 풀백)
app.post('/api/generate-image', async (req, res) => {
    const { prompt } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log(`\n=== Image Generation Request ===`);
    console.log(`Prompt: ${prompt}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    const hfModel = {
        name: 'FLUX.1-schnell',
        url: 'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
        timeout: 60000
    };

    // 1단계: Hugging Face 기본 토큰 시도
    console.log(`\n--- Attempting Hugging Face (Primary Token) ---`);
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), hfModel.timeout);

        const response = await fetch(hfModel.url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HF_TOKEN_PRIMARY}`,
                'Content-Type': 'application/json',
                'x-wait-for-model': 'true'
            },
            body: JSON.stringify({
                inputs: prompt
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        console.log(`HF Primary Response status: ${response.status}`);

        if (response.ok) {
            const imageBuffer = await response.arrayBuffer();
            
            if (imageBuffer.byteLength > 1000) {
                const base64Image = Buffer.from(imageBuffer).toString('base64');
                
                console.log(`✅ SUCCESS with Hugging Face (Primary Token)`);
                console.log(`Generated image size: ${imageBuffer.byteLength} bytes`);
                
                return res.json({
                    success: true,
                    imageUrl: `data:image/png;base64,${base64Image}`,
                    model: hfModel.name,
                    source: 'primary'
                });
            }
        } else {
            const errorText = await response.text();
            console.log(`❌ Hugging Face Primary FAILED: HTTP ${response.status}`);
            console.log(`Error response: ${errorText}`);
            
            // 토큰 한도 초과나 기타 오류 시 풀백으로 진행
            if (errorText.includes('limit') || errorText.includes('quota') || response.status === 429) {
                console.log(`🚨 Primary token limit exceeded, switching to fallback token`);
            }
        }
    } catch (error) {
        console.log(`❌ Hugging Face Primary ERROR: ${error.message}`);
    }

    // 2단계: Hugging Face 풀백 토큰 시도
    console.log(`\n--- Attempting Hugging Face (Fallback Token) ---`);
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), hfModel.timeout);

        const response = await fetch(hfModel.url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HF_TOKEN_FALLBACK}`,
                'Content-Type': 'application/json',
                'x-wait-for-model': 'true'
            },
            body: JSON.stringify({
                inputs: prompt
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        console.log(`HF Fallback Response status: ${response.status}`);

        if (response.ok) {
            const imageBuffer = await response.arrayBuffer();
            
            if (imageBuffer.byteLength > 1000) {
                const base64Image = Buffer.from(imageBuffer).toString('base64');
                
                console.log(`✅ SUCCESS with Hugging Face (Fallback Token)`);
                console.log(`Generated image size: ${imageBuffer.byteLength} bytes`);
                
                return res.json({
                    success: true,
                    imageUrl: `data:image/png;base64,${base64Image}`,
                    model: hfModel.name,
                    source: 'fallback'
                });
            }
        } else {
            const errorText = await response.text();
            console.log(`❌ Hugging Face Fallback FAILED: HTTP ${response.status}`);
            console.log(`Error response: ${errorText}`);
        }
    } catch (error) {
        console.log(`❌ Hugging Face Fallback ERROR: ${error.message}`);
    }

    // 3단계: 모든 토큰 실패 시 플레이스홀더
    console.log(`\n🔄 All Hugging Face tokens failed, returning placeholder image`);
    
    const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
        <rect width="100%" height="100%" fill="#4ecdc4"/>
        <text x="50%" y="35%" font-family="Arial, sans-serif" font-size="24" fill="white" text-anchor="middle" dominant-baseline="middle">
            AI Character
        </text>
        <text x="50%" y="45%" font-family="Arial, sans-serif" font-size="18" fill="white" text-anchor="middle" dominant-baseline="middle">
            Generation
        </text>
        <text x="50%" y="55%" font-family="Arial, sans-serif" font-size="18" fill="white" text-anchor="middle" dominant-baseline="middle">
            Temporarily Unavailable
        </text>
        <text x="50%" y="70%" font-family="Arial, sans-serif" font-size="12" fill="white" text-anchor="middle" dominant-baseline="middle">
            All Hugging Face tokens failed
        </text>
        <text x="50%" y="80%" font-family="Arial, sans-serif" font-size="12" fill="white" text-anchor="middle" dominant-baseline="middle">
            Using placeholder image
        </text>
    </svg>`;
    
    const placeholderBase64 = Buffer.from(placeholderSvg).toString('base64');
    
    res.json({
        success: false,
        imageUrl: `data:image/svg+xml;base64,${placeholderBase64}`,
        model: 'Placeholder',
        source: 'placeholder',
        message: 'Both Hugging Face tokens are temporarily unavailable. Using placeholder image.'
    });
});

// 서버 시작
const PORT = process.env.PORT || 5001;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Character Battle Server is running!`);
        console.log(`📍 Local: http://localhost:${PORT}`);
        console.log(`🎮 Game URL: http://localhost:${PORT}`);
        console.log(`🤗 Hugging Face Primary: ${HF_TOKEN_PRIMARY ? 'Configured ✅' : 'Missing ❌'}`);
        console.log(`🤗 Hugging Face Fallback: ${HF_TOKEN_FALLBACK ? 'Configured ✅' : 'Missing ❌'}`);
        console.log(`\n=== API Status ===`);
        console.log(`Primary: Hugging Face Token 1`);
        console.log(`Fallback: Hugging Face Token 2`);
        console.log(`==================\n`);
    });
}

module.exports = app;
