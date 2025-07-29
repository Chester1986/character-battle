const express = require('express');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
require('dotenv').config();

// Hugging Face 토큰 설정
const HF_TOKEN_PRIMARY = process.env.HF_TOKEN;
const HF_TOKEN_FALLBACK = process.env.HF_FALLBACK_TOKEN || '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';
const HF_TOKEN_FALLBACK2 = process.env.HF_FALLBACK_TOKEN2 || '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';

// Imagine Art API 설정
const IMAGINE_API_KEY = process.env.IMAGINE_API_KEY;
const IMAGINE_API_URL = 'https://api.vyro.ai/v2/image/generations';

// Runware API 설정
const RUNWARE_API_KEY = process.env.RUNWARE_API_KEY;
const RUNWARE_API_URL = 'https://api.runware.ai/v1';

// Hugging Face 모델 설정
const hfModel = {
    name: 'FLUX.1-schnell',
    url: 'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
    timeout: 60000
};

// UUID 생성 함수
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Imagine Art API 호출 함수
async function generateImageWithImagine(prompt, options = {}) {
    try {
        const { style = 'realistic', aspect_ratio = '1:1', seed = '5' } = options;
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('style', style);
        formData.append('aspect_ratio', aspect_ratio);
        formData.append('seed', seed);

        const response = await axios.post(IMAGINE_API_URL, formData, {
            headers: {
                'Authorization': IMAGINE_API_KEY,
                ...formData.getHeaders()
            },
            responseType: 'arraybuffer',
            timeout: 30000
        });

        // Imagine Art API는 바이너리 이미지를 직접 반환합니다
        const imageBuffer = Buffer.from(response.data);
        const base64Image = imageBuffer.toString('base64');
        const dataUrl = `data:image/jpeg;base64,${base64Image}`;
        
        console.log('✅ Imagine Art API 성공: 이미지 생성됨 (바이너리 응답)');
        return dataUrl;
        
    } catch (error) {
        if (error.response) {
            console.error('❌ Imagine Art API 응답 오류:', error.response.status, error.response.statusText);
            throw new Error(`Imagine Art API 오류: ${error.response.status} - ${error.response.statusText}`);
        } else {
            console.error('❌ Imagine Art API 오류:', error.message);
            throw error;
        }
    }
}

// Runware API 호출 함수
async function generateImageWithRunware(prompt) {
    try {
        const taskUUID = generateUUID();
        const response = await fetch(RUNWARE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RUNWARE_API_KEY}`
            },
            body: JSON.stringify([{
                taskType: 'imageInference',
                taskUUID: taskUUID,
                outputType: 'URL',
                outputFormat: 'JPG',
                positivePrompt: prompt,
                model: 'runware:101@1',
                numberResults: 1,
                height: 512,
                width: 512,
                steps: 20,
                CFGScale: 7.0
            }]),
            timeout: 30000
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Runware API 응답 오류:', errorText);
            throw new Error(`Runware API 오류: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('Runware API 응답:', JSON.stringify(data, null, 2));
        
        // 에러 체크
        if (data.errors && data.errors.length > 0) {
            throw new Error(`Runware API 에러: ${data.errors[0].message}`);
        }
        
        // 성공 응답 체크
        if (data && data.data && data.data.length > 0 && data.data[0].imageURL) {
            return data.data[0].imageURL;
        } else {
            throw new Error('Runware API에서 이미지 URL을 받지 못했습니다');
        }
    } catch (error) {
        console.error('Runware API 오류:', error);
        throw error;
    }
}

// Hugging Face API 호출 함수
async function generateImageWithHuggingFace(prompt, token, tokenName) {
    try {

        const response = await fetch(hfModel.url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ inputs: prompt }),
            timeout: hfModel.timeout
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`${tokenName} 응답 오류:`, errorText);
            throw new Error(`${tokenName} 오류: ${response.status} - ${errorText}`);
        }

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const dataUrl = `data:image/jpeg;base64,${base64}`;
        
        console.log(`✅ ${tokenName} 성공: 이미지 생성됨`);
        return dataUrl;
    } catch (error) {
        console.error(`❌ ${tokenName} 오류:`, error.message);
        throw error;
    }
}

const app = express();

// JSON 요청 본문을 파싱하기 위한 미들웨어
app.use(express.json());

// 정적 파일 제공 (html, css, js)
app.use(express.static(path.join(__dirname, '/')));

// Hugging Face 이미지 생성 API (HF 메인, HF 풀백)
app.post('/api/generate-image', async (req, res) => {
    const { prompt, style = 'realistic', aspect_ratio = '1:1', seed = '5' } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    console.log(`\n=== Image Generation Request ===`);
    console.log(`Prompt: ${prompt}`);
    console.log(`Style: ${style}, Aspect Ratio: ${aspect_ratio}, Seed: ${seed}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);


    // 1. Imagine Art API 시도 (Primary)
    if (IMAGINE_API_KEY) {
        console.log(`\n--- Attempting Imagine Art API (Primary) ---`);
        try {
            const imageUrl = await generateImageWithImagine(prompt, { style, aspect_ratio, seed });
            
            console.log(`✅ SUCCESS with Imagine Art API (Primary)`);
            console.log(`Generated image URL: ${imageUrl}`);
            
            return res.json({
                success: true,
                imageUrl: imageUrl,
                model: 'Imagine Art',
                source: 'imagine-primary',
                style: style
            });
        } catch (error) {
            console.log(`❌ Imagine Art API (Primary) ERROR: ${error.message}`);
        }
    }

    // 2. Runware API 시도 (Fallback 1)
    if (RUNWARE_API_KEY) {
        console.log(`\n--- Attempting Runware API (Fallback 1) ---`);
        try {
            const imageUrl = await generateImageWithRunware(prompt);
            
            console.log(`✅ SUCCESS with Runware API (Fallback 1)`);
            console.log(`Generated image URL: ${imageUrl}`);
            
            return res.json({
                success: true,
                imageUrl: imageUrl,
                model: 'Runware',
                source: 'runware-fallback1'
            });
        } catch (error) {
            console.log(`❌ Runware API (Fallback 1) ERROR: ${error.message}`);
        }
    }

    // 3. Hugging Face Primary Token 시도 (Fallback 2)
    if (HF_TOKEN_PRIMARY) {
        console.log(`\n--- Attempting Hugging Face Primary Token (Fallback 2) ---`);
        try {
            const imageUrl = await generateImageWithHuggingFace(prompt, HF_TOKEN_PRIMARY, 'HF Primary Token');
            
            console.log(`✅ SUCCESS with Hugging Face Primary Token (Fallback 2)`);
            console.log(`Generated image URL: ${imageUrl}`);
            
            return res.json({
                success: true,
                imageUrl: imageUrl,
                model: hfModel.name,
                source: 'hf-primary-fallback2'
            });
        } catch (error) {
            console.log(`❌ Hugging Face Primary Token (Fallback 2) ERROR: ${error.message}`);
        }
    }

    // 4. Hugging Face Fallback Token 시도 (Fallback 3)
    if (HF_TOKEN_FALLBACK) {
        console.log(`\n--- Attempting Hugging Face Fallback Token (Fallback 3) ---`);
        try {
            const imageUrl = await generateImageWithHuggingFace(prompt, HF_TOKEN_FALLBACK, 'HF Fallback Token');
            
            console.log(`✅ SUCCESS with Hugging Face Fallback Token (Fallback 3)`);
            console.log(`Generated image URL: ${imageUrl}`);
            
            return res.json({
                success: true,
                imageUrl: imageUrl,
                model: hfModel.name,
                source: 'hf-fallback-fallback3'
            });
        } catch (error) {
            console.log(`❌ Hugging Face Fallback Token (Fallback 3) ERROR: ${error.message}`);
        }
    }

    // 5. Hugging Face Fallback2 Token 시도 (Fallback 4)
    if (HF_TOKEN_FALLBACK2) {
        console.log(`\n--- Attempting Hugging Face Fallback2 Token (Fallback 4) ---`);
        try {
            const imageUrl = await generateImageWithHuggingFace(prompt, HF_TOKEN_FALLBACK2, 'HF Fallback2 Token');
            
            console.log(`✅ SUCCESS with Hugging Face Fallback2 Token (Fallback 4)`);
            console.log(`Generated image URL: ${imageUrl}`);
            
            return res.json({
                success: true,
                imageUrl: imageUrl,
                model: hfModel.name,
                source: 'hf-fallback2-fallback4'
            });
        } catch (error) {
            console.log(`❌ Hugging Face Fallback2 Token (Fallback 4) ERROR: ${error.message}`);
        }
    }

    // 6. 최종 Placeholder 이미지 반환 (Final Fallback)
    console.log(`\n--- Using Placeholder Image (Final Fallback) ---`);
    const placeholderImage = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0yNTYgMjAwQzI3Ny4yIDIwMCAyOTQuNCAyMTcuMiAyOTQuNCAyMzguNEMyOTQuNCAyNTkuNiAyNzcuMiAyNzYuOCAyNTYgMjc2LjhDMjM0LjggMjc2LjggMjE3LjYgMjU5LjYgMjE3LjYgMjM4LjRDMjE3LjYgMjE3LjIgMjM0LjggMjAwIDI1NiAyMDBaIiBmaWxsPSIjOUNBM0FGIi8+CjxwYXRoIGQ9Ik0zNjggMzUySDM1MkwzMjAgMjg4SDI1NkgxOTJMMTYwIDM1MkgxNDRWMzY4SDM2OFYzNTJaIiBmaWxsPSIjOUNBM0FGIi8+Cjx0ZXh0IHg9IjI1NiIgeT0iNDAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjNjM3MzgxIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTYiPkltYWdlIE5vdCBBdmFpbGFibGU8L3RleHQ+Cjwvc3ZnPgo=';
    
    console.log(`✅ SUCCESS with Placeholder Image (Final Fallback)`);
    
    return res.json({
        success: true,
        imageUrl: placeholderImage,
        model: 'Placeholder',
        source: 'placeholder-final',
        message: '이미지 생성 API들이 모두 실패하여 플레이스홀더 이미지를 제공합니다.'
    });
});

// 서버 시작
const PORT = process.env.PORT || 5001;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Character Battle Server is running!`);
        console.log(`📍 Local: http://localhost:${PORT}`);
        console.log(`🎮 Game URL: http://localhost:${PORT}`);
        console.log(`🎨 Imagine Art API: ${IMAGINE_API_KEY ? 'Configured ✅' : 'Missing ❌'}`);
        console.log(`🚀 Runware API: ${RUNWARE_API_KEY ? 'Configured ✅' : 'Missing ❌'}`);
        console.log(`🤗 Hugging Face Primary: ${HF_TOKEN_PRIMARY ? 'Configured ✅' : 'Missing ❌'}`);
        console.log(`🤗 Hugging Face Fallback: ${HF_TOKEN_FALLBACK ? 'Configured ✅' : 'Missing ❌'}`);
        console.log(`🤗 Hugging Face Fallback2: ${HF_TOKEN_FALLBACK2 ? 'Configured ✅' : 'Missing ❌'}`);
        console.log(`\n=== API Status ===`);
        console.log(`Primary: Imagine Art API`);
        console.log(`Fallback 1: Runware API`);
        console.log(`Fallback 2: Hugging Face Token 1`);
        console.log(`Fallback 3: Hugging Face Token 2`);
        console.log(`Fallback 4: Hugging Face Token 3`);
        console.log(`Final: Placeholder Image`);
        console.log(`\n`);
    });
}

module.exports = app;
