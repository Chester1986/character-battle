// ------------------------------------------------------------------
// 0. Firebase 설정 및 초기화
// ------------------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getFirestore, doc, setDoc, addDoc, collection, getDocs, getDoc, runTransaction, query, where, limit, orderBy, collectionGroup, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyACeHq5E4wmeIVItJ0CiQlSsxYkrn1Rhig",
    authDomain: "ai-character-battle-4a940.firebaseapp.com",
    projectId: "ai-character-battle-4a940",
    storageBucket: "ai-character-battle-4a940.firebasestorage.app",
    messagingSenderId: "733627740113",
    appId: "1:733627740113:web:c959da519349c7ad73faf0",
    measurementId: "G-MWB2LF360Z"
};

// Craiyon API는 무료로 사용 가능하며 별도의 API 키가 필요하지 않습니다.
const GEMINI_API_KEY = "AIzaSyBTbqLGoY22MHjgXP1uWh_X-oCpoeEBl1Q"; // 텍스트 생성용 Gemini API

// --- INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// 텍스트 생성용 Gemini 모델들 (폴백 시스템)
const primaryModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
const fallbackModel1 = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
const fallbackModel2 = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
// 이미지 생성은 Craiyon API를 사용합니다.

// 모델 폴백 순서 정의
const modelFallbackOrder = [
    { name: 'gemini-2.5-flash', model: primaryModel },
    { name: 'gemini-2.0-flash', model: fallbackModel1 },
    { name: 'gemini-2.5-flash-lite', model: fallbackModel2 }
];

// --- STATE ---
let currentUser = null;
let generatedCharacterData = null;
let playerCharacterForBattle = null;
let opponentCharacterForBattle = null;
let selectedCharacterCard = null;
let selectedSkills = [];
let allCharactersCache = []; // Cache for opponent finding

// --- DOM ELEMENTS ---
const authSection = document.getElementById('auth-section');
const idInput = document.getElementById('id-input');
const passwordInput = document.getElementById('password-input');
const loginBtn = document.getElementById('login-btn');
const signupBtn = document.getElementById('signup-btn');
const logoutBtn = document.getElementById('logout-btn');
const appContent = document.getElementById('app-content');

// 새로운 UI 구조
const characterCardsSection = document.getElementById('character-cards-section');
const characterCardsGrid = document.getElementById('character-cards-grid');
const characterCreationSection = document.getElementById('character-creation-section');
const characterDetailSection = document.getElementById('character-detail-section');
const backToCardsBtn = document.getElementById('back-to-cards-btn');
const backToCardsFromDetailBtn = document.getElementById('back-to-cards-from-detail-btn');
const detailCharacterName = document.getElementById('detail-character-name');
const characterDetailContent = document.getElementById('character-detail-content');

const charNameInput = document.getElementById('char-name');
const charConceptInput = document.getElementById('char-concept');
const generateCharacterBtn = document.getElementById('generate-character-btn');
const characterPreview = document.getElementById('character-preview');
const loadingIndicator = document.getElementById('loading-indicator');
const charImagePreview = document.getElementById('char-image-preview');
charImagePreview.src = 'https://placehold.co/512x512/333/FFF?text=?';
const charStoryPreview = document.getElementById('char-story-preview');
const charStatsPreview = document.getElementById('char-stats-preview');

// 매칭 화면 관련 DOM 요소들
const matchingSection = document.getElementById('matching-section');
const matchingContent = document.getElementById('matching-content');
const backToDetailFromMatchingBtn = document.getElementById('back-to-detail-from-matching-btn');

// 전투 화면 관련 DOM 요소들
const battleSection = document.getElementById('battle-section');
const battleContent = document.getElementById('battle-content');
const backToMatchingBtn = document.getElementById('back-to-matching-btn');

// Novel Log & Image Generation
// const showNovelLogBtn = document.getElementById('show-novel-log-btn'); // Removed - novel now shows automatically
const novelLogModal = document.getElementById('novel-log-modal');
const novelLogContent = document.getElementById('novel-log-content');
const generateBattleImageBtn = document.getElementById('generate-battle-image-btn');
const battleImageContainer = document.getElementById('battle-image-container');
const generatedBattleImage = document.getElementById('generated-battle-image');
let lastBattleData = null; // To store data for novel/image generation

const showRankingBtn = document.getElementById('show-ranking-btn');
const rankingModal = document.getElementById('ranking-modal');
const rankingList = document.getElementById('ranking-list');
const rankingCloseBtn = rankingModal.querySelector('.close-btn');
const rankingCharacterDetailModal = document.getElementById('ranking-character-detail-modal');
const rankingCharacterDetailContent = document.getElementById('ranking-character-detail-content');
const rankingCharacterDetailCloseBtn = rankingCharacterDetailModal.querySelector('.close-btn');

const skillModal = document.getElementById('skill-modal');
const skillModalCharName = document.getElementById('skill-modal-char-name');
const skillList = document.getElementById('skill-list');
const skillCloseBtn = skillModal.querySelector('.close-btn');

// 관리자 패널 관련 DOM 요소들
const adminBtn = document.getElementById('admin-btn');
const adminSection = document.getElementById('admin-section');
const backToCardsFromAdminBtn = document.getElementById('back-to-cards-from-admin-btn');
const totalCharactersCount = document.getElementById('total-characters-count');
const totalUsersCount = document.getElementById('total-users-count');
const refreshDataBtn = document.getElementById('refresh-admin-data-btn');
const exportDataBtn = document.getElementById('export-data-btn');
const adminCharactersList = document.getElementById('admin-characters-grid');

// 모달 닫기 이벤트 리스너 추가
rankingCloseBtn.addEventListener('click', () => {
    rankingModal.classList.add('hidden');
});

rankingCharacterDetailCloseBtn.addEventListener('click', () => {
    rankingCharacterDetailModal.classList.add('hidden');
});

skillCloseBtn.addEventListener('click', () => {
    skillModal.classList.add('hidden');
});

const playerSkillSelection = document.getElementById('player-skill-selection');
const skillChoicesContainer = document.getElementById('skill-choices-container');

const generationProgressContainer = document.getElementById('generation-progress-container');
const generationProgressBar = document.getElementById('generation-progress-bar');

// 아레나 관련 DOM 요소들
const arenaCharactersGrid = document.getElementById('arena-characters-grid');
const arenaCharacterSelection = document.getElementById('arena-character-selection');

// 전투 관련 추가 DOM 요소들 (null 체크 포함)
const findOpponentBtn = document.getElementById('find-opponent-btn');
const backToListBtn = document.getElementById('back-to-list-btn');
const startBattleBtn = document.getElementById('start-battle-btn');
const playerBattleCard = document.getElementById('player-battle-card');
const opponentBattleCard = document.getElementById('opponent-battle-card');
// enterBattleBtn은 이미 상단에서 정의됨

// --- HELPERS ---
async function createEmailFromId(id) {
    try {
        // ID를 SHA-256으로 해싱하여 Firebase 이메일 형식에 맞는 고유하고 안전한 문자열을 생성합니다.
        console.log(`Hashing ID: ${id}`);
        const encoder = new TextEncoder();
        const data = encoder.encode(id);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        const email = `${hashHex}@characterbattle.app`;
        console.log(`Generated email: ${email}`);
        return email;
    } catch (error) {
        console.error('Error during email hashing:', error);
        alert('ID를 이메일로 변환하는 중 오류가 발생했습니다. 콘솔을 확인해주세요.');
        return null;
    }
}

function updateProgress(percentage, text) {
    if (percentage !== null) {
        generationProgressBar.style.width = `${percentage}%`;
    }
    generationProgressBar.innerText = text || (percentage !== null ? `${percentage}%` : generationProgressBar.innerText);
}

// 모델 상태를 사용자에게 알려주는 함수
function updateModelStatus(modelName, status = 'trying') {
    const statusMessages = {
        'trying': `🤖 ${modelName} 모델로 생성 중...`,
        'success': `✅ ${modelName} 모델로 성공!`,
        'failed': `❌ ${modelName} 모델 실패, 다음 모델 시도 중...`,
        'fallback': `🔄 폴백 모델 ${modelName}로 전환...`
    };
    
    const message = statusMessages[status] || `${modelName} 처리 중...`;
    updateProgress(null, message);
    
    // 콘솔에도 로그 출력
    console.log(message);
}

async function generateWithFallback(prompt, maxRetriesPerModel = 2) {
    for (let modelIndex = 0; modelIndex < modelFallbackOrder.length; modelIndex++) {
        const { name: modelName, model } = modelFallbackOrder[modelIndex];
        
        // 첫 번째 모델이 아닌 경우 폴백 상태 표시
        if (modelIndex > 0) {
            updateModelStatus(modelName, 'fallback');
            await new Promise(res => setTimeout(res, 500)); // 사용자가 메시지를 볼 수 있도록 잠시 대기
        } else {
            updateModelStatus(modelName, 'trying');
        }
        
        for (let attempt = 1; attempt <= maxRetriesPerModel; attempt++) {
            try {
                console.log(`Attempting with ${modelName} (attempt ${attempt}/${maxRetriesPerModel})`);
                const result = await model.generateContent(prompt);
                
                // 응답이 비어있거나 너무 짧은 경우 체크
                if (!result || !result.response || !result.response.text()) {
                    throw new Error('Empty or invalid response received');
                }
                
                const responseText = result.response.text();
                if (responseText.trim().length < 10) {
                    throw new Error('Response too short, likely incomplete');
                }
                
                console.log(`✅ Success with ${modelName}`);
                updateModelStatus(modelName, 'success');
                return result;
                
            } catch (error) {
                console.warn(`❌ ${modelName} attempt ${attempt} failed:`, error.message);
                
                // 토큰 한도 초과나 특정 오류인 경우 즉시 다음 모델로
                if (error.message.includes('quota') || 
                    error.message.includes('limit') || 
                    error.message.includes('RESOURCE_EXHAUSTED') ||
                    error.message.includes('RATE_LIMIT_EXCEEDED')) {
                    console.log(`🔄 Token/Rate limit reached for ${modelName}, switching to next model`);
                    updateModelStatus(modelName, 'failed');
                    break; // 다음 모델로 즉시 전환
                }
                
                // 마지막 시도가 아니면 잠시 대기
                if (attempt < maxRetriesPerModel) {
                    await new Promise(res => setTimeout(res, 1000 * attempt));
                } else {
                    console.log(`🔄 All attempts failed for ${modelName}, trying next model`);
                    updateModelStatus(modelName, 'failed');
                }
            }
        }
    }
    
    // 모든 모델이 실패한 경우
    updateProgress(null, '❌ 모든 AI 모델이 실패했습니다. 잠시 후 다시 시도해주세요.');
    throw new Error('All fallback models failed. Please try again later.');
}

// 기존 함수명과의 호환성을 위한 별칭
const generateWithRetry = generateWithFallback;

// --- UI MANAGEMENT ---
function showView(view) {
    authSection.classList.add('hidden');
    appContent.classList.add('hidden');
    characterCardsSection.classList.add('hidden');
    characterCreationSection.classList.add('hidden');
    characterDetailSection.classList.add('hidden');
    matchingSection.classList.add('hidden');
    battleSection.classList.add('hidden');
    adminSection.classList.add('hidden');

    if (view === 'auth') {
        authSection.classList.remove('hidden');
    } else if (view === 'character-cards') {
        appContent.classList.remove('hidden');
        characterCardsSection.classList.remove('hidden');
    } else if (view === 'character-creation') {
        appContent.classList.remove('hidden');
        characterCreationSection.classList.remove('hidden');
    } else if (view === 'character-detail') {
        appContent.classList.remove('hidden');
        characterDetailSection.classList.remove('hidden');
    } else if (view === 'matching') {
        appContent.classList.remove('hidden');
        matchingSection.classList.remove('hidden');
    } else if (view === 'battle') {
        appContent.classList.remove('hidden');
        battleSection.classList.remove('hidden');
    } else if (view === 'admin') {
        appContent.classList.remove('hidden');
        adminSection.classList.remove('hidden');
    }
}

// --- AUTHENTICATION ---
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        logoutBtn.classList.remove('hidden');
        showRankingBtn.classList.remove('hidden');
        adminBtn.classList.remove('hidden');
        showView('character-cards');
        loadUserCharacters();
        fetchAllCharacters(); // Cache all characters for opponent finding
    } else {
        logoutBtn.classList.add('hidden');
        showRankingBtn.classList.add('hidden');
        adminBtn.classList.add('hidden');
        showView('auth');
        characterCardsGrid.innerHTML = '';
        resetBattleArena();
    }
});

signupBtn.addEventListener('click', async () => {
    const id = idInput.value.trim();
    const password = passwordInput.value;
    if (!id || password.length < 6) {
        alert('아이디를 입력하고, 비밀번호를 6자리 이상 설정해주세요.');
        return;
    }
    const email = await createEmailFromId(id);
    if (!email) return;

    createUserWithEmailAndPassword(auth, email, password)
        .catch((error) => {
            if (error.code === 'auth/email-already-in-use') {
                alert('이미 사용 중인 아이디입니다.');
            } else {
                alert(`회원가입 실패: ${error.code}`);
            }
        });
});

loginBtn.addEventListener('click', async () => {
    const id = idInput.value.trim();
    const password = passwordInput.value;
    if (!id || !password) {
        alert('아이디와 비밀번호를 입력해주세요.');
        return;
    }
    const email = await createEmailFromId(id);
    if (!email) {
        alert('이메일 생성에 실패했습니다. 다시 시도해주세요.');
        return;
    }

    signInWithEmailAndPassword(auth, email, password)
        .catch((error) => {
            if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                alert('아이디 또는 비밀번호가 잘못되었습니다.');
            } else {
                alert(`로그인 실패: ${error.code}`);
            }
        });
});

logoutBtn.addEventListener('click', () => { signOut(auth); });

// 랭킹 버튼 이벤트 리스너 추가
showRankingBtn.addEventListener('click', () => {
    loadRanking();
    rankingModal.classList.remove('hidden');
});

// --- CHARACTER CREATION ---
generateCharacterBtn.addEventListener('click', async () => {
    const charConcept = document.getElementById('char-concept').value;
    const charName = document.getElementById('char-name').value;
    
    if (!charConcept.trim()) {
        alert('캐릭터 컨셉을 입력해주세요.');
        return;
    }
    
    // 캐릭터 개수 제한 확인 (4개까지)
    try {
        const userQuery = query(collection(db, `users/${currentUser.uid}/characters`));
        const userSnapshot = await getDocs(userQuery);
        
        if (userSnapshot.size >= 4) {
            alert('캐릭터는 최대 4개까지만 생성할 수 있습니다.');
            return;
        }
    } catch (error) {
        console.error('캐릭터 개수 확인 오류:', error);
        alert('캐릭터 개수를 확인하는 중 오류가 발생했습니다.');
        return;
    }

    generateCharacterBtn.disabled = true;
    characterPreview.classList.add('hidden');
    generationProgressContainer.classList.remove('hidden');
    updateProgress(0, '시작 중...');

    const prompt = `
        당신은 AI 캐릭터 생성기입니다. 다음 조건을 엄격히 준수하여 판타지 캐릭터를 생성해주세요.
        
        **중요 규칙:**
        1. 사용자가 이름을 제공했다면 반드시 그 이름을 사용하세요.
        2. 캐릭터의 모든 요소(클래스, 성격, 스킬)는 주어진 컨셉과 일치해야 합니다.
        3. 이미지 프롬프트는 생성된 캐릭터의 정확한 외형과 특징을 반영해야 합니다.
        
        **입력 정보:**
        - 캐릭터 이름: ${charName ? `"${charName}" (반드시 이 이름을 사용하세요)` : '(자유롭게 생성)'}
        - 캐릭터 컨셉: "${charConcept}"
        
        **생성 요구사항:**
        - 캐릭터의 클래스, 성격, 배경 이야기는 주어진 컨셉과 완벽히 일치해야 합니다.
        - 공격 스킬 2개와 방어 스킬 2개를 캐릭터의 클래스와 컨셉에 맞게 설계하세요.
        - 이미지 프롬프트는 생성된 캐릭터의 클래스, 성격, 외형적 특징을 정확히 묘사해야 합니다.
        - 배경 이야기는 캐릭터의 탄생 배경과 상세 정보를 포함하여 3-4문장으로 작성하세요.
        - 성격은 핵심 특성 2-3가지로 요약하세요.
        - 스킬 설명은 각각 1-2문장으로 명확하게 작성하세요.
        - 특히 거미 관련 컨셉의 경우, 거미의 특성(독, 거미줄, 민첩성, 다리 등)을 반영한 캐릭터를 만들어주세요.
        
        결과는 반드시 다음 JSON 형식에 맞춰서 한글로 작성해주세요. image_prompt만 영어로 작성해주세요:
        {
          "name": "${charName || '캐릭터 이름'}",
          "class": "캐릭터 클래스",
          "personality": "캐릭터 성격",
          "story": "캐릭터의 탄생 배경과 상세 정보",
          "origin_story": "캐릭터의 탄생 스토리 - 어떻게 태어났고 어떤 운명을 가지고 있는지에 대한 흥미진진한 이야기 (4-5문장)",
          "attack_skills": [
            { "name": "공격 스킬1 이름", "description": "공격 스킬1 설명" },
            { "name": "공격 스킬2 이름", "description": "공격 스킬2 설명" }
          ],
          "defense_skills": [
            { "name": "방어 스킬1 이름", "description": "방어 스킬1 설명" },
            { "name": "방어 스킬2 이름", "description": "방어 스킬2 설명" }
          ],
          "image_prompt": "Detailed English prompt for AI image generation that accurately depicts the character's class, appearance, and concept"
        }
    `;

    // 동적 로딩 메시지 시스템
    const loadingMessages = [
        '영웅의 운명을 깨우는 중...',
        '고대의 힘을 불러오는 중...',
        '전설의 무기를 단련하는 중...',
        '신비한 마법을 엮어내는 중...',
        '용맹한 정신을 주입하는 중...',
        '숨겨진 재능을 발견하는 중...',
        '운명의 실을 엮는 중...',
        '고귀한 혈통을 각성시키는 중...',
        '전투의 기예를 전수하는 중...',
        '불굴의 의지를 심어주는 중...'
    ];
    
    let messageIndex = 0;
    let messageInterval;
    
    const startDynamicMessages = () => {
        messageInterval = setInterval(() => {
            updateProgress(null, loadingMessages[messageIndex]);
            messageIndex = (messageIndex + 1) % loadingMessages.length;
        }, 1500);
    };
    
    const stopDynamicMessages = () => {
        if (messageInterval) {
            clearInterval(messageInterval);
        }
    };

    try {
        // 1. Generate character data
        startDynamicMessages();
        updateProgress(10, loadingMessages[0]);
        
        const result = await generateWithFallback(prompt);
        const response = await result.response;
        const text = response.text();
        
        stopDynamicMessages();
        updateProgress(50, '캐릭터 정보 생성 완료!');
        
        const jsonString = text.match(/\{.*\}/s)[0];
        const parsedData = JSON.parse(jsonString);
        
        // 사용자가 입력한 이름이 있다면 강제로 적용
        if (charName && charName.trim()) {
            parsedData.name = charName.trim();
            console.log(`사용자 입력 이름으로 강제 설정: ${parsedData.name}`);
        }
        
        // 필수 필드 검증
        if (!parsedData.name || !parsedData.class || !parsedData.image_prompt) {
            throw new Error('생성된 캐릭터 데이터에 필수 정보가 누락되었습니다.');
        }

        // 2. Generate character image
        updateProgress(60, `${parsedData.name}의 모습을 그려내는 중...`);
        const imageUrl = await generateAndUploadImage(parsedData.image_prompt, parsedData.name, parsedData.class, charConcept);
        parsedData.imageUrl = imageUrl;
        updateProgress(90, '영웅의 초상화 완성!');

        // 3. Save to database
        parsedData.wins = 0;
        parsedData.losses = 0;
        parsedData.owner = currentUser.uid;
        parsedData.createdBy = currentUser.uid;
        parsedData.createdAt = new Date().toISOString();
        // 외형 프롬프트를 별도로 저장 (전투 이미지 생성에 활용)
        parsedData.appearance_prompt = parsedData.image_prompt;
        await addDoc(collection(db, `users/${currentUser.uid}/characters`), parsedData);
        updateProgress(100, `${parsedData.name} 탄생 완료!`);
        
        alert(`${parsedData.name} 캐릭터가 생성되었습니다!`);
        document.getElementById('character-creation-form').reset();
        showView('character-cards');
        loadUserCharacters();
        // 새 캐릭터 생성 후 캐시 업데이트
        await fetchAllCharacters();

    } catch (error) {
        console.error("캐릭터 생성 전체 과정 오류:", error);
        alert('캐릭터 생성에 실패했습니다. 콘솔을 확인해주세요.');
        updateProgress(100, '오류 발생!');
        generationProgressBar.classList.add('bg-red-500'); // Show error in progress bar
    } finally {
        // Hide progress bar after a delay
        setTimeout(() => {
            generationProgressContainer.classList.add('hidden');
            generationProgressBar.classList.remove('bg-red-500'); // Reset color
        }, 3000);
        generateCharacterBtn.disabled = false;
    }
});

async function callImageGenerationApi(prompt) {
    console.log('=== Hugging Face API 호출 시작 ===');
    console.log('프롬프트 길이:', prompt.length);
    console.log('프롬프트 내용 (처음 200자):', prompt.substring(0, 200) + '...');
    
    try {
        console.log('API 요청 전송 중...');
        const response = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer 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',
                'Content-Type': 'application/json',
                'x-wait-for-model': 'true'
            },
            body: JSON.stringify({
                inputs: prompt
            })
        });
        
        console.log('API 응답 상태:', response.status, response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API 오류 응답:', errorText);
            throw new Error(`Hugging Face API request failed with status ${response.status}: ${errorText}`);
        }

        console.log('이미지 데이터 수신 중...');
        const imageBuffer = await response.arrayBuffer();
        console.log('수신된 이미지 버퍼 크기:', imageBuffer.byteLength, 'bytes');
        
        if (imageBuffer.byteLength > 1000) {
            console.log('이미지 base64 변환 시작...');
            // 안전한 base64 변환 방식
            const uint8Array = new Uint8Array(imageBuffer);
            let binaryString = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binaryString += String.fromCharCode(uint8Array[i]);
            }
            const base64Image = btoa(binaryString);
            console.log(`=== 이미지 생성 성공 ===`);
            console.log(`이미지 크기: ${imageBuffer.byteLength} bytes`);
            console.log(`Base64 길이: ${base64Image.length} characters`);
            return `data:image/png;base64,${base64Image}`;
        } else {
            console.error('수신된 데이터가 너무 작음:', imageBuffer.byteLength, 'bytes');
            throw new Error('Received data too small to be an image');
        }

    } catch (error) {
        console.error("=== Hugging Face API 오류 ===:");
        console.error('오류 타입:', error.name);
        console.error('오류 메시지:', error.message);
        console.error('전체 오류:', error);
        // 오류 시 플레이스홀더 이미지 반환
        return `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgNTEyIDUxMiI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2ZmNjY2NiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIj5JbWFnZSBFcnJvcjwvdGV4dD48L3N2Zz4=`;
    }
}

// ...
async function generateAndUploadImage(imagePrompt, characterName, characterClass, characterConcept) {
    console.log(`Generating image for ${characterName} with AI...`);
    
    // 컨셉에 따른 특별한 프롬프트 처리
    let conceptKeywords = '';
    const lowerConcept = characterConcept.toLowerCase();
    
    if (lowerConcept.includes('거미') || lowerConcept.includes('spider')) {
        conceptKeywords = 'spider-themed character, arachnid features, web patterns, eight legs or spider-like appendages, dark fantasy';
    } else if (lowerConcept.includes('용') || lowerConcept.includes('dragon')) {
        conceptKeywords = 'dragon-themed character, draconic features, scales, wings, fire elements';
    } else if (lowerConcept.includes('마법사') || lowerConcept.includes('wizard') || lowerConcept.includes('mage')) {
        conceptKeywords = 'wizard character, magical robes, staff or wand, mystical aura, spell effects';
    } else if (lowerConcept.includes('전사') || lowerConcept.includes('warrior') || lowerConcept.includes('knight')) {
        conceptKeywords = 'warrior character, armor, sword and shield, heroic pose, battle-ready';
    }
    
    // 강화된 이미지 프롬프트 생성
    const enhancedPrompt = `${imagePrompt}, ${conceptKeywords}, fantasy character portrait, ${characterClass || 'fantasy character'}, high quality, detailed, digital art, concept art style, professional illustration, centered composition, dramatic lighting, vibrant colors, masterpiece quality, full body or portrait view`;
    
    console.log(`Enhanced image prompt: ${enhancedPrompt}`);
    
    try {
        const imageUrl = await callImageGenerationApi(enhancedPrompt);
        return imageUrl;
    } catch (error) {
        console.error(`Error generating image for ${characterName}:`, error);
        return `https://placehold.co/512x512/EEE/31343C.png?text=${encodeURIComponent(characterName)}`;
    }
}

async function saveCharacter(characterData) {
    if (!characterData || !currentUser) {
        throw new Error("저장할 캐릭터 데이터 또는 현재 유저 정보가 없습니다.");
    }
    try {
        await addDoc(collection(db, `users/${currentUser.uid}/characters`), characterData);
        alert(`${characterData.name}이(가) 당신의 동료가 되었습니다!`);
        loadUserCharacters(); // 목록 새로고침
    } catch (error) {
        console.error("캐릭터 저장 오류: ", error);
        throw new Error('캐릭터를 데이터베이스에 저장하는 데 실패했습니다.');
    }
}

// --- CHARACTER MANAGEMENT ---
async function loadUserCharacters() {
    if (!currentUser) return;
    characterCardsGrid.innerHTML = '<p>캐릭터를 불러오는 중...</p>';
    try {
        // 현재 사용자의 캐릭터 로드
        const userQuery = query(collection(db, `users/${currentUser.uid}/characters`), orderBy('name', 'asc'));
        const userSnapshot = await getDocs(userQuery);
        
        const userCharacters = [];
        userSnapshot.forEach((doc) => {
            userCharacters.push({ id: doc.id, ...doc.data() });
        });
        
        // 전체 캐릭터에서 현재 사용자가 만든 캐릭터 찾기 (과거 테스트 캐릭터 포함)
        const allCharsQuery = query(collectionGroup(db, 'characters'));
        const allCharsSnapshot = await getDocs(allCharsQuery);
        
        allCharsSnapshot.forEach((doc) => {
            const charData = doc.data();
            // 현재 사용자가 만든 캐릭터이지만 사용자 컬렉션에 없는 경우 추가
            if (charData.createdBy === currentUser.uid && !userCharacters.find(c => c.id === doc.id)) {
                userCharacters.push({ id: doc.id, ...charData });
            }
        });
        
        // 이름순으로 정렬
        userCharacters.sort((a, b) => a.name.localeCompare(b.name));
        
        characterCardsGrid.innerHTML = '';
        
        // 캐릭터 생성 카드 추가
        const createCard = document.createElement('div');
        createCard.className = 'create-character-card';
        
        // 캐릭터 개수가 4개에 도달했는지 확인
        const isLimitReached = userCharacters.length >= 4;
        
        if (isLimitReached) {
            createCard.classList.add('disabled');
            createCard.innerHTML = `
                <div class="create-card-content">
                    <div class="create-icon disabled">✕</div>
                    <h3>생성 제한 도달</h3>
                    <p>캐릭터 생성 한도에 도달했습니다</p>
                    <p class="create-limit">(4개/4개)</p>
                </div>
            `;
        } else {
            createCard.innerHTML = `
                <div class="create-card-content">
                    <div class="create-icon">+</div>
                    <h3>새로운 영웅 생성</h3>
                    <p>새로운 모험을 시작하세요</p>
                    <p class="create-limit">(${userCharacters.length}/4개)</p>
                </div>
            `;
            createCard.addEventListener('click', () => {
                showView('character-creation');
            });
        }
        
        characterCardsGrid.appendChild(createCard);
        
        // 기존 캐릭터 카드들 추가
        if (userCharacters.length === 0) {
            // 빈 메시지는 생성 카드만 표시
        } else {
            userCharacters.forEach((character) => {
                const card = createMainCharacterCard(character);
                characterCardsGrid.appendChild(card);
            });
        }
    } catch (error) {
        console.error("캐릭터 로딩 오류: ", error);
        characterCardsGrid.innerHTML = '<p>캐릭터를 불러오는데 실패했습니다.</p>';
    }
}

// 메인 화면용 캐릭터 카드 생성
function createMainCharacterCard(character) {
    const card = document.createElement('div');
    card.className = 'character-main-card';
    card.dataset.characterId = character.id;

    const wins = character.wins || 0;
    const losses = character.losses || 0;
    const totalBattles = wins + losses;
    const winRate = totalBattles > 0 ? Math.round((wins / totalBattles) * 100) : 0;

    card.innerHTML = `
        <div class="character-image-container">
            <img src="${character.imageUrl || 'https://placehold.co/512x512/EEE/31343C.png?text=No+Image'}" alt="${character.name}" class="character-image" onerror="this.src='https://placehold.co/512x512/EEE/31343C.png?text=Error'">
        </div>
        <div class="character-info">
            <h3 class="character-name">${character.name}</h3>
            <p class="character-class">${character.class || '클래스 정보 없음'}</p>
            <div class="character-stats">
                <span class="win-rate">${winRate}%</span>
                <span class="record">${wins}승 ${losses}패</span>
            </div>
        </div>
    `;

    card.addEventListener('click', () => {
        showCharacterDetail(character);
    });

    return card;
}

// 기존 createCharacterCard 함수 (배틀용)
function createCharacterCard(character, type) {
    const card = document.createElement('div');
    card.className = 'character-card';
    card.dataset.characterId = character.id;

    // Debug log for image URL
    console.log(`Creating card for ${character.name}, imageUrl: ${character.imageUrl}`);
    
    // Correct placeholder URL and image handling
    card.innerHTML = `
        <img src="${character.imageUrl || 'https://placehold.co/512x512/EEE/31343C.png?text=No+Image'}" alt="${character.name}" class="character-card-image" onerror="this.src='https://placehold.co/512x512/EEE/31343C.png?text=Error'">
        <h3>${character.name}</h3>
        <p class="character-class">${character.class || '클래스 정보 없음'}</p>
        <p class="character-personality"><strong>성격:</strong> ${character.personality || '정보 없음'}</p>
        <p class="character-story">${character.story || '스토리 정보 없음'}</p>
        <p class="character-record">전적: ${character.wins || 0}승 / ${character.losses || 0}패</p>
    `;

    const buttonWrapper = document.createElement('div');
    buttonWrapper.className = 'character-card-buttons';

    const skillButton = document.createElement('button');
    skillButton.textContent = '스킬 보기';
    skillButton.className = 'skill-button';
    skillButton.onclick = (e) => {
        e.stopPropagation();
        showSkillModal(character);
    };
    buttonWrapper.appendChild(skillButton);

    if (type === 'management') {
        const deleteButton = document.createElement('button');
        deleteButton.textContent = '삭제';
        deleteButton.className = 'delete-button';
        deleteButton.onclick = (e) => {
            e.stopPropagation();
            deleteCharacter(character.id, character.name);
        };
        buttonWrapper.appendChild(deleteButton);
        
        card.classList.add('is-selectable');
        card.onclick = () => selectPlayerForBattle(character, card);
    }
    
    card.appendChild(buttonWrapper);

    return card;
}

// 캐릭터 상세 정보 표시
async function showCharacterDetail(character) {
    detailCharacterName.textContent = character.name;
    
    const wins = character.wins || 0;
    const losses = character.losses || 0;
    const totalBattles = wins + losses;
    const winRate = totalBattles > 0 ? Math.round((wins / totalBattles) * 100) : 0;
    
    // 전체 캐릭터 순위 계산
    let characterRank = '계산 중...';
    try {
        const allCharacters = await getAllCharactersForRanking();
        const sortedCharacters = allCharacters.sort((a, b) => {
            const aWinRate = (a.wins || 0) / Math.max((a.wins || 0) + (a.losses || 0), 1);
            const bWinRate = (b.wins || 0) / Math.max((b.wins || 0) + (b.losses || 0), 1);
            if (aWinRate !== bWinRate) return bWinRate - aWinRate;
            return (b.wins || 0) - (a.wins || 0);
        });
        const rank = sortedCharacters.findIndex(c => c.id === character.id) + 1;
        characterRank = rank > 0 ? `${rank}위 / ${sortedCharacters.length}명` : '순위 없음';
    } catch (error) {
        console.error('순위 계산 오류:', error);
        characterRank = '순위 계산 실패';
    }
    
    // 최근 전투 기록 가져오기
    const recentBattles = await getRecentBattles(character.id);
    
    characterDetailContent.innerHTML = `
        <div class="character-detail-container">
            <!-- 캐릭터 이미지 섹션 -->
            <div class="character-detail-header">
                <div class="character-image-container" onclick="openImageModal('${character.imageUrl || 'https://placehold.co/512x512/EEE/31343C.png?text=No+Image'}', '${character.name}')">
                    <img src="${character.imageUrl || 'https://placehold.co/512x512/EEE/31343C.png?text=No+Image'}" alt="${character.name}" onerror="this.src='https://placehold.co/512x512/EEE/31343C.png?text=Error'">
                </div>
                <div class="character-basic-info">
                    <h2>${character.name}</h2>
                    <div class="character-class">${character.class || '정보 없음'}</div>
                    <div class="character-rank">전체 순위: ${characterRank}</div>
                </div>
            </div>
            
            <!-- 스탯 카드들 -->
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">승률</div>
                    <div class="stat-value">${winRate}%</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">승수</div>
                    <div class="stat-value">${wins}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">패배</div>
                    <div class="stat-value">${losses}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">총 전투</div>
                    <div class="stat-value">${totalBattles}</div>
                </div>
            </div>
            
            <!-- 탭 네비게이션 -->
            <div class="tab-navigation">
                <button class="tab-btn active" onclick="switchTab('story')">배경 이야기</button>
                <button class="tab-btn" onclick="switchTab('skills')">스킬</button>
                <button class="tab-btn" onclick="switchTab('origin')">탄생 스토리</button>
                <button class="tab-btn" onclick="switchTab('battles')">전투 기록</button>
            </div>
            
            <!-- 탭 콘텐츠 -->
            <div class="tab-content">
                <!-- 배경 이야기 탭 -->
                <div id="story-tab" class="tab-panel active">
                    <div class="story-content">
                        ${character.story || '스토리 정보가 없습니다.'}
                    </div>
                </div>
                
                <!-- 스킬 탭 -->
                <div id="skills-tab" class="tab-panel">
                    <div class="skills-list">
                        ${character.attack_skills && character.attack_skills.length > 0 ? 
                            character.attack_skills.map(skill => 
                                `<div class="skill-card attack-skill">
                                    <div class="skill-icon">⚔️</div>
                                    <div class="skill-info">
                                        <div class="skill-name">${skill.name || skill.skill_name}</div>
                                        <div class="skill-description">${skill.description || skill.skill_description}</div>
                                    </div>
                                </div>`
                            ).join('') : ''}
                        ${character.defense_skills && character.defense_skills.length > 0 ? 
                            character.defense_skills.map(skill => 
                                `<div class="skill-card defense-skill">
                                    <div class="skill-icon">🛡️</div>
                                    <div class="skill-info">
                                        <div class="skill-name">${skill.name || skill.skill_name}</div>
                                        <div class="skill-description">${skill.description || skill.skill_description}</div>
                                    </div>
                                </div>`
                            ).join('') : ''}
                        ${(!character.attack_skills || character.attack_skills.length === 0) && (!character.defense_skills || character.defense_skills.length === 0) ? 
                            '<div class="no-skills">등록된 스킬이 없습니다.</div>' : ''}
                    </div>
                </div>
                
                <!-- 탄생 스토리 탭 -->
                <div id="origin-tab" class="tab-panel">
                    <div class="origin-story-content">
                        ${character.origin_story || '이 캐릭터는 신비로운 힘에 의해 탄생했습니다. 그들의 기원은 고대의 전설 속에 숨겨져 있으며, 시간이 흐르면서 그 진실이 밝혀질 것입니다.'}
                    </div>
                </div>
                
                <!-- 전투 기록 탭 -->
                <div id="battles-tab" class="tab-panel">
                    <div class="battle-records">
                        ${recentBattles.length > 0 ? 
                            recentBattles.map(battle => 
                                `<div class="battle-record-item ${battle.result}" 
                                      onclick="showOpponentCharacterDetail('${battle.opponentId}', '${battle.opponentName}')" 
                                      style="cursor: pointer;" title="클릭하여 ${battle.opponentName} 정보 보기">
                                    <div class="battle-opponent">
                                        <img src="${battle.opponentImage}" alt="${battle.opponentName}" class="opponent-avatar clickable-opponent">
                                        <div class="battle-info">
                                            <div class="opponent-name">vs ${battle.opponentName}</div>
                                            <div class="battle-date">${battle.date}</div>
                                        </div>
                                    </div>
                                    <div class="battle-result ${battle.result}">
                                        ${battle.result === 'win' ? '승리' : '패배'}
                                    </div>
                                </div>`
                            ).join('') : 
                            '<div class="no-battles">아직 전투 기록이 없습니다.</div>'
                        }
                    </div>
                </div>
            </div>
            
            <!-- 액션 버튼들 -->
            <div class="character-detail-actions">
                <button class="action-btn battle-btn" onclick="startBattleFromDetail('${character.id}')">
                    ⚔️ 전투 시작
                </button>
                <button class="action-btn delete-btn" onclick="deleteCharacterFromDetail('${character.id}', '${character.name}')">
                    🗑️ 삭제
                </button>
            </div>
        </div>
    `;
    
    showView('character-detail');
}

// 상세 화면에서 전투 시작 - 매칭 화면으로 이동
async function startBattleFromDetail(characterId) {
    console.log('startBattleFromDetail 호출됨, characterId:', characterId);
    console.log('현재 allCharactersCache 길이:', allCharactersCache.length);
    
    let character = allCharactersCache.find(c => c.id === characterId);
    
    // 캐시에서 캐릭터를 찾을 수 없는 경우 캐시를 새로고침
    if (!character || allCharactersCache.length === 0) {
        console.log('캐시에서 캐릭터를 찾을 수 없음. 캐시 새로고침 중...');
        await fetchAllCharacters();
        character = allCharactersCache.find(c => c.id === characterId);
    }
    
    if (character) {
        console.log('캐릭터 찾음:', character.name);
        playerCharacterForBattle = character;
        
        // 상대방 찾기
        if (allCharactersCache.length > 1) {
            const availableOpponents = allCharactersCache.filter(c => c.id !== character.id);
            const randomOpponent = availableOpponents[Math.floor(Math.random() * availableOpponents.length)];
            opponentCharacterForBattle = randomOpponent;
            console.log('상대방 선택됨:', randomOpponent.name);
            
            // 매칭 화면으로 이동
            showView('matching');
            showMatchingScreen();
        } else {
            alert('전투할 상대가 없습니다. 다른 캐릭터를 생성해주세요.');
        }
    } else {
        console.error('캐릭터를 찾을 수 없습니다:', characterId);
        alert('캐릭터 정보를 불러올 수 없습니다. 페이지를 새로고침해주세요.');
    }
}

// 매칭 화면 표시
function showMatchingScreen() {
    selectedSkills = []; // 스킬 선택 초기화
    
    matchingContent.innerHTML = `
        <div class="matching-container">
            <!-- 상대방 캐릭터 정보 -->
            <div class="opponent-info-section">
                <h3>매칭된 상대</h3>
                <div class="opponent-card" onclick="showOpponentDetails()">
                    <img src="${opponentCharacterForBattle.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" 
                         alt="${opponentCharacterForBattle.name}" class="opponent-image">
                    <div class="opponent-info">
                        <h4>${opponentCharacterForBattle.name}</h4>
                        <p class="opponent-class">${opponentCharacterForBattle.class || '정보 없음'}</p>
                        <div class="opponent-stats">
                            <span>승률: ${calculateWinRate(opponentCharacterForBattle)}%</span>
                            <span>전투: ${(opponentCharacterForBattle.wins || 0) + (opponentCharacterForBattle.losses || 0)}회</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- 내 캐릭터 스킬 선택 -->
            <div class="skill-selection-section">
                <h3>전투 스킬 선택</h3>
                <p class="skill-selection-subtitle">전투에 사용할 스킬 2개를 선택하세요</p>
                <div class="skills-grid">
                    ${generateSkillSelectionHTML()}
                </div>
                <div class="selected-skills-display">
                    <h4>선택된 스킬 (<span id="selected-count">0</span>/2)</h4>
                    <div id="selected-skills-list"></div>
                </div>
            </div>
            
            <!-- 전투 돌입 버튼 -->
            <div class="battle-start-section">
                <button id="enter-battle-btn" class="battle-start-btn hidden" onclick="enterBattle()">⚔️ 전투 돌입</button>
            </div>
        </div>
    `;
    
    // 체크박스 이벤트 리스너 추가
    setTimeout(() => {
        const checkboxes = document.querySelectorAll('.skills-grid .skill-checkbox');
        console.log('체크박스 개수:', checkboxes.length);
        checkboxes.forEach((checkbox, index) => {
            console.log(`체크박스 ${index} 이벤트 리스너 추가:`, checkbox);
            checkbox.addEventListener('change', handleMatchingSkillSelection);
        });
        
        // 초기 상태에서 updateSelectedSkillsDisplay 호출
        updateSelectedSkillsDisplay();
    }, 100);
}

// 승률 계산 헬퍼 함수
function calculateWinRate(character) {
    const wins = character.wins || 0;
    const losses = character.losses || 0;
    const total = wins + losses;
    return total > 0 ? Math.round((wins / total) * 100) : 0;
}

// 매칭 화면에서 체크박스 스킬 선택 핸들러
function handleMatchingSkillSelection(event) {
    const checkbox = event.target;
    const skill = JSON.parse(checkbox.dataset.skill.replace(/&apos;/g, "'"));
    const skillItem = checkbox.closest('.skill-selection-item');
    
    if (checkbox.checked) {
        // Select skill (limit to 2)
        if (selectedSkills.length < 2) {
            selectedSkills.push(skill);
            skillItem.classList.add('selected');
        } else {
            // Uncheck if limit reached
            checkbox.checked = false;
            return;
        }
    } else {
        // Deselect skill
        selectedSkills = selectedSkills.filter(s => (s.name || s.skill_name) !== (skill.name || skill.skill_name));
        skillItem.classList.remove('selected');
    }
    
    // 선택된 스킬 표시 업데이트
    updateSelectedSkillsDisplay();
}

// 스킬 선택 HTML 생성 (체크박스 방식)
function generateSkillSelectionHTML() {
    let skillsHTML = '';
    
    // 공격 스킬
    if (playerCharacterForBattle.attack_skills && playerCharacterForBattle.attack_skills.length > 0) {
        playerCharacterForBattle.attack_skills.forEach((skill, index) => {
            skillsHTML += `
                <div class="skill-selection-item">
                    <div class="skill-checkbox-container">
                        <input type="checkbox" id="matching-attack-skill-${index}" class="skill-checkbox" data-skill='${JSON.stringify(skill).replace(/'/g, "&apos;")}' data-skill-type="attack">
                        <label for="matching-attack-skill-${index}" class="skill-checkbox-label">
                            <span class="checkbox-custom"></span>
                        </label>
                    </div>
                    <div class="skill-info">
                        <div class="skill-header">
                            <span class="skill-icon">⚔️</span>
                            <span class="skill-name">${skill.name || skill.skill_name}</span>
                            <span class="skill-type attack-type">공격</span>
                        </div>
                        <div class="skill-description">${skill.description || skill.skill_description}</div>
                    </div>
                </div>
            `;
        });
    }
    
    // 방어 스킬
    if (playerCharacterForBattle.defense_skills && playerCharacterForBattle.defense_skills.length > 0) {
        playerCharacterForBattle.defense_skills.forEach((skill, index) => {
            skillsHTML += `
                <div class="skill-selection-item">
                    <div class="skill-checkbox-container">
                        <input type="checkbox" id="matching-defense-skill-${index}" class="skill-checkbox" data-skill='${JSON.stringify(skill).replace(/'/g, "&apos;")}' data-skill-type="defense">
                        <label for="matching-defense-skill-${index}" class="skill-checkbox-label">
                            <span class="checkbox-custom"></span>
                        </label>
                    </div>
                    <div class="skill-info">
                        <div class="skill-header">
                            <span class="skill-icon">🛡️</span>
                            <span class="skill-name">${skill.name || skill.skill_name}</span>
                            <span class="skill-type defense-type">방어</span>
                        </div>
                        <div class="skill-description">${skill.description || skill.skill_description}</div>
                    </div>
                </div>
            `;
        });
    }
    
    return skillsHTML || '<div class="no-skills">사용 가능한 스킬이 없습니다.</div>';
}

// selectSkill 함수는 제거됨 - selectSkillForBattle 사용

// 선택된 스킬 표시 업데이트
function updateSelectedSkillsDisplay() {
    const selectedCountElement = document.getElementById('selected-count');
    const selectedSkillsList = document.getElementById('selected-skills-list');
    const enterBattleBtn = document.getElementById('enter-battle-btn');
    
    console.log('updateSelectedSkillsDisplay 호출됨, 선택된 스킬 수:', selectedSkills.length);
    console.log('enterBattleBtn 요소:', enterBattleBtn);
    
    if (selectedCountElement) {
        selectedCountElement.textContent = selectedSkills.length;
    }
    
    if (selectedSkillsList) {
        selectedSkillsList.innerHTML = selectedSkills.map(skill => 
            `<div class="selected-skill-item">
                <span class="skill-icon">${skill.type === 'defense' || (skill.name || skill.skill_name).includes('방어') || (skill.name || skill.skill_name).includes('보호') ? '🛡️' : '⚔️'}</span>
                <span class="skill-name">${skill.name || skill.skill_name}</span>
            </div>`
        ).join('');
    }
    
    // 전투 돌입 버튼 활성화/비활성화
    if (enterBattleBtn) {
        console.log('전투 돌입 버튼 찾음, 스킬 수:', selectedSkills.length);
        if (selectedSkills.length === 2) {
            console.log('2개 스킬 선택됨, 버튼 활성화');
            enterBattleBtn.classList.remove('hidden');
            enterBattleBtn.disabled = false;
            enterBattleBtn.style.display = 'block'; // 강제로 표시
        } else {
            console.log('2개 미만 스킬 선택됨, 버튼 숨김');
            enterBattleBtn.classList.add('hidden');
            enterBattleBtn.disabled = true;
        }
    } else {
        console.log('전투 돌입 버튼을 찾을 수 없음');
    }
}

// 상대방 상세 정보 표시 함수는 1623번째 줄에 정의되어 있음

// 전투 돌입
function enterBattle() {
    console.log('enterBattle 함수 호출됨');
    console.log('현재 선택된 스킬 수:', selectedSkills.length);
    console.log('선택된 스킬:', selectedSkills);
    
    // 필수 데이터 검증
    if (!playerCharacterForBattle) {
        console.error('플레이어 캐릭터가 선택되지 않았습니다.');
        alert('플레이어 캐릭터를 먼저 선택해주세요.');
        return;
    }
    
    if (!opponentCharacterForBattle) {
        console.error('상대방 캐릭터가 설정되지 않았습니다.');
        alert('상대방을 먼저 찾아주세요.');
        return;
    }
    
    if (selectedSkills.length !== 2) {
        alert('전투에 사용할 스킬 2개를 선택해주세요.');
        return;
    }
    
    console.log('전투 돌입! 선택된 스킬:', selectedSkills);
    console.log('showView("battle") 호출 전');
    showView('battle');
    console.log('showView("battle") 호출 후');
    console.log('startBattleScreen() 호출 전');
    startBattleScreen();
    console.log('startBattleScreen() 호출 후');
}

// 전투 화면 시작
function startBattleScreen() {
    console.log('startBattleScreen 함수 시작');
    console.log('battleContent 요소:', battleContent);
    console.log('playerCharacterForBattle:', playerCharacterForBattle);
    console.log('opponentCharacterForBattle:', opponentCharacterForBattle);
    
    // 돌아가기 버튼이 보이도록 설정
    const backToMatchingBtn = document.getElementById('back-to-matching-btn');
    if (backToMatchingBtn) {
        backToMatchingBtn.style.display = 'block';
        backToMatchingBtn.disabled = false;
    }
    
    // 전투 화면 내용 설정
    battleContent.innerHTML = `
        <div class="battle-participants">
            <div class="battle-character player-side">
                <img src="${playerCharacterForBattle?.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" 
                     alt="${playerCharacterForBattle?.name || '내 캐릭터'}" class="battle-char-image">
                <h4>${playerCharacterForBattle?.name || '내 캐릭터'}</h4>
                <p class="char-class">${playerCharacterForBattle?.class || '알 수 없음'}</p>
                <div class="selected-skills">
                    <h5>선택된 스킬:</h5>
                    ${selectedSkills.map(skill => 
                        `<div class="skill-badge">${skill.name || skill.skill_name}</div>`
                    ).join('')}
                </div>
            </div>
            
            <div class="vs-divider">
                <span class="vs-text">VS</span>
            </div>
            
            <div class="battle-character opponent-side">
                <img src="${opponentCharacterForBattle?.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" 
                     alt="${opponentCharacterForBattle?.name || '상대방'}" class="battle-char-image">
                <h4>${opponentCharacterForBattle?.name || '상대방'}</h4>
                <p class="char-class">${opponentCharacterForBattle?.class || '알 수 없음'}</p>
                <div class="opponent-skills">
                    <h5>상대방 능력치:</h5>
                </div>
            </div>
        </div>
        
        <!-- 전투 게이지 -->
        <div id="new-battle-gauge-container" class="battle-gauge-container">
            <div class="gauge-header">
                <h4>전투 진행도</h4>
                <span id="gauge-percentage">0%</span>
            </div>
            <div id="new-battle-gauge-bar" class="gauge-bar">
                <div class="gauge-fill"></div>
            </div>
            <div id="gauge-status-text" class="gauge-status">전투 준비 중...</div>
        </div>
        
        <!-- 전투 로그 레이어 제거됨 -->
    `;
    
    // 전투 시작
    setTimeout(() => {
        startTurnBasedBattleNew();
    }, 1000);
}

// 상세 화면에서 캐릭터 삭제
function deleteCharacterFromDetail(characterId, characterName) {
    if (confirm(`정말로 '${characterName}' 캐릭터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
        deleteDoc(doc(db, `users/${currentUser.uid}/characters`, characterId))
            .then(() => {
                alert(`'${characterName}' 캐릭터가 성공적으로 삭제되었습니다.`);
                showView('character-cards');
                loadUserCharacters();
            })
            .catch((error) => {
                console.error("Error deleting character: ", error);
                alert('캐릭터 삭제 중 오류가 발생했습니다.');
            });
    }
}

// 상대방 캐릭터 정보 보기 함수
async function showOpponentCharacterDetail(opponentId, opponentName) {
    console.log('showOpponentCharacterDetail 호출됨:', { opponentId, opponentName });
    try {
        // 상대방 캐릭터 정보를 데이터베이스에서 가져오기
        console.log('캐릭터 참조 찾는 중...');
        const opponentRef = await findCharacterRef(opponentId);
        if (!opponentRef) {
            console.error('캐릭터 참조를 찾을 수 없음:', opponentId);
            alert('상대방 캐릭터 정보를 찾을 수 없습니다.');
            return;
        }
        
        console.log('캐릭터 문서 가져오는 중...');
        const opponentDoc = await getDoc(opponentRef);
        if (!opponentDoc.exists()) {
            console.error('캐릭터 문서가 존재하지 않음:', opponentId);
            alert('상대방 캐릭터 정보를 불러올 수 없습니다.');
            return;
        }
        
        const opponentData = { id: opponentDoc.id, ...opponentDoc.data() };
        console.log('캐릭터 데이터 로드 완료:', opponentData);
        
        // 상대방 캐릭터의 전투 기록도 가져오기
        console.log('전투 기록 가져오는 중...');
        const opponentBattles = await getRecentBattles(opponentId);
        console.log('전투 기록 로드 완료:', opponentBattles);
        
        // 상대방 캐릭터 정보를 새 창이나 모달로 표시
        console.log('모달 표시 중...');
        showOpponentModal(opponentData, opponentBattles);
        console.log('모달 표시 완료');
        
    } catch (error) {
        console.error('상대방 캐릭터 정보 로드 오류:', error);
        alert('상대방 캐릭터 정보를 불러오는 중 오류가 발생했습니다.');
    }
}

// 상대방 캐릭터 정보 모달 표시
function showOpponentModal(character, battles) {
    console.log('showOpponentModal 호출됨, 캐릭터 데이터:', character);
    console.log('origin_story 값:', character.origin_story);
    console.log('story 값:', character.story);
    
    // 기존 모달이 있다면 제거
    const existingModal = document.querySelector('.opponent-modal');
    if (existingModal) {
        console.log('기존 모달 발견, 제거 중...');
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.className = 'opponent-modal';
    modal.innerHTML = `
        <div class="opponent-modal-content">
            <div class="opponent-modal-header">
                <span class="opponent-close">&times;</span>
                <div class="opponent-image-container">
                    <img src="${character.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" 
                         alt="${character.name}" 
                         class="character-image-clickable">
                </div>
                <div class="opponent-basic-info">
                    <h2>${character.name}</h2>
                    <p class="opponent-class">${character.class || '정보 없음'}</p>
                </div>
                <div class="opponent-stats-grid">
                    <div class="opponent-stat-card">
                        <div class="opponent-stat-label">승리</div>
                        <div class="opponent-stat-value">${character.wins || 0}</div>
                    </div>
                    <div class="opponent-stat-card">
                        <div class="opponent-stat-label">패배</div>
                        <div class="opponent-stat-value">${character.losses || 0}</div>
                    </div>
                    <div class="opponent-stat-card">
                        <div class="opponent-stat-label">승률</div>
                        <div class="opponent-stat-value">${calculateWinRate(character)}%</div>
                    </div>
                </div>
            </div>
            
            <div class="opponent-tabs">
                <button class="opponent-tab active" data-tab="skills">스킬</button>
                <button class="opponent-tab" data-tab="story">배경 스토리</button>
            </div>
            
            <div class="opponent-tab-content">
                <!-- 스킬 탭 -->
                <div id="opponent-skills-tab" class="opponent-tab-panel active">
                    <div class="opponent-skills-list">
                        ${character.attack_skills && character.attack_skills.length > 0 ? 
                            character.attack_skills.map(skill => 
                                `<div class="opponent-skill-card attack-skill">
                                    <div class="opponent-skill-icon">⚔️</div>
                                    <div class="opponent-skill-info">
                                        <div class="opponent-skill-name">${skill.name || skill.skill_name}</div>
                                        <div class="opponent-skill-description">${skill.description || skill.skill_description}</div>
                                    </div>
                                </div>`
                            ).join('') : ''
                        }
                        ${character.defense_skills && character.defense_skills.length > 0 ? 
                            character.defense_skills.map(skill => 
                                `<div class="opponent-skill-card defense-skill">
                                    <div class="opponent-skill-icon">🛡️</div>
                                    <div class="opponent-skill-info">
                                        <div class="opponent-skill-name">${skill.name || skill.skill_name}</div>
                                        <div class="opponent-skill-description">${skill.description || skill.skill_description}</div>
                                    </div>
                                </div>`
                            ).join('') : ''
                        }
                        ${(!character.attack_skills || character.attack_skills.length === 0) && 
                          (!character.defense_skills || character.defense_skills.length === 0) ? 
                            '<div class="no-skills">표시할 스킬이 없습니다.</div>' : ''
                        }
                    </div>
                </div>
                
                <!-- 배경 스토리 탭 -->
                <div id="opponent-story-tab" class="opponent-tab-panel">
                    <div class="opponent-story-content">
                        ${character.origin_story || character.story || character.background || character.description || '이 캐릭터는 신비로운 힘에 의해 탄생했습니다. 그들의 과거는 베일에 싸여 있지만, 강력한 힘과 의지를 가지고 있습니다.'}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // DOM에 추가된 후 이벤트 리스너 등록
    const closeBtn = modal.querySelector('.opponent-close');
    const tabButtons = modal.querySelectorAll('.opponent-tab');
    const characterImage = modal.querySelector('.character-image-clickable');
    
    // 닫기 버튼 이벤트
    closeBtn.addEventListener('click', closeOpponentModal);
    
    // 탭 버튼 이벤트
    tabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const tabName = e.target.getAttribute('data-tab');
            switchOpponentTab(tabName, e.target);
        });
    });
    
    // 캐릭터 이미지 클릭 이벤트
    characterImage.addEventListener('click', () => {
        openImageModal(character.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?', character.name);
    });
    
    // 모달 표시
    setTimeout(() => {
        modal.classList.add('show');
        console.log('모달 표시 완료');
    }, 10);
    
    // 모달 외부 클릭 시 닫기 (약간의 지연을 두어 즉시 닫히는 것을 방지)
    setTimeout(() => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeOpponentModal();
            }
        });
    }, 100);
    
    console.log('모달 생성 및 이벤트 바인딩 완료');
}

// 상대방 모달 탭 전환
function switchOpponentTab(tabName, clickedElement) {
    console.log('=== switchOpponentTab 시작 ===');
    console.log('tabName:', tabName);
    console.log('clickedElement:', clickedElement);
    
    // 현재 모달 내에서만 탭과 패널 찾기
    const currentModal = document.querySelector('.opponent-modal');
    if (!currentModal) {
        console.error('모달을 찾을 수 없음');
        return;
    }
    console.log('모달 찾음:', currentModal);
    
    // 모달 내의 모든 탭 버튼에서 active 클래스 제거
    const allTabs = currentModal.querySelectorAll('.opponent-tab');
    console.log('모달 내 탭 버튼들:', allTabs.length);
    allTabs.forEach((btn, index) => {
        console.log(`탭 ${index}: ${btn.textContent}, active 제거 전:`, btn.classList.contains('active'));
        btn.classList.remove('active');
        console.log(`탭 ${index}: active 제거 후:`, btn.classList.contains('active'));
    });
    
    // 모달 내의 모든 탭 패널 숨기기
    const allPanels = currentModal.querySelectorAll('.opponent-tab-panel');
    console.log('모달 내 탭 패널들:', allPanels.length);
    allPanels.forEach((panel, index) => {
        console.log(`패널 ${index}: ${panel.id}, active 제거 전:`, panel.classList.contains('active'));
        panel.classList.remove('active');
        console.log(`패널 ${index}: active 제거 후:`, panel.classList.contains('active'));
    });
    
    // 선택된 탭 버튼에 active 클래스 추가
    if (clickedElement) {
        clickedElement.classList.add('active');
        console.log('클릭된 요소 활성화:', clickedElement.textContent, '활성화 후:', clickedElement.classList.contains('active'));
    } else {
        // 클릭된 요소가 없으면 data-tab 속성으로 찾기
        const tabButton = currentModal.querySelector(`[data-tab="${tabName}"]`);
        if (tabButton) {
            tabButton.classList.add('active');
            console.log('tabName으로 찾은 버튼 활성화:', tabButton.textContent);
        }
    }
    
    // 선택된 탭 패널 표시
    const targetPanelId = `opponent-${tabName}-tab`;
    console.log('찾을 타겟 패널 ID:', targetPanelId);
    
    const targetPanel = currentModal.querySelector(`#${targetPanelId}`);
    console.log('타겟 패널 찾기 결과:', targetPanel);
    
    if (targetPanel) {
        targetPanel.classList.add('active');
        console.log('패널 활성화 완료:', tabName);
        console.log('패널 active 클래스 확인:', targetPanel.classList.contains('active'));
        console.log('패널 내용 길이:', targetPanel.innerHTML.length);
        
        // 패널이 실제로 보이는지 확인
        setTimeout(() => {
            const computedStyle = window.getComputedStyle(targetPanel);
            console.log('패널 display 상태:', computedStyle.display);
            console.log('패널 visibility:', computedStyle.visibility);
        }, 100);
    } else {
        console.error('패널을 찾을 수 없음:', targetPanelId);
        // 모달 내 모든 패널 ID 출력
        const allPanelIds = Array.from(allPanels).map(p => p.id);
        console.log('모달 내 존재하는 패널 ID들:', allPanelIds);
    }
    
    console.log('=== switchOpponentTab 종료 ===');
}

// 이미지 확대 모달 함수
function openImageModal(imageUrl, characterName) {
    const imageModal = document.createElement('div');
    imageModal.className = 'image-modal';
    imageModal.innerHTML = `
        <div class="image-modal-content">
            <span class="image-modal-close" onclick="closeImageModal()">&times;</span>
            <img src="${imageUrl}" alt="${characterName}" class="enlarged-image">
            <div class="image-modal-caption">${characterName}</div>
        </div>
    `;
    
    document.body.appendChild(imageModal);
    setTimeout(() => {
        imageModal.classList.add('show');
    }, 10);
}

function closeImageModal() {
    const modal = document.querySelector('.image-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.remove();
        }, 300);
    }
}

// 상대방 모달 닫기
function closeOpponentModal() {
    console.log('closeOpponentModal 호출됨');
    const modal = document.querySelector('.opponent-modal');
    if (modal) {
        console.log('모달 찾음, 닫기 시작');
        
        // 강제로 모달 제거 (애니메이션 없이)
        modal.remove();
        console.log('모달 즉시 제거 완료');
    } else {
        console.log('모달을 찾을 수 없음');
    }
}

// 전역 함수로 등록 (HTML onclick에서 접근 가능하도록)
window.startBattleFromDetail = startBattleFromDetail;
window.deleteCharacterFromDetail = deleteCharacterFromDetail;
window.switchTab = switchTab;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.selectSkillForBattle = selectSkillForBattle;
window.enterBattle = enterBattle;
window.showOpponentCharacterDetail = showOpponentCharacterDetail;
window.switchOpponentTab = switchOpponentTab;
window.closeOpponentModal = closeOpponentModal;

// 전체 캐릭터 순위 계산을 위한 함수
async function getAllCharactersForRanking() {
    try {
        const charactersSnapshot = await getDocs(collectionGroup(db, 'characters'));
        const characters = [];
        charactersSnapshot.forEach((doc) => {
            characters.push({ id: doc.id, ...doc.data() });
        });
        return characters;
    } catch (error) {
        console.error('전체 캐릭터 가져오기 오류:', error);
        return [];
    }
}

// 최근 전투 기록 가져오기 (임시 데이터)
async function getRecentBattles(characterId) {
    try {
        // 캐릭터의 전투 기록을 데이터베이스에서 가져오기
        const characterRef = await findCharacterRef(characterId);
        if (!characterRef) {
            console.log('캐릭터를 찾을 수 없습니다:', characterId);
            return [];
        }
        
        // 캐릭터의 battleHistory 서브컬렉션에서 전투 기록 가져오기
        const battleHistoryRef = collection(characterRef, 'battleHistory');
        const q = query(battleHistoryRef, orderBy('createdAt', 'desc'), limit(10));
        const querySnapshot = await getDocs(q);
        
        const battles = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            battles.push({
                id: doc.id,
                opponentName: data.opponentName,
                opponentId: data.opponentId,
                opponentImage: data.opponentImage || 'https://placehold.co/50x50/333/fff?text=?',
                result: data.result,
                date: new Date(data.battleDate).toLocaleDateString('ko-KR'),
                battleDate: data.battleDate,
                playerSkills: data.playerSkills || [],
                opponentSkills: data.opponentSkills || []
            });
        });
        
        console.log('전투 기록을 가져왔습니다:', battles);
        return battles;
        
    } catch (error) {
        console.error('전투 기록을 가져오는 중 오류:', error);
        return [];
    }
}

// 탭 전환 함수
function switchTab(tabName) {
    // 모든 탭 버튼에서 active 클래스 제거
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // 모든 탭 패널 숨기기
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    
    // 선택된 탭 버튼에 active 클래스 추가
    event.target.classList.add('active');
    
    // 선택된 탭 패널 표시
    const targetPanel = document.getElementById(`${tabName}-tab`);
    if (targetPanel) {
        targetPanel.classList.add('active');
    }
}



// --- RESTORED FUNCTIONS ---
function showSkillModal(character) {
    skillModalCharName.textContent = character.name;
    skillList.innerHTML = '';
    
    let hasSkills = false;
    
    // 공격 스킬 표시
    if (character.attack_skills && character.attack_skills.length > 0) {
        const attackHeader = document.createElement('li');
        attackHeader.innerHTML = '<strong style="color: #ff6b6b;">🗡️ 공격 스킬</strong>';
        attackHeader.style.marginBottom = '10px';
        skillList.appendChild(attackHeader);
        
        character.attack_skills.forEach(skill => {
            const skillItem = document.createElement('li');
            skillItem.innerHTML = `<strong>${skill.name || skill.skill_name}:</strong> ${skill.description || skill.skill_description}`;
            skillItem.style.marginLeft = '20px';
            skillItem.style.marginBottom = '8px';
            skillList.appendChild(skillItem);
        });
        hasSkills = true;
    }
    
    // 방어 스킬 표시
    if (character.defense_skills && character.defense_skills.length > 0) {
        const defenseHeader = document.createElement('li');
        defenseHeader.innerHTML = '<strong style="color: #4ecdc4;">🛡️ 방어 스킬</strong>';
        defenseHeader.style.marginTop = '15px';
        defenseHeader.style.marginBottom = '10px';
        skillList.appendChild(defenseHeader);
        
        character.defense_skills.forEach(skill => {
            const skillItem = document.createElement('li');
            skillItem.innerHTML = `<strong>${skill.name || skill.skill_name}:</strong> ${skill.description || skill.skill_description}`;
            skillItem.style.marginLeft = '20px';
            skillItem.style.marginBottom = '8px';
            skillList.appendChild(skillItem);
        });
        hasSkills = true;
    }
    
    if (!hasSkills) {
        skillList.innerHTML = '<li>표시할 스킬이 없습니다.</li>';
    }
    
    skillModal.classList.remove('hidden');
}

async function deleteCharacter(characterId, characterName) {
    if (confirm(`정말로 '${characterName}' 캐릭터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
        try {
            await deleteDoc(doc(db, `users/${currentUser.uid}/characters`, characterId));
            alert(`'${characterName}' 캐릭터가 성공적으로 삭제되었습니다.`);
            loadUserCharacters();
        } catch (error) {
            console.error("Error deleting character: ", error);
            alert('캐릭터 삭제 중 오류가 발생했습니다.');
        }
    }
}

function selectPlayerForBattle(character, cardElement) {
    if (selectedCharacterCard) {
        selectedCharacterCard.classList.remove('selected');
    }
    cardElement.classList.add('selected');
    selectedCharacterCard = cardElement;

    playerCharacterForBattle = character;
    showView('battle');
    
    // 초기 상태로 리셋
    resetBattleArena();
    
    playerBattleCard.innerHTML = '';
    playerBattleCard.appendChild(createCharacterCard(character, 'battle'));
    
    const battleGuideText = document.getElementById('battle-guide-text');
    if (battleGuideText) {
        battleGuideText.textContent = '좋습니다! 이제 [상대 찾기] 버튼을 눌러주세요.';
    }
    findOpponentBtn.disabled = false;
    opponentBattleCard.innerHTML = '';
    startBattleBtn.classList.add('hidden');
    battleLog.classList.add('hidden');
    playerSkillSelection.classList.add('hidden');
}

// --- BATTLE SYSTEM (RESTRUCTURED) ---
async function fetchAllCharacters() {
    console.log("Caching all characters for opponent finding...");
    try {
        const q = query(collectionGroup(db, 'characters'));
        const querySnapshot = await getDocs(q);
        allCharactersCache = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`Cached ${allCharactersCache.length} characters.`);
    } catch (error) {
        console.error("Error caching all characters: ", error);
    }
}

// 뒤로가기 버튼 이벤트 리스너들
backToCardsBtn.addEventListener('click', () => {
    showView('character-cards');
});

backToCardsFromDetailBtn.addEventListener('click', () => {
    showView('character-cards');
});

if (backToListBtn) {
    backToListBtn.addEventListener('click', () => {
        resetBattleArena();
        showView('character-cards');
    });
}

if (findOpponentBtn) {
    findOpponentBtn.addEventListener('click', async () => {
    findOpponentBtn.disabled = true;
    opponentBattleCard.innerHTML = '<p>상대를 찾는 중...</p>';
    const battleGuideText = document.getElementById('battle-guide-text');

    try {
        // Use cache. If it's empty for some reason, try fetching again.
        if (allCharactersCache.length < 2) {
            await fetchAllCharacters();
        }

        const opponents = allCharactersCache.filter(char => char.id.split('_')[0] !== currentUser.uid);

        if (opponents.length === 0) {
            opponentBattleCard.innerHTML = '<p>싸울 상대가 아직 없습니다. 다른 유저가 캐릭터를 만들 때까지 기다려주세요.</p>';
            if (battleGuideText) {
            battleGuideText.textContent = '현재 대결 가능한 상대가 없습니다.';
        }
            findOpponentBtn.disabled = false;
            return;
        }

        const randomIndex = Math.floor(Math.random() * opponents.length);
        opponentCharacterForBattle = opponents[randomIndex];

        // 매칭된 상대방 화면으로 전환
        showMatchedOpponentScreen();

    } catch (error) {
        console.error("Error finding opponent: ", error);
        opponentBattleCard.innerHTML = '<p>상대를 찾는 중 오류가 발생했습니다.</p>';
        if (battleGuideText) {
            battleGuideText.textContent = '오류가 발생했습니다. 다시 시도해주세요.';
        }
        findOpponentBtn.disabled = false;
    }
    });
}

function resetBattleArena() {
    playerCharacterForBattle = null;
    opponentCharacterForBattle = null;
    if (selectedCharacterCard) {
        selectedCharacterCard.classList.remove('selected');
        selectedCharacterCard = null;
    }
    if (playerBattleCard) playerBattleCard.innerHTML = '';
    if (opponentBattleCard) opponentBattleCard.innerHTML = '';
    if (battleLog) battleLog.classList.add('hidden');
    if (findOpponentBtn) findOpponentBtn.disabled = true;
    if (startBattleBtn) {
        startBattleBtn.disabled = true;
        startBattleBtn.classList.add('hidden');
    }
    if (playerSkillSelection) playerSkillSelection.classList.add('hidden');
    if (skillChoicesContainer) skillChoicesContainer.innerHTML = '';
    
    // 매칭 화면 제거
    const matchedScreen = document.getElementById('matched-opponent-screen');
    if (matchedScreen) {
        matchedScreen.remove();
    }
}

function resetBattleState() {
    // 전투 관련 상태 초기화
    selectedSkills = [];
    playerCharacterForBattle = null;
    opponentCharacterForBattle = null;
    
    // 스킬 선택 체크박스 상태 초기화
    const skillCheckboxes = document.querySelectorAll('.skill-checkbox');
    skillCheckboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    
    // UI 요소들 초기화
    if (selectedCharacterCard) {
        selectedCharacterCard.classList.remove('selected');
        selectedCharacterCard = null;
    }
    
    // 전투 UI 요소들 숨기기
    const battleLog = document.getElementById('battle-log');
    const newBattleGaugeContainer = document.getElementById('new-battle-gauge-container');
    const playerSkillSelection = document.getElementById('player-skill-selection');
    
    if (battleLog) battleLog.classList.add('hidden');
    if (newBattleGaugeContainer) {
        newBattleGaugeContainer.classList.add('hidden');
        // 게이지 바 초기화
        const gaugeFill = document.querySelector('.gauge-fill');
        const gaugePercentage = document.getElementById('gauge-percentage');
        const gaugeStatusText = document.getElementById('gauge-status-text');
        const gaugeBar = document.querySelector('.gauge-bar');
        
        if (gaugeFill) gaugeFill.style.width = '0%';
        if (gaugePercentage) gaugePercentage.textContent = '0%';
        if (gaugeStatusText) gaugeStatusText.textContent = '전투 준비 중...';
        if (gaugeBar) {
            gaugeBar.classList.remove('active');
            gaugeBar.style.boxShadow = '';
        }
    }
    if (playerSkillSelection) playerSkillSelection.classList.add('hidden');
    
    // 버튼 상태 초기화 - 안전하게 요소 확인
    const findOpponentBtn = document.getElementById('find-opponent-btn');
    const startBattleBtn = document.getElementById('start-battle-btn');
    const backToListBtn = document.getElementById('back-to-list-btn');
    
    if (findOpponentBtn) findOpponentBtn.disabled = true;
    if (startBattleBtn) {
        startBattleBtn.disabled = true;
        startBattleBtn.classList.add('hidden');
    }
    if (backToListBtn) backToListBtn.disabled = false;
    
    // 배틀 카드 초기화
    const playerBattleCard = document.getElementById('player-battle-card');
    const opponentBattleCard = document.getElementById('opponent-battle-card');
    
    if (playerBattleCard) playerBattleCard.innerHTML = '';
    if (opponentBattleCard) opponentBattleCard.innerHTML = '';
    
    // 스킬 선택 컨테이너 초기화
    const skillChoicesContainer = document.getElementById('skill-choices-container');
    if (skillChoicesContainer) skillChoicesContainer.innerHTML = '';
    
    // 매칭 화면 제거
    const matchedScreen = document.getElementById('matched-opponent-screen');
    if (matchedScreen) {
        matchedScreen.remove();
    }
    
    // 기존 UI 복원 - 안전하게 요소 확인
    const battleArenaContainer = document.getElementById('battle-arena-container');
    const battleControls = document.getElementById('battle-controls');
    
    if (battleArenaContainer) battleArenaContainer.classList.remove('hidden');
    if (battleControls) battleControls.classList.remove('hidden');
    
    const battleGuideTextReset = document.getElementById('battle-guide-text');
    if (battleGuideTextReset) {
        battleGuideTextReset.textContent = '내 캐릭터 목록에서 전투에 내보낼 캐릭터를 선택하세요.';
    }
    
    // 이미지 관련 요소들 숨기기
    const generateBattleImageBtn = document.getElementById('generate-battle-image-btn');
    const battleImageContainer = document.getElementById('battle-image-container');
    const generatedBattleImage = document.getElementById('generated-battle-image');
    
    if (generateBattleImageBtn) generateBattleImageBtn.classList.add('hidden');
    if (battleImageContainer) battleImageContainer.classList.add('hidden');
    if (generatedBattleImage) generatedBattleImage.src = '';
}

// 전투 포기 후 완전한 상태 초기화 함수
function resetBattleStateCompletely() {
    // 기본 전투 상태 초기화
    resetBattleState();
    
    // 추가로 캐릭터 선택 상태도 완전히 초기화
    selectedSkills = [];
    playerCharacterForBattle = null;
    opponentCharacterForBattle = null;
    selectedCharacterCard = null;
    
    // 모든 캐릭터 카드의 선택 상태 해제
    const allCharacterCards = document.querySelectorAll('.character-card, .arena-character-card');
    allCharacterCards.forEach(card => {
        card.classList.remove('selected');
    });
    
    // 모든 스킬 선택 상태 완전 초기화
    const allSkillItems = document.querySelectorAll('.skill-selection-item');
    allSkillItems.forEach(item => {
        item.classList.remove('selected');
        const checkbox = item.querySelector('.skill-checkbox');
        if (checkbox) {
            checkbox.checked = false;
        }
    });
    
    // 호버 효과나 기타 시각적 상태도 초기화
    const allSkillCheckboxes = document.querySelectorAll('.skill-checkbox');
    allSkillCheckboxes.forEach(checkbox => {
        checkbox.checked = false;
        const skillItem = checkbox.closest('.skill-selection-item');
        if (skillItem) {
            skillItem.classList.remove('selected', 'hover');
        }
    });
}

// 전투 포기 후 매칭 화면으로 돌아가는 함수
async function returnToMatchingAfterForfeit() {
    console.log('전투 포기 후 매칭 화면으로 돌아가는 중...');
    
    // 현재 플레이어 캐릭터가 있는지 확인
    if (!playerCharacterForBattle) {
        console.log('플레이어 캐릭터가 없어서 아레나로 돌아갑니다.');
        loadCharactersForArena();
        showView('battle');
        return;
    }
    
    try {
        // 새로운 상대 찾기
        const newOpponent = await findRandomOpponent(playerCharacterForBattle.id);
        
        if (!newOpponent) {
            console.log('새로운 상대를 찾을 수 없어서 아레나로 돌아갑니다.');
            loadCharactersForArena();
            showView('battle');
            return;
        }
        
        // 새로운 상대 설정
        opponentCharacterForBattle = newOpponent;
        
        // 스킬 선택 완전 초기화
        selectedSkills = [];
        
        // 매칭 화면 표시 (완전히 새로운 상태로)
        showMatchedOpponentScreenFresh(newOpponent);
        showView('battle');
        
        console.log('새로운 상대 매칭 완료:', newOpponent.name);
        
    } catch (error) {
        console.error('새로운 상대 매칭 중 오류:', error);
        loadCharactersForArena();
        showView('battle');
    }
}

function displaySkillSelection() {
    const skillSelectionContainer = document.getElementById('player-skill-selection');
    const skillChoicesContainer = document.getElementById('skill-choices-container');

    if (skillSelectionContainer) skillSelectionContainer.classList.remove('hidden');
    if (skillChoicesContainer) skillChoicesContainer.innerHTML = ''; // Clear previous skill buttons.

    if (playerCharacterForBattle) {
        // 공격 스킬 추가
        if (playerCharacterForBattle.attack_skills) {
            playerCharacterForBattle.attack_skills.forEach((skill, index) => {
                const skillItem = document.createElement('div');
                skillItem.className = 'skill-selection-item';
                
                skillItem.innerHTML = `
                    <div class="skill-checkbox-container">
                        <input type="checkbox" id="attack-skill-${index}" class="skill-checkbox" data-skill='${JSON.stringify(skill).replace(/'/g, "&apos;")}' data-skill-type="attack">
                        <label for="attack-skill-${index}" class="skill-checkbox-label">
                            <span class="checkbox-custom"></span>
                        </label>
                    </div>
                    <div class="skill-info">
                        <div class="skill-header">
                            <span class="skill-icon">⚔️</span>
                            <span class="skill-name">${skill.name || skill.skill_name}</span>
                            <span class="skill-type attack-type">공격</span>
                        </div>
                        <div class="skill-description">${skill.description || skill.skill_description || '스킬 설명이 없습니다.'}</div>
                    </div>
                `;
                
                skillChoicesContainer.appendChild(skillItem);
            });
        }
        
        // 방어 스킬 추가
        if (playerCharacterForBattle.defense_skills) {
            playerCharacterForBattle.defense_skills.forEach((skill, index) => {
                const skillItem = document.createElement('div');
                skillItem.className = 'skill-selection-item';
                
                skillItem.innerHTML = `
                    <div class="skill-checkbox-container">
                        <input type="checkbox" id="defense-skill-${index}" class="skill-checkbox" data-skill='${JSON.stringify(skill).replace(/'/g, "&apos;")}' data-skill-type="defense">
                        <label for="defense-skill-${index}" class="skill-checkbox-label">
                            <span class="checkbox-custom"></span>
                        </label>
                    </div>
                    <div class="skill-info">
                        <div class="skill-header">
                            <span class="skill-icon">🛡️</span>
                            <span class="skill-name">${skill.name || skill.skill_name}</span>
                            <span class="skill-type defense-type">방어</span>
                        </div>
                        <div class="skill-description">${skill.description || skill.skill_description || '스킬 설명이 없습니다.'}</div>
                    </div>
                `;
                
                skillChoicesContainer.appendChild(skillItem);
            });
        }
        
        // 체크박스 이벤트 리스너 추가
        const checkboxes = skillChoicesContainer.querySelectorAll('.skill-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', handleSkillSelection);
        });
    }

    selectedSkills = []; // Reset selected skills array
    updateBattleGuideText();
    const startBattleBtnLocal = document.getElementById('start-battle-btn');
    if (startBattleBtnLocal) {
        startBattleBtnLocal.disabled = true; // Disable battle button initially
        startBattleBtnLocal.classList.add('hidden');
    }
}

// 매칭된 상대방 화면 표시 함수
function showMatchedOpponentScreen() {
    // 기존 전투 UI 숨기기
    const battleArenaContainer = document.getElementById('battle-arena-container');
    const battleControls = document.getElementById('battle-controls');
    
    if (battleArenaContainer) battleArenaContainer.classList.add('hidden');
    if (battleControls) battleControls.classList.add('hidden');
    
    // 매칭된 상대방 정보 화면 생성
    const matchedScreen = document.createElement('div');
    matchedScreen.id = 'matched-opponent-screen';
    matchedScreen.className = 'matched-screen';
    
    matchedScreen.innerHTML = `
        <div class="matched-header">
            <h3>매칭 완료!</h3>
            <p>당신의 상대가 결정되었습니다.</p>
        </div>
        <div class="opponent-info-container">
            <div class="opponent-card-wrapper" onclick="showOpponentDetails()">
                <div class="opponent-card">
                    <img src="${opponentCharacterForBattle.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" 
                         alt="${opponentCharacterForBattle.name}" class="opponent-image">
                    <div class="opponent-info">
                        <h4>${opponentCharacterForBattle.name}</h4>
                        <p class="opponent-class">${opponentCharacterForBattle.class}</p>
                        <p class="click-hint">클릭하여 상세 정보 보기</p>
                    </div>
                </div>
            </div>
        </div>
        <div class="skill-selection-area">
            <h4>전투에 사용할 능력치 2개를 선택하세요</h4>
            <div id="matched-skill-choices" class="skill-choices-grid"></div>
            <button id="matched-start-battle-btn" class="start-battle-btn" disabled>전투 시작</button>
        </div>
    `;
    
    // 기존 arena에 추가
    const arena = document.getElementById('arena');
    arena.appendChild(matchedScreen);
    
    // 스킬 선택 UI 생성
    createMatchedSkillSelection();
    
    // 가이드 텍스트 업데이트
    const battleGuideTextMatched = document.getElementById('battle-guide-text');
    if (battleGuideTextMatched) {
        battleGuideTextMatched.textContent = '상대방 카드를 클릭하여 정보를 확인하고, 전투에 사용할 능력치를 선택하세요.';
    }
}

// 매칭 화면에서의 스킬 선택 UI 생성 (체크박스 방식)
function createMatchedSkillSelection() {
    const skillChoicesContainer = document.getElementById('matched-skill-choices');
    skillChoicesContainer.innerHTML = '';
    
    if (playerCharacterForBattle) {
        // 공격 스킬 추가
        if (playerCharacterForBattle.attack_skills) {
            playerCharacterForBattle.attack_skills.forEach((skill, index) => {
                const skillItem = document.createElement('div');
                skillItem.className = 'skill-selection-item';
                
                skillItem.innerHTML = `
                    <div class="skill-checkbox-container">
                        <input type="checkbox" id="matched-attack-skill-${index}" class="skill-checkbox" data-skill='${JSON.stringify(skill).replace(/'/g, "&apos;")}' data-skill-type="attack">
                        <label for="matched-attack-skill-${index}" class="skill-checkbox-label">
                            <span class="checkbox-custom"></span>
                        </label>
                    </div>
                    <div class="skill-info">
                        <div class="skill-header">
                            <span class="skill-icon">⚔️</span>
                            <span class="skill-name">${skill.name || skill.skill_name}</span>
                            <span class="skill-type attack-type">공격</span>
                        </div>
                        <div class="skill-description">${skill.description || skill.skill_description || '스킬 설명이 없습니다.'}</div>
                    </div>
                `;
                
                skillChoicesContainer.appendChild(skillItem);
            });
        }
        
        // 방어 스킬 추가
        if (playerCharacterForBattle.defense_skills) {
            playerCharacterForBattle.defense_skills.forEach((skill, index) => {
                const skillItem = document.createElement('div');
                skillItem.className = 'skill-selection-item';
                
                skillItem.innerHTML = `
                    <div class="skill-checkbox-container">
                        <input type="checkbox" id="matched-defense-skill-${index}" class="skill-checkbox" data-skill='${JSON.stringify(skill).replace(/'/g, "&apos;")}' data-skill-type="defense">
                        <label for="matched-defense-skill-${index}" class="skill-checkbox-label">
                            <span class="checkbox-custom"></span>
                        </label>
                    </div>
                    <div class="skill-info">
                        <div class="skill-header">
                            <span class="skill-icon">🛡️</span>
                            <span class="skill-name">${skill.name || skill.skill_name}</span>
                            <span class="skill-type defense-type">방어</span>
                        </div>
                        <div class="skill-description">${skill.description || skill.skill_description || '스킬 설명이 없습니다.'}</div>
                    </div>
                `;
                
                skillChoicesContainer.appendChild(skillItem);
            });
        }
        
        // 체크박스 이벤트 리스너 추가
        const checkboxes = skillChoicesContainer.querySelectorAll('.skill-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', handleMatchedSkillSelection);
        });
    }
    
    selectedSkills = []; // Reset selected skills
    
    // 전투 시작 버튼 이벤트 리스너
    document.getElementById('matched-start-battle-btn').addEventListener('click', () => {
        startBattleFromMatched();
    });
}

// 매칭 화면에서 체크박스 스킬 선택
function handleMatchedSkillSelection(event) {
    const checkbox = event.target;
    const skill = JSON.parse(checkbox.dataset.skill.replace(/&apos;/g, "'"));
    const skillItem = checkbox.closest('.skill-selection-item');
    
    if (checkbox.checked) {
        // Select skill (limit to 2)
        if (selectedSkills.length < 2) {
            selectedSkills.push(skill);
            skillItem.classList.add('selected');
        } else {
            // Uncheck if limit reached
            checkbox.checked = false;
            return;
        }
    } else {
        // Deselect skill
        selectedSkills = selectedSkills.filter(s => (s.name || s.skill_name) !== (skill.name || skill.skill_name));
        skillItem.classList.remove('selected');
    }
    
    // 전투 시작 버튼 활성화/비활성화
    const startBtn = document.getElementById('matched-start-battle-btn');
    if (selectedSkills.length === 2) {
        startBtn.disabled = false;
        startBtn.textContent = '전투 시작';
    } else {
        startBtn.disabled = true;
        startBtn.textContent = `능력치 ${2 - selectedSkills.length}개 더 선택하세요`;
    }
}

// 기존 함수는 호환성을 위해 유지
function selectMatchedSkill(button) {
    const skill = JSON.parse(button.dataset.skill);
    const skillName = skill.name || skill.skill_name;
    
    const index = selectedSkills.findIndex(s => (s.name || s.skill_name) === skillName);
    
    if (index > -1) {
        // 이미 선택된 경우 선택 해제
        selectedSkills.splice(index, 1);
        button.classList.remove('selected');
    } else {
        // 선택되지 않은 경우 선택 (최대 2개)
        if (selectedSkills.length < 2) {
            selectedSkills.push(skill);
            button.classList.add('selected');
        }
    }
    
    // 전투 시작 버튼 활성화/비활성화
    const startBtn = document.getElementById('matched-start-battle-btn');
    if (selectedSkills.length === 2) {
        startBtn.disabled = false;
        startBtn.textContent = '전투 시작';
    } else {
        startBtn.disabled = true;
        startBtn.textContent = `능력치 ${2 - selectedSkills.length}개 더 선택하세요`;
    }
}

// 상대방 상세 정보 표시
function showOpponentDetails() {
    if (!opponentCharacterForBattle) return;
    
    const modal = document.createElement('div');
    modal.className = 'opponent-detail-modal';
    modal.innerHTML = `
        <div class="opponent-detail-content">
            <span class="close-opponent-detail" onclick="closeOpponentDetail()">&times;</span>
            <div class="opponent-detail-header">
                <img src="${opponentCharacterForBattle.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" 
                     alt="${opponentCharacterForBattle.name}" class="opponent-detail-image">
                <div class="opponent-detail-info">
                    <h3>${opponentCharacterForBattle.name}</h3>
                    <p class="opponent-detail-class">${opponentCharacterForBattle.class}</p>
                    <p class="opponent-detail-personality">${opponentCharacterForBattle.personality || '성격 정보 없음'}</p>
                </div>
            </div>
            <div class="opponent-detail-story">
                <h4>배경 이야기</h4>
                <p>${opponentCharacterForBattle.story || opponentCharacterForBattle.origin_story || '배경 이야기 없음'}</p>
            </div>
            <div class="opponent-detail-skills">
                <div class="skill-section">
                    <h4>🗡️ 공격 스킬</h4>
                    ${opponentCharacterForBattle.attack_skills ? 
                        opponentCharacterForBattle.attack_skills.map(skill => 
                            `<div class="skill-item">
                                <strong>${skill.name || skill.skill_name}</strong>
                                <p>${skill.description || skill.skill_description}</p>
                            </div>`
                        ).join('') : '<p>공격 스킬 정보 없음</p>'
                    }
                </div>
                <div class="skill-section">
                    <h4>🛡️ 방어 스킬</h4>
                    ${opponentCharacterForBattle.defense_skills ? 
                        opponentCharacterForBattle.defense_skills.map(skill => 
                            `<div class="skill-item">
                                <strong>${skill.name || skill.skill_name}</strong>
                                <p>${skill.description || skill.skill_description}</p>
                            </div>`
                        ).join('') : '<p>방어 스킬 정보 없음</p>'
                    }
                </div>
            </div>
            <div class="opponent-detail-stats">
                <h4>전적</h4>
                <p>승리: ${opponentCharacterForBattle.wins || 0}회 | 패배: ${opponentCharacterForBattle.losses || 0}회</p>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 모달 외부 클릭 시 닫기
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeOpponentDetail();
        }
    });
}

// 상대방 상세 정보 모달 닫기
function closeOpponentDetail() {
    const modal = document.querySelector('.opponent-detail-modal');
    if (modal) {
        modal.remove();
    }
}

// 매칭 화면에서 전투 시작
function startBattleFromMatched() {
    // 매칭 화면의 내용을 전투 화면으로 변경
    const matchedScreen = document.getElementById('matched-opponent-screen');
    if (matchedScreen) {
        // 매칭 화면을 전투 화면으로 변환
        matchedScreen.innerHTML = `
            <div class="battle-in-progress">
                <div class="battle-header">
                    <h3>⚔️ 전투 진행 중 ⚔️</h3>
                    <p>치열한 전투가 벌어지고 있습니다!</p>
                </div>
                <div class="battle-participants-centered">
                    <div class="battle-character player-side">
                        <img src="${playerCharacterForBattle.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" 
                             alt="${playerCharacterForBattle.name}" class="battle-char-image">
                        <h4>${playerCharacterForBattle.name}</h4>
                        <p class="char-class">${playerCharacterForBattle.class}</p>
                        <div class="selected-skills">
                            <h5>선택된 능력치:</h5>
                            ${selectedSkills.map(skill => 
                                `<div class="skill-badge">${skill.name || skill.skill_name}</div>`
                            ).join('')}
                        </div>
                    </div>
                    <div class="vs-indicator">
                        <div class="vs-text">VS</div>
                        <div class="battle-animation">⚡</div>
                    </div>
                    <div class="battle-character opponent-side">
                        <img src="${opponentCharacterForBattle.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" 
                             alt="${opponentCharacterForBattle.name}" class="battle-char-image">
                        <h4>${opponentCharacterForBattle.name}</h4>
                        <p class="char-class">${opponentCharacterForBattle.class}</p>
                        <div class="opponent-skills">
                            <h5>상대방 능력치:</h5>
                            <div class="skill-badge">???</div>
                            <div class="skill-badge">???</div>
                        </div>
                    </div>
                </div>
                <div id="new-battle-gauge-container" class="new-battle-gauge-container" style="display: block !important; visibility: visible !important; opacity: 1 !important;">
                    <div class="gauge-header">
                        <h3>전투 진행도</h3>
                        <span id="gauge-percentage">0%</span>
                    </div>
                    <div class="gauge-bar-wrapper">
                        <div id="new-battle-gauge-bar" class="gauge-bar" style="display: block !important; visibility: visible !important;">
                            <div class="gauge-fill" style="display: block !important; visibility: visible !important; width: 0%; height: 100%;"></div>
                            <div class="gauge-glow"></div>
                        </div>
                    </div>
                    <div class="gauge-status">
                        <span id="gauge-status-text">전투 준비 중...</span>
                    </div>
                </div>
                <div id="battle-log-container" class="battle-log-area">
                    <div id="battle-log-content"></div>
                </div>
                <div class="battle-actions">
                    <button id="back-to-arena-btn" class="back-btn" onclick="showBattleExitModal()">전투 포기</button>
                </div>
            </div>
        `;
        
        // 전투 시작
        startTurnBasedBattleNew();
    }
}

// 전투 포기 모달 표시 함수
function showBattleExitModal() {
    // 기존 모달이 있다면 제거
    const existingModal = document.querySelector('.modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>⚠️ 전투 포기</h3>
            <p>정말로 전투를 포기하시겠습니까?</p>
            <p><strong>전투를 포기하면 패배로 처리됩니다.</strong></p>
            <div class="modal-buttons">
                <button onclick="confirmBattleExit()" class="confirm-btn">포기하기</button>
                <button onclick="closeBattleExitModal()" class="cancel-btn">계속 전투</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // 모달 외부 클릭 시 닫기
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeBattleExitModal();
        }
    });
}

// 전투 포기 확인 함수
async function confirmBattleExit() {
    // 먼저 모달 닫기
    closeBattleExitModal();
    
    try {
        // 진행 중인 전투 중단 (API 호출 중단)
        if (window.battleInProgress) {
            window.battleInProgress = false;
        }
        
        // 전투 관련 UI 숨기기
        const newBattleGaugeContainer = document.getElementById('new-battle-gauge-container');
        const battleLog = document.getElementById('battle-log');
        const matchedScreen = document.getElementById('matched-opponent-screen');
        const battleSection = document.getElementById('battle-section');
        
        if (newBattleGaugeContainer) {
            newBattleGaugeContainer.classList.add('hidden');
        }
        if (battleLog) {
            battleLog.classList.add('hidden');
        }
        if (battleSection) {
            battleSection.classList.add('hidden');
        }
        
        // 매칭 화면 제거
        if (matchedScreen) {
            matchedScreen.remove();
        }
        
        // 패배 처리 - 상대방이 승자, 플레이어가 패자 (조용히 처리)
        if (playerCharacterForBattle && opponentCharacterForBattle) {
            await updateCharacterStats(opponentCharacterForBattle, playerCharacterForBattle);
            console.log('Battle forfeit recorded: Winner -', opponentCharacterForBattle.name, 'Loser -', playerCharacterForBattle.name);
        }
        
        // 전투 상태 완전 초기화
        resetBattleStateCompletely();
        
        // 아레나 화면으로 돌아가기 (캐릭터 선택 화면)
        loadCharactersForArena();
        showView('character-cards');
        
    } catch (error) {
        console.error('Error recording battle forfeit:', error);
        // 오류가 발생해도 화면은 정상적으로 돌아가도록 처리
        resetBattleStateCompletely();
        loadCharactersForArena();
        showView('character-cards');
    }
}

// 새로운 상대 매칭 함수
async function matchNewOpponent() {
    console.log('새로운 상대 매칭 시작...');
    
    // 현재 플레이어 캐릭터가 있는지 확인
    if (!playerCharacterForBattle) {
        console.log('플레이어 캐릭터가 없어서 아레나로 돌아갑니다.');
        loadCharactersForArena();
        return;
    }
    
    try {
        // 새로운 상대 찾기
        const newOpponent = await findRandomOpponent(playerCharacterForBattle.id);
        
        if (!newOpponent) {
            console.log('새로운 상대를 찾을 수 없어서 아레나로 돌아갑니다.');
            loadCharactersForArena();
            return;
        }
        
        // 새로운 상대 설정
        opponentCharacterForBattle = newOpponent;
        
        // 스킬 선택 초기화
        selectedSkills = [];
        
        // 매칭 화면 표시
        showMatchedOpponentScreen(newOpponent);
        
        console.log('새로운 상대 매칭 완료:', newOpponent.name);
        
    } catch (error) {
        console.error('새로운 상대 매칭 중 오류:', error);
        loadCharactersForArena();
    }
}

// 전투 포기 후 완전히 새로운 매칭 화면 표시 함수
function showMatchedOpponentScreenFresh(opponent) {
    // 기존 매칭 화면이 있다면 완전히 제거
    const existingMatchedScreen = document.getElementById('matched-opponent-screen');
    if (existingMatchedScreen) {
        existingMatchedScreen.remove();
    }
    
    // 기존 전투 UI 숨기기
    const battleArenaContainer = document.getElementById('battle-arena-container');
    const battleControls = document.getElementById('battle-controls');
    
    if (battleArenaContainer) battleArenaContainer.classList.add('hidden');
    if (battleControls) battleControls.classList.add('hidden');
    
    // 완전히 새로운 매칭 화면 생성
    const matchedScreen = document.createElement('div');
    matchedScreen.id = 'matched-opponent-screen';
    matchedScreen.className = 'matched-screen';
    
    matchedScreen.innerHTML = `
        <div class="matched-header">
            <h3>매칭 완료!</h3>
            <p>새로운 상대가 결정되었습니다.</p>
        </div>
        <div class="opponent-info-container">
            <div class="opponent-card-wrapper" onclick="showOpponentDetails()">
                <div class="opponent-card">
                    <img src="${opponent.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" 
                         alt="${opponent.name}" class="opponent-image">
                    <div class="opponent-info">
                        <h4>${opponent.name}</h4>
                        <p class="opponent-class">${opponent.class}</p>
                        <p class="click-hint">클릭하여 상세 정보 보기</p>
                    </div>
                </div>
            </div>
        </div>
        <div class="skill-selection-area">
            <h4>전투에 사용할 능력치 2개를 선택하세요</h4>
            <div id="matched-skill-choices" class="skill-choices-grid"></div>
            <button id="matched-start-battle-btn" class="start-battle-btn" disabled>능력치 2개를 선택하세요</button>
        </div>
    `;
    
    // arena에 추가
    const arena = document.getElementById('arena');
    arena.appendChild(matchedScreen);
    
    // 완전히 새로운 스킬 선택 UI 생성
    createMatchedSkillSelectionFresh();
}

// 전투 포기 후 완전히 새로운 스킬 선택 UI 생성 함수
function createMatchedSkillSelectionFresh() {
    const skillChoicesContainer = document.getElementById('matched-skill-choices');
    if (!skillChoicesContainer) return;
    
    // 기존 내용 완전히 제거
    skillChoicesContainer.innerHTML = '';
    
    // 선택된 스킬 배열 완전 초기화
    selectedSkills = [];
    
    if (playerCharacterForBattle) {
        // 공격 스킬 추가
        if (playerCharacterForBattle.attack_skills) {
            playerCharacterForBattle.attack_skills.forEach((skill, index) => {
                const skillItem = document.createElement('div');
                skillItem.className = 'skill-selection-item';
                
                skillItem.innerHTML = `
                    <div class="skill-checkbox-container">
                        <input type="checkbox" id="fresh-attack-skill-${index}" class="skill-checkbox" data-skill='${JSON.stringify(skill).replace(/'/g, "&apos;")}' data-skill-type="attack">
                        <label for="fresh-attack-skill-${index}" class="skill-checkbox-label">
                            <span class="checkbox-custom"></span>
                        </label>
                    </div>
                    <div class="skill-info">
                        <div class="skill-header">
                            <span class="skill-icon">⚔️</span>
                            <span class="skill-name">${skill.name || skill.skill_name}</span>
                            <span class="skill-type attack-type">공격</span>
                        </div>
                        <div class="skill-description">${skill.description || skill.skill_description || '스킬 설명이 없습니다.'}</div>
                    </div>
                `;
                
                skillChoicesContainer.appendChild(skillItem);
            });
        }
        
        // 방어 스킬 추가
        if (playerCharacterForBattle.defense_skills) {
            playerCharacterForBattle.defense_skills.forEach((skill, index) => {
                const skillItem = document.createElement('div');
                skillItem.className = 'skill-selection-item';
                
                skillItem.innerHTML = `
                    <div class="skill-checkbox-container">
                        <input type="checkbox" id="fresh-defense-skill-${index}" class="skill-checkbox" data-skill='${JSON.stringify(skill).replace(/'/g, "&apos;")}' data-skill-type="defense">
                        <label for="fresh-defense-skill-${index}" class="skill-checkbox-label">
                            <span class="checkbox-custom"></span>
                        </label>
                    </div>
                    <div class="skill-info">
                        <div class="skill-header">
                            <span class="skill-icon">🛡️</span>
                            <span class="skill-name">${skill.name || skill.skill_name}</span>
                            <span class="skill-type defense-type">방어</span>
                        </div>
                        <div class="skill-description">${skill.description || skill.skill_description || '스킬 설명이 없습니다.'}</div>
                    </div>
                `;
                
                skillChoicesContainer.appendChild(skillItem);
            });
        }
        
        // 새로운 체크박스 이벤트 리스너 추가
        const checkboxes = skillChoicesContainer.querySelectorAll('.skill-checkbox');
        checkboxes.forEach(checkbox => {
            // 체크 상태 완전 초기화
            checkbox.checked = false;
            checkbox.addEventListener('change', handleMatchedSkillSelectionFresh);
        });
    }
    
    // 전투 시작 버튼 이벤트 리스너 (기존 리스너 제거 후 새로 추가)
    const startBtn = document.getElementById('matched-start-battle-btn');
    if (startBtn) {
        // 기존 이벤트 리스너 제거를 위해 복제 후 교체
        const newStartBtn = startBtn.cloneNode(true);
        startBtn.parentNode.replaceChild(newStartBtn, startBtn);
        
        newStartBtn.addEventListener('click', () => {
            startBattleFromMatched();
        });
    }
}

// 전투 포기 후 새로운 스킬 선택 핸들러
function handleMatchedSkillSelectionFresh(event) {
    const checkbox = event.target;
    const skill = JSON.parse(checkbox.dataset.skill.replace(/&apos;/g, "'"));
    const skillItem = checkbox.closest('.skill-selection-item');
    
    if (checkbox.checked) {
        // 스킬 선택 (최대 2개 제한)
        if (selectedSkills.length < 2) {
            selectedSkills.push(skill);
            skillItem.classList.add('selected');
        } else {
            // 제한 도달 시 체크 해제
            checkbox.checked = false;
            return;
        }
    } else {
        // 스킬 선택 해제
        selectedSkills = selectedSkills.filter(s => (s.name || s.skill_name) !== (skill.name || skill.skill_name));
        skillItem.classList.remove('selected');
    }
    
    // 전투 시작 버튼 상태 업데이트
    const startBtn = document.getElementById('matched-start-battle-btn');
    if (startBtn) {
        if (selectedSkills.length === 2) {
            startBtn.disabled = false;
            startBtn.textContent = '전투 시작';
        } else {
            startBtn.disabled = true;
            startBtn.textContent = `능력치 ${2 - selectedSkills.length}개 더 선택하세요`;
        }
    }
}

// 전투 포기 모달 닫기 함수
function closeBattleExitModal() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => modal.remove());
}

// 아레나로 돌아가기 함수
function returnToBattleArena() {
    const matchedScreen = document.getElementById('matched-opponent-screen');
    if (matchedScreen) {
        matchedScreen.remove();
    }
    
    // 전투 관련 상태 초기화
    resetBattleState();
    
    // 아레나 화면으로 돌아가기 (캐릭터 목록 새로고침)
    loadCharactersForArena();
    showView('battle');
}

// 아레나용 캐릭터 로딩 함수
async function loadCharactersForArena() {
    if (!currentUser) return;
    
    console.log('Loading characters for arena...');
    
    // DOM 요소 존재 확인
    if (!arenaCharactersGrid) {
        console.error('arenaCharactersGrid element not found');
        return;
    }
    
    arenaCharactersGrid.innerHTML = '<p>캐릭터를 불러오는 중...</p>';
    
    try {
        // 현재 사용자의 캐릭터들을 로드
        const userQuery = query(collection(db, `users/${currentUser.uid}/characters`), orderBy('name', 'asc'));
        const userSnapshot = await getDocs(userQuery);
        
        const userCharacters = [];
        userSnapshot.forEach((doc) => {
            userCharacters.push({ id: doc.id, ...doc.data() });
        });
        
        // 전체 캐릭터에서 현재 사용자가 만든 캐릭터 찾기
        const allCharsQuery = query(collectionGroup(db, 'characters'));
        const allCharsSnapshot = await getDocs(allCharsQuery);
        
        allCharsSnapshot.forEach((doc) => {
            const charData = doc.data();
            if (charData.createdBy === currentUser.uid) {
                const existingChar = userCharacters.find(c => c.id === doc.id);
                if (!existingChar) {
                    userCharacters.push({ id: doc.id, ...charData });
                }
            }
        });
        
        console.log(`Found ${userCharacters.length} characters for arena`);
        
        if (userCharacters.length === 0) {
            arenaCharactersGrid.innerHTML = '<p>전투할 캐릭터가 없습니다. 먼저 캐릭터를 생성해주세요.</p>';
            return;
        }
        
        // 캐릭터 카드들 생성
        arenaCharactersGrid.innerHTML = '';
        userCharacters.forEach(character => {
            const card = createArenaCharacterCard(character);
            arenaCharactersGrid.appendChild(card);
        });
        
        // 아레나 캐릭터 선택 영역 표시 (요소 존재 확인)
        if (arenaCharacterSelection) {
            arenaCharacterSelection.classList.remove('hidden');
        }
        
    } catch (error) {
        console.error('Error loading characters for arena:', error);
        arenaCharactersGrid.innerHTML = '<p>캐릭터를 불러오는 중 오류가 발생했습니다.</p>';
    }
}

// 아레나용 캐릭터 카드 생성
function createArenaCharacterCard(character) {
    const card = document.createElement('div');
    card.className = 'character-card arena-character-card';
    card.dataset.characterId = character.id;
    
    const wins = character.wins || 0;
    const losses = character.losses || 0;
    const totalBattles = wins + losses;
    const winRate = totalBattles > 0 ? Math.round((wins / totalBattles) * 100) : 0;
    
    card.innerHTML = `
        <img src="${character.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" alt="${character.name}" class="character-image">
        <h3>${character.name}</h3>
        <p class="character-class">${character.class}</p>
        <div class="stats">
            <span>승률: ${winRate}% (${wins}승 ${losses}패)</span>
        </div>
        <div class="character-card-buttons">
            <button onclick="selectCharacterForBattle('${character.id}', this.parentElement.parentElement)" class="btn btn-primary">전투 선택</button>
        </div>
    `;
    
    return card;
}

// 아레나에서 캐릭터 선택 (전역 함수로 설정)
window.selectCharacterForBattle = function(characterId, cardElement) {
    console.log('Selecting character for battle:', characterId);
    
    // 이전 선택 해제
    const previousSelected = arenaCharactersGrid.querySelector('.selected');
    if (previousSelected) {
        previousSelected.classList.remove('selected');
    }
    
    // 새로운 선택
    cardElement.classList.add('selected');
    
    // 캐릭터 데이터 찾기 (캐시에서 먼저, 없으면 DOM에서)
     let character = allCharactersCache.find(c => c.id === characterId);
     if (!character) {
         // DOM에서 캐릭터 정보 추출
         const characterCard = cardElement;
         const name = characterCard.querySelector('h3').textContent;
         const characterClass = characterCard.querySelector('.character-class').textContent;
         const imageUrl = characterCard.querySelector('.character-image').src;
         
         character = {
             id: characterId,
             name: name,
             class: characterClass,
             imageUrl: imageUrl
         };
         
         console.log('Character extracted from DOM:', character);
     }
    
    // 전투용 캐릭터 설정
    playerCharacterForBattle = character;
    selectedCharacterCard = cardElement;
    
    // 아레나 선택 영역 숨기고 전투 영역 표시 (요소 존재 확인)
    if (arenaCharacterSelection) {
        arenaCharacterSelection.classList.add('hidden');
    }
    
    const arenaElement = document.getElementById('arena');
    const battleArenaContainer = document.getElementById('battle-arena-container');
    const battleControls = document.getElementById('battle-controls');
    
    if (arenaElement) arenaElement.classList.remove('hidden');
    if (battleArenaContainer) battleArenaContainer.classList.remove('hidden');
    if (battleControls) battleControls.classList.remove('hidden');
    
    // 플레이어 카드 표시 (요소 존재 확인)
    if (playerBattleCard) {
        playerBattleCard.innerHTML = `
            <div class="battle-character-card">
                <img src="${character.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" alt="${character.name}">
                <h4>${character.name}</h4>
                <p>${character.class}</p>
            </div>
        `;
    }
    
    // 상대 찾기 버튼 활성화 (요소 존재 확인)
    if (findOpponentBtn) {
        findOpponentBtn.disabled = false;
    }
    
    console.log('Character selected for battle:', character.name);
};

// 아레나 뷰 초기 상태 설정
function resetBattleArenaView() {
    // 아레나 캐릭터 선택 영역 표시 (요소 존재 확인)
    if (arenaCharacterSelection) {
        arenaCharacterSelection.classList.remove('hidden');
    }
    
    // 전투 관련 영역들 숨기기 (요소 존재 확인)
    const arenaElement = document.getElementById('arena');
    const battleArenaContainer = document.getElementById('battle-arena-container');
    const battleControls = document.getElementById('battle-controls');
    
    if (arenaElement) arenaElement.classList.add('hidden');
     if (battleArenaContainer) battleArenaContainer.classList.add('hidden');
     if (battleControls) battleControls.classList.add('hidden');
    
    // 전투 상태 초기화
    resetBattleArena();
    
    // 매칭 화면이 있다면 제거
    const matchedScreen = document.getElementById('matched-opponent-screen');
    if (matchedScreen) {
        matchedScreen.remove();
    }
}

// 새로운 전투 시스템
async function startTurnBasedBattleNew() {
    console.log('=== 전투 시작 ===');
    
    // 전투 진행 상태 설정
    window.battleInProgress = true;
    console.log('battleInProgress 설정됨:', window.battleInProgress);
    
    // 요소들을 다시 찾기 (동적으로 생성된 HTML에서)
    const newBattleGaugeContainer = document.getElementById('new-battle-gauge-container');
    const gaugeFill = document.querySelector('#new-battle-gauge-container .gauge-fill');
    const gaugePercentage = document.getElementById('gauge-percentage');
    const gaugeStatusText = document.getElementById('gauge-status-text');
    const gaugeBar = document.querySelector('#new-battle-gauge-bar');
    
    console.log('전투 시작 - 요소들 확인:');
    console.log('newBattleGaugeContainer:', newBattleGaugeContainer);
    console.log('gaugeFill:', gaugeFill);
    console.log('gaugePercentage:', gaugePercentage);
    console.log('gaugeStatusText:', gaugeStatusText);
    console.log('gaugeBar:', gaugeBar);
    
    // 필수 요소들이 없으면 에러 처리
    if (!newBattleGaugeContainer || !gaugeFill || !gaugePercentage || !gaugeStatusText) {
        console.error('필수 전투 UI 요소들을 찾을 수 없습니다.');
        alert('전투 화면을 불러올 수 없습니다. 페이지를 새로고침해주세요.');
        return;
    }
    
    // 게이지바 컨테이너 표시 및 강제 표시 (!important 사용)
    newBattleGaugeContainer.classList.remove('hidden');
    newBattleGaugeContainer.style.setProperty('display', 'block', 'important');
    newBattleGaugeContainer.style.setProperty('visibility', 'visible', 'important');
    newBattleGaugeContainer.style.setProperty('opacity', '1', 'important');
    newBattleGaugeContainer.style.setProperty('position', 'relative', 'important');
    newBattleGaugeContainer.style.setProperty('z-index', '10', 'important');
    
    if (gaugeBar) {
        gaugeBar.classList.add('active');
        gaugeBar.style.setProperty('display', 'block', 'important');
        gaugeBar.style.setProperty('visibility', 'visible', 'important');
        gaugeBar.style.setProperty('position', 'relative', 'important');
    }
    
    if (gaugeFill) {
        gaugeFill.style.setProperty('display', 'block', 'important');
        gaugeFill.style.setProperty('visibility', 'visible', 'important');
        gaugeFill.style.setProperty('height', '100%', 'important');
        gaugeFill.style.setProperty('width', '0%', 'important');
    }
    
    console.log('게이지바 표시 완료');
    
    // 상대방 스킬 랜덤 선택
    const opponentSkills = getRandomSkills(opponentCharacterForBattle);
    
    // 전투 데이터 준비
    const battleData = {
        player: {
            name: playerCharacterForBattle.name,
            class: playerCharacterForBattle.class,
            skills: selectedSkills
        },
        opponent: {
            name: opponentCharacterForBattle.name,
            class: opponentCharacterForBattle.class,
            skills: opponentSkills
        }
    };
    
    // 상대방 스킬 공개
    const opponentSkillsDiv = document.querySelector('.opponent-skills');
    if (opponentSkillsDiv) {
        opponentSkillsDiv.innerHTML = `
            <h5>상대방 능력치:</h5>
            ${opponentSkills.map(skill => 
                `<div class="skill-badge">${skill.name || skill.skill_name}</div>`
            ).join('')}
        `;
    }
    
    gaugeStatusText.textContent = '전투 시작!';
    
    // 게이지 바 초기화
    gaugeFill.style.width = '0%';
    gaugePercentage.textContent = '0%';
    
    // 게이지 바 초기화
    gaugeFill.style.width = '0%';
    gaugePercentage.textContent = '0%';
    gaugeStatusText.textContent = `${playerCharacterForBattle.name}과 ${opponentCharacterForBattle.name}이 대치하고 있습니다...`;
    
    // 전투 로그 초기화 (턴 메시지 섹션 제거)
    
    const battleTurns = [];
    
    // 동적 메시지 표시용 요소 생성 (게이지바 아래에만 표시)
    const dynamicMessageElement = document.getElementById('gauge-status-text');
    if (dynamicMessageElement) {
        dynamicMessageElement.textContent = `${playerCharacterForBattle.name}과 ${opponentCharacterForBattle.name}이 대치하고 있습니다...`;
    }
    
    console.log('전투 초기화 완료, 동적 메시지 요소 생성됨');
    
    // 전투 시작과 동시에 스토리 생성 시작 (백그라운드에서 실행)
    let storyGenerationPromise = null;
    
    // 전투 데이터 저장 (스토리 생성용)
    window.lastBattleData = {
        player: battleData.player,
        opponent: battleData.opponent,
        playerSkills: selectedSkills,
        opponentSkills: opponentSkills,
        battleTurns: [], // 나중에 업데이트됨
        winner: null, // 나중에 업데이트됨
        result: null, // 나중에 업데이트됨
        isPlayerWin: null // 나중에 업데이트됨
    };
    
    console.log('전투 스토리 생성 시작 (백그라운드)');
    storyGenerationPromise = generateAndShowNovelLog();
    
    // 초기 대기 시간 단축
    await sleep(1000);
    
    try {
        // 미리 정의된 전투 메시지 배열
        const battleMessages = [
            `${battleData.player.name}이(가) 공격을 시도합니다!`,
            `${battleData.opponent.name}이(가) 반격합니다!`,
            `치열한 공방이 이어집니다!`,
            `${battleData.player.name}이(가) 방어 자세를 취합니다!`,
            `${battleData.opponent.name}이(가) 강력한 공격을 준비합니다!`,
            `전투가 치열해지고 있습니다!`,
            `승부의 결정적 순간이 다가옵니다!`
        ];
        
        // 턴별 전투 진행 (80%까지만) - 턴 수 단축
        const totalTurns = 3;
        for (let turn = 1; turn <= totalTurns; turn++) {
            // 전투 중단 체크
            if (!window.battleInProgress) {
                console.log('전투가 중단되었습니다.');
                return;
            }
            
            console.log(`=== 턴 ${turn} 시작 ===`);
            
            // 미리 정의된 메시지 중 랜덤 선택
            const randomMessage = battleMessages[Math.floor(Math.random() * battleMessages.length)];
            
            // 동적 메시지로 표시
            if (gaugeStatusText) {
                gaugeStatusText.textContent = randomMessage;
            }
            
            // 턴 결과를 간단한 텍스트로 저장 (AI 생성 없음)
            const turnResult = `턴 ${turn}: ${randomMessage}`;
            battleTurns.push(turnResult);
            console.log(`턴 ${turn} 결과:`, turnResult);
            
            // 전투는 80%까지만 진행 (애니메이션 효과 추가)
            const progress = (turn / 3) * 80;
            console.log(`게이지 업데이트: ${progress}%`);
            
            // 게이지 업데이트
             if (gaugeFill && gaugePercentage) {
                 console.log(`게이지 업데이트: ${progress}%`);
                 
                 // 게이지 업데이트 시에도 강제 표시
                 gaugeFill.style.setProperty('display', 'block', 'important');
                 gaugeFill.style.setProperty('visibility', 'visible', 'important');
                 gaugeFill.style.setProperty('transition', 'width 1.2s ease-in-out', 'important');
                 gaugeFill.style.setProperty('width', `${progress}%`, 'important');
                 gaugePercentage.textContent = `${Math.round(progress)}%`;
                 
                 // 강제로 리플로우 트리거
                 gaugeFill.offsetHeight;
             } else {
                 console.error('게이지 요소를 찾을 수 없습니다!');
             }
            
            // 펄스 효과 추가
            gaugeFill.classList.add('pulse');
            setTimeout(() => gaugeFill.classList.remove('pulse'), 800);
            
            // 턴 메시지 섹션 제거 - 게이지바 아래에만 표시
            
            // 턴 간 대기 시간 더욱 단축
            await sleep(800);
            
            // 각 턴 후에도 전투 중단 체크
            if (!window.battleInProgress) {
                console.log('전투가 중단되었습니다.');
                return;
            }
        }
        
        console.log('=== 최종 결과 결정 단계 ===');
        
        // 최종 결과 결정
        gaugeStatusText.textContent = '전투로그 작성중...';
        dynamicMessageElement.textContent = '전투로그 작성중...';
        
        // 게이지를 85%로 업데이트
        if (gaugeFill && gaugePercentage) {
            gaugeFill.style.setProperty('transition', 'width 1.0s ease-in-out', 'important');
            gaugeFill.style.setProperty('width', '85%', 'important');
            gaugePercentage.textContent = '85%';
            gaugeFill.offsetHeight; // 강제 리플로우
            console.log('85% 게이지 업데이트 완료');
        }
        
        await sleep(2000);
        
        console.log('최종 판결 요청 중...');
        const finalResult = await getFinalVerdict(battleData.player, battleData.opponent, battleTurns);
        console.log('최종 결과:', finalResult);
        
        // 최종 결과는 게이지 상태 텍스트로만 표시
        
        // 승부 결과에 따른 처리 (null 체크 추가)
        const playerName = playerCharacterForBattle?.name || battleData?.player?.name || 'Unknown';
        const isPlayerWin = finalResult.winner_name === playerName;
        
        if (gaugeStatusText) {
            if (isPlayerWin) {
                gaugeStatusText.textContent = '🎉 승리!';
            } else {
                gaugeStatusText.textContent = '😔 패배...';
            }
        }
        
        if (dynamicMessageElement) {
            if (isPlayerWin) {
                dynamicMessageElement.innerHTML = '<strong>🎉 승리!</strong> ' + finalResult.battle_summary;
            } else {
                dynamicMessageElement.innerHTML = '<strong>😔 패배...</strong> ' + finalResult.battle_summary;
            }
        }
        
        // 승패 통계 업데이트는 generateAndShowNovelLog에서 호출됨
        
        // 전투 데이터 업데이트 (스토리 생성용)
        window.lastBattleData.battleTurns = battleTurns;
        window.lastBattleData.winner = isPlayerWin ? battleData.player : battleData.opponent;
        window.lastBattleData.result = finalResult;
        window.lastBattleData.isPlayerWin = isPlayerWin;
        
        console.log('Matched battle data updated for novel generation:', window.lastBattleData);
        
        console.log('=== 전투 결과 표시 단계 ===');
        
        // 스토리 생성 시작 메시지
        console.log('=== 스토리 생성 시작 ===');
        gaugeStatusText.textContent = '전투 스토리 생성 중...';
        dynamicMessageElement.textContent = '전투 스토리 생성 중...';
        
        // 승패 기록 업데이트 시점에 돌아가기 버튼들 비활성화 (전투 포기 방지)
        const backButtons = [
            document.getElementById('back-to-arena-btn'),
            document.getElementById('back-to-matching-btn'),
            document.getElementById('back-to-list-btn'),
            document.querySelector('.back-btn')
        ];
        
        backButtons.forEach(btn => {
            if (btn) {
                btn.disabled = true;
                btn.style.display = 'none';
                console.log('돌아가기 버튼 비활성화:', btn.id || btn.className);
            }
        });
        
        // 승패 통계 업데이트 (90% 시점에서 실행)
        const winner = isPlayerWin ? playerCharacterForBattle : opponentCharacterForBattle;
        const loser = isPlayerWin ? opponentCharacterForBattle : playerCharacterForBattle;
        
        try {
            await updateCharacterStats(winner, loser);
            console.log('승패 통계 업데이트 완료');
        } catch (error) {
            console.error('승패 통계 업데이트 실패:', error);
        }
        
        // 게이지를 90%로 업데이트
        if (gaugeFill && gaugePercentage) {
            gaugeFill.style.setProperty('transition', 'width 0.8s ease-in-out', 'important');
            gaugeFill.style.setProperty('width', '90%', 'important');
            gaugePercentage.textContent = '90%';
            gaugeFill.offsetHeight;
        }
        
        await sleep(1000);
        
        // 승패 기록 저장 (전투 기록 활성화)
        try {
            // 전투 기록 저장
            await saveBattleRecord(winner, loser, {
                playerSkills: selectedSkills,
                opponentSkills: opponentSkills,
                battleTurns: battleTurns,
                finalResult: finalResult
            });
            console.log('전투 기록 저장 완료');
        } catch (error) {
            console.error('전투 기록 저장 실패:', error);
        }
        
        // 스토리 생성 완료 대기
        console.log('스토리 생성 완료 대기 중...');
        if (storyGenerationPromise) {
            await storyGenerationPromise;
            console.log('스토리 생성 완료');
        }
        
        // 게이지를 100%로 완료 (스토리 생성 완료 후)
        if (gaugeFill) {
            gaugeFill.style.setProperty('transition', 'width 0.5s ease-in-out', 'important');
            gaugeFill.style.setProperty('width', '100%', 'important');
            gaugeFill.offsetHeight;
            
            // 성공 글로우 효과 추가
            gaugeFill.classList.add('success-glow');
            console.log('100% 게이지 업데이트 완료');
        }
        if (gaugePercentage) {
            gaugePercentage.textContent = '100%';
        }
        
        if (gaugeStatusText) {
            gaugeStatusText.innerHTML = `
                <div class="battle-complete-status">
                    <h4>🎉 전투 완료!</h4>
                    <p>최종 승자: <strong>${isPlayerWin ? battleData.player.name : battleData.opponent.name}</strong></p>
                    <p>스토리가 생성되었습니다.</p>
                </div>
            `;
        }
        
        if (dynamicMessageElement) {
            dynamicMessageElement.innerHTML = `
                <div class="battle-complete-message">
                    <h4>🎉 전투 완료!</h4>
                    <p>최종 승자: <strong>${isPlayerWin ? battleData.player.name : battleData.opponent.name}</strong></p>
                    <p>스토리가 생성되었습니다.</p>
                </div>
            `;
        }
        
        // 승자 정보를 계속 표시
        const winnerDisplay = document.createElement('div');
        winnerDisplay.className = 'winner-display-permanent';
        winnerDisplay.innerHTML = `
            <div class="final-winner-announcement">
                <h3>🏆 최종 승자: ${isPlayerWin ? battleData.player.name : battleData.opponent.name}</h3>
                <p class="winner-message">${isPlayerWin ? '축하합니다! 승리하셨습니다!' : '아쉽게도 패배했습니다. 다음 기회에!'}</p>
            </div>
        `;        // battleLogContent 제거됨 - 승자 표시는 게이지 상태 텍스트로만 표시
        
    } catch (error) {
        console.error('전투 진행 중 오류:', error);
        if (gaugeStatusText) {
            gaugeStatusText.textContent = '전투 중 오류가 발생했습니다.';
        }
        if (dynamicMessageElement) {
            dynamicMessageElement.textContent = '전투 중 오류가 발생했습니다.';
        }
        // battleLogContent 제거됨 - 오류 메시지는 alert로 표시
        alert('전투 진행 중 오류가 발생했습니다.');
    } finally {
        // 전투 완료 후 battleInProgress를 false로 설정
        window.battleInProgress = false;
        console.log('전투 완료 - battleInProgress 해제됨:', window.battleInProgress);
        
        // 전투 데이터를 window.lastBattleData에 저장 (이미지 생성용)
        window.lastBattleData = {
            player: playerCharacterForBattle,
            opponent: opponentCharacterForBattle,
            playerSkills: selectedSkills,
            opponentSkills: opponentSkills,
            battleTurns: battleTurns,
            finalResult: finalResult,
            isPlayerWin: isPlayerWin
        };
        console.log('전투 데이터 저장 완료:', window.lastBattleData);
    }
}

// 전역 함수로 등록
window.showOpponentDetails = showOpponentDetails;
window.closeOpponentDetail = closeOpponentDetail;
window.returnToBattleArena = returnToBattleArena;

function updateBattleGuideText() {
    const battleGuideText = document.getElementById('battle-guide-text');
    if (!battleGuideText) {
        console.warn('battle-guide-text element not found');
        return;
    }
    const needed = 2 - selectedSkills.length;
    if (needed > 0) {
        battleGuideText.textContent = `전투에 사용할 스킬을 ${needed}개 더 선택하세요.`;
    } else {
        battleGuideText.textContent = '스킬 선택 완료! [스킬 대결 시작!] 버튼을 눌러 전투를 시작하세요.';
    }
}

function handleSkillSelection(event) {
    const checkbox = event.target;
    const skill = JSON.parse(checkbox.dataset.skill.replace(/&apos;/g, "'"));
    const skillItem = checkbox.closest('.skill-selection-item');
    
    if (checkbox.checked) {
        // Select skill (limit to 2)
        if (selectedSkills.length < 2) {
            selectedSkills.push(skill);
            skillItem.classList.add('selected');
        } else {
            // Uncheck if limit reached
            checkbox.checked = false;
            return;
        }
    } else {
        // Deselect skill
        selectedSkills = selectedSkills.filter(s => (s.name || s.skill_name) !== (skill.name || skill.skill_name));
        skillItem.classList.remove('selected');
    }
    
    updateBattleGuideText();
    
    // Enable/disable start battle button based on selection
    console.log('Selected skills count:', selectedSkills.length);
    console.log('Start battle button element:', startBattleBtn);
    
    if (startBattleBtn) {
        if (selectedSkills.length === 2) {
            console.log('Enabling start battle button');
            startBattleBtn.disabled = false;
            startBattleBtn.classList.remove('hidden');
        } else {
            console.log('Disabling start battle button');
            startBattleBtn.disabled = true;
            startBattleBtn.classList.add('hidden');
        }
    } else {
        console.warn('Start battle button not found');
    }
}

function selectSkillForBattle(button) {
    const skill = JSON.parse(button.dataset.skill);
    const skillName = skill.name || skill.skill_name;

    const index = selectedSkills.findIndex(s => (s.name || s.skill_name) === skillName);

    if (index > -1) {
        // If already selected, deselect it
        selectedSkills.splice(index, 1);
        button.classList.remove('selected');
    } else {
        // If not selected, select it (up to 2)
        if (selectedSkills.length < 2) {
            selectedSkills.push(skill);
            button.classList.add('selected');
        }
    }

    updateBattleGuideText();

    // Enable battle button and make it visible only when 2 skills are selected
    console.log('Selected skills count:', selectedSkills.length);
    console.log('Start battle button element:', startBattleBtn);
    
    if (startBattleBtn) {
        if (selectedSkills.length === 2) {
            console.log('Enabling start battle button');
            startBattleBtn.disabled = false;
            startBattleBtn.classList.remove('hidden');
        } else {
            console.log('Disabling start battle button');
            startBattleBtn.disabled = true;
            startBattleBtn.classList.add('hidden');
        }
    } else {
        console.warn('Start battle button not found');
    }
}

// 전투 기록 저장 함수
async function saveBattleRecord(winnerData, loserData, battleData) {
    try {
        const battleRecord = {
            winnerId: winnerData.id,
            winnerName: winnerData.name,
            winnerImage: winnerData.imageUrl,
            loserId: loserData.id,
            loserName: loserData.name,
            loserImage: loserData.imageUrl,
            battleDate: new Date().toISOString(),
            playerSkills: battleData.playerSkills || [],
            opponentSkills: battleData.opponentSkills || [],
            createdAt: new Date().toISOString()
        };
        
        // 승자의 전투 기록 저장
        const winnerBattleRecord = {
            ...battleRecord,
            result: 'win',
            opponentId: loserData.id,
            opponentName: loserData.name,
            opponentImage: loserData.imageUrl
        };
        
        // 패자의 전투 기록 저장
        const loserBattleRecord = {
            ...battleRecord,
            result: 'lose',
            opponentId: winnerData.id,
            opponentName: winnerData.name,
            opponentImage: winnerData.imageUrl
        };
        
        // 전투 기록을 battles 컬렉션에 저장
        await addDoc(collection(db, 'battles'), battleRecord);
        
        // 각 캐릭터의 개별 전투 기록도 저장
        const winnerRef = await findCharacterRef(winnerData.id);
        const loserRef = await findCharacterRef(loserData.id);
        
        if (winnerRef) {
            await addDoc(collection(winnerRef.parent, winnerRef.id, 'battleHistory'), winnerBattleRecord);
        }
        
        if (loserRef) {
            await addDoc(collection(loserRef.parent, loserRef.id, 'battleHistory'), loserBattleRecord);
        }
        
        console.log('전투 기록이 성공적으로 저장되었습니다.');
        
    } catch (error) {
        console.error('전투 기록 저장 중 오류:', error);
    }
}

async function updateWinsLosses(winnerId, loserId, battleData = null) {
    try {
        console.log('updateWinsLosses 시작 - winnerId:', winnerId, 'loserId:', loserId);
        
        // 승자와 패자의 문서 참조 찾기
        const winnerRef = await findCharacterRef(winnerId);
        const loserRef = await findCharacterRef(loserId);
        
        console.log('Character refs found - winnerRef:', winnerRef, 'loserRef:', loserRef);
        
        if (!winnerRef || !loserRef) {
            console.error('Could not find character references for updating stats');
            return;
        }

        console.log('Firebase transaction 시작');
        await runTransaction(db, async (transaction) => {
            const winnerDoc = await transaction.get(winnerRef);
            const loserDoc = await transaction.get(loserRef);

            if (!winnerDoc.exists() || !loserDoc.exists()) {
                throw "One of the character documents does not exist!";
            }

            const currentWins = winnerDoc.data().wins || 0;
            const currentLosses = loserDoc.data().losses || 0;
            const newWins = currentWins + 1;
            const newLosses = currentLosses + 1;
            
            console.log('승자 현재 승수:', currentWins, '-> 새 승수:', newWins);
            console.log('패자 현재 패수:', currentLosses, '-> 새 패수:', newLosses);

            transaction.update(winnerRef, { wins: newWins });
            transaction.update(loserRef, { losses: newLosses });
        });
        
        console.log('Wins and losses updated successfully.');
        
        // 전투 기록 저장
        if (battleData) {
            console.log('전투 기록 저장 시작');
            const winnerData = { id: winnerId, ...battleData.winner };
            const loserData = { id: loserId, ...battleData.loser };
            await saveBattleRecord(winnerData, loserData, battleData);
            console.log('전투 기록 저장 완료');
        }
        
        // 즉시 UI 업데이트
        console.log('UI 업데이트 시작');
        await loadUserCharacters();
        console.log('UI 업데이트 완료');
        
    } catch (e) {
        console.error('Transaction failed: ', e);
    }
}

async function findCharacterRef(characterId) {
    try {
        // 먼저 현재 사용자의 캐릭터에서 찾기
        const userCharRef = doc(db, `users/${currentUser.uid}/characters`, characterId);
        const userCharDoc = await getDocs(query(collection(db, `users/${currentUser.uid}/characters`), where('__name__', '==', characterId)));
        
        if (!userCharDoc.empty) {
            return userCharRef;
        }
        
        // 전체 사용자에서 찾기
        const allUsersQuery = query(collectionGroup(db, 'characters'));
        const allCharsSnapshot = await getDocs(allUsersQuery);
        
        for (const charDoc of allCharsSnapshot.docs) {
            if (charDoc.id === characterId) {
                return charDoc.ref;
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error finding character reference:', error);
        return null;
    }
}

if (startBattleBtn) {
    startBattleBtn.addEventListener('click', () => {
        console.log('Start battle button clicked!');
        console.log('Player character:', playerCharacterForBattle);
        console.log('Opponent character:', opponentCharacterForBattle);
        console.log('Selected skills:', selectedSkills);
        startTurnBasedBattle(playerCharacterForBattle, opponentCharacterForBattle);
    });
}

console.log('Start battle button event listener added:', startBattleBtn);

// New Turn-Based Battle System
// 게이지 바 요소들은 함수 내에서 동적으로 가져옴

function sleep(ms) {
    return new Promise(resolve => {
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            // 전투가 중단되었거나 시간이 지났으면 resolve
            if (!window.battleInProgress || Date.now() - startTime >= ms) {
                clearInterval(checkInterval);
                resolve();
            }
        }, 100); // 100ms마다 체크
    });
}

function getRandomSkills(opponent) {
    const selectedSkills = [];
    
    // 공격 스킬 중에서 하나 랜덤 선택
    if (opponent.attack_skills && opponent.attack_skills.length > 0) {
        const randomAttackIndex = Math.floor(Math.random() * opponent.attack_skills.length);
        selectedSkills.push(opponent.attack_skills[randomAttackIndex]);
    }
    
    // 방어 스킬 중에서 하나 랜덤 선택
    if (opponent.defense_skills && opponent.defense_skills.length > 0) {
        const randomDefenseIndex = Math.floor(Math.random() * opponent.defense_skills.length);
        selectedSkills.push(opponent.defense_skills[randomDefenseIndex]);
    }
    
    // 만약 공격 또는 방어 스킬이 없다면 나머지 스킬로 채우기
    if (selectedSkills.length < 2) {
        const allSkills = [];
        if (opponent.attack_skills) {
            allSkills.push(...opponent.attack_skills);
        }
        if (opponent.defense_skills) {
            allSkills.push(...opponent.defense_skills);
        }
        
        // 이미 선택된 스킬 제외하고 추가 선택
        const remainingSkills = allSkills.filter(skill => 
            !selectedSkills.some(selected => 
                (selected.name || selected.skill_name) === (skill.name || skill.skill_name)
            )
        );
        
        while (selectedSkills.length < 2 && remainingSkills.length > 0) {
            const randomIndex = Math.floor(Math.random() * remainingSkills.length);
            selectedSkills.push(remainingSkills.splice(randomIndex, 1)[0]);
        }
    }
    
    return selectedSkills;
}

async function updateCharacterStats(winner, loser) {
    try {
        console.log('updateCharacterStats 함수 호출됨');
        console.log('Winner:', winner);
        console.log('Loser:', loser);
        
        // 캐릭터 ID 확인 및 설정
        const winnerId = winner.id || winner.character_id || winner.name;
        const loserId = loser.id || loser.character_id || loser.name;
        
        console.log('Updating stats for winner:', winnerId, 'loser:', loserId);
        
        // 전투 데이터 준비
        const battleData = {
            winner: {
                name: winner.name,
                imageUrl: winner.imageUrl || winner.image_url || winner.image,
                class: winner.class
            },
            loser: {
                name: loser.name,
                imageUrl: loser.imageUrl || loser.image_url || loser.image,
                class: loser.class
            },
            playerSkills: window.lastBattleData?.playerSkills || [],
            opponentSkills: window.lastBattleData?.opponentSkills || []
        };
        
        console.log('updateWinsLosses 호출 전');
        await updateWinsLosses(winnerId, loserId, battleData);
        console.log('updateWinsLosses 호출 완료');
        
        // 랭킹이 열려있으면 새로고침
        if (!rankingModal.classList.contains('hidden')) {
            loadRanking();
        }
        
        // 캐릭터 목록도 새로고침
        if (typeof loadUserCharacters === 'function') {
            await loadUserCharacters();
        }
        
        console.log('updateCharacterStats 완료');
        
    } catch (error) {
        console.error('Error updating character stats:', error);
    }
}

// 전투 스토리 텍스트에 스타일링을 적용하는 함수
function formatNovelTextWithStyling(novelText, playerSkillNames, opponentSkillNames, playerName, opponentName) {
    // 스킬 이름들을 배열로 변환
    const playerSkills = playerSkillNames.split(', ').filter(skill => skill.trim() !== '');
    const opponentSkills = opponentSkillNames.split(', ').filter(skill => skill.trim() !== '');
    const allSkills = [...playerSkills, ...opponentSkills];
    
    // 캐릭터 이름들
    const characterNames = [playerName, opponentName];
    
    // 텍스트를 문단별로 분리
    const paragraphs = novelText.split('\n').filter(p => p.trim() !== '');
    
    const formattedParagraphs = paragraphs.map(paragraph => {
        let formattedText = paragraph.trim();
        
        // 1. 대사 스타일링 (따옴표로 둘러싸인 텍스트)
        formattedText = formattedText.replace(/[""](.*?)[""]|"(.*?)"/g, '<span class="dialogue">"$1$2"</span>');
        
        // 2. 스킬명 스타일링
        allSkills.forEach(skill => {
            if (skill && skill.length > 1) {
                const skillRegex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
                formattedText = formattedText.replace(skillRegex, '<span class="skill-name">$&</span>');
            }
        });
        
        // 3. 캐릭터 이름 스타일링
        characterNames.forEach(name => {
            if (name && name.length > 1) {
                const nameRegex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
                formattedText = formattedText.replace(nameRegex, '<span class="character-name">$&</span>');
            }
        });
        
        // 4. 액션 설명 스타일링 (감탄사나 의성어)
        formattedText = formattedText.replace(/\b(쾅|펑|휘익|번쩍|우르르|쿵|탁|휙|쏴아|와르르|쨍그랑|쿠궁|두둥|쾅쾅|펑펑)\b/g, '<span class="action-text">$&</span>');
        
        return `<p>${formattedText}</p>`;
    });
    
    return formattedParagraphs.join('');
}

async function generateAndShowNovelLog() {
    if (!window.lastBattleData) {
        console.error('No battle data available to generate novel log.');
        console.log('Current lastBattleData:', window.lastBattleData);
        return;
    }

    // 전투 데이터가 완전히 준비될 때까지 대기
    console.log('Waiting for complete battle data...');
    while (!window.lastBattleData.battleTurns || 
           window.lastBattleData.battleTurns.length === 0 || 
           !window.lastBattleData.winner || 
           !window.lastBattleData.result) {
        console.log('Battle data not ready yet, waiting...', {
            battleTurns: window.lastBattleData.battleTurns,
            winner: window.lastBattleData.winner,
            result: window.lastBattleData.result
        });
        await new Promise(resolve => setTimeout(resolve, 500)); // 0.5초 대기
    }

    console.log('Generating novel with complete battle data:', window.lastBattleData);
    const { player, opponent, playerSkills, opponentSkills, battleTurns, winner } = window.lastBattleData;

    // 사용된 스킬 이름들 추출
    const playerSkillNames = playerSkills.map(skill => skill.name || skill.skill_name).join(', ');
    const opponentSkillNames = opponentSkills.map(skill => skill.name || skill.skill_name).join(', ');

    const prompt = `
        You are a talented novelist. Write a short, dramatic story (in Korean) about a battle between two characters.
        The story should be about 5-7 paragraphs long.
        Include their inner thoughts, dialogue, the environment, and a climactic finish based on the provided battle log.
        The story must be conclusive and reflect the final winner.
        
        **IMPORTANT: You MUST include the actual skill names used in the battle within the story narrative.**

        - Character 1 (Player): ${player.name} (${player.class})
          - Used Skills: ${playerSkillNames}
          - Personality: ${player.personality}
        - Character 2 (Opponent): ${opponent.name} (${opponent.class})
          - Used Skills: ${opponentSkillNames}
          - Personality: ${opponent.personality}
        - Battle Log (Turn by Turn):\n${battleTurns.join('\n')}
        - Final Winner: ${winner.name}

        Please write the story in a compelling, narrative style. Make sure to mention the specific skill names (${playerSkillNames}, ${opponentSkillNames}) as they are used during the battle. Do not just list the events.
    `;

    try {
        const result = await generateWithFallback(prompt);
        const response = await result.response;
        const novelText = response.text();
        
        // Format the text into paragraphs and apply styling
        const formattedNovel = formatNovelTextWithStyling(novelText, playerSkillNames, opponentSkillNames, player.name, opponent.name);

        console.log('Generated novel text:', novelText);
        console.log('Formatted novel:', formattedNovel);
        
        // 소설 로그를 전투 로그 영역에 직접 표시
        const novelSection = document.createElement('div');
        novelSection.className = 'novel-section';
        novelSection.innerHTML = `
            <h3>📖 전투 스토리</h3>
            <div class="novel-content">${formattedNovel}</div>
        `;
        
        console.log('Created novel section:', novelSection);
        
        // 전투 로그 레이어 제거됨 - 직접 소설 표시
        console.log('Generating novel without battle log layer');
        
        // 전투 로그 레이어 제거됨
        
        // 전투 준비 화면 요소들도 숨기기
        const arenaElement = document.getElementById('arena');
        if (arenaElement) {
            arenaElement.classList.add('hidden');
        }
        
        // 새로운 스토리 섹션을 battle-section에 추가
        const battleSection = document.getElementById('battle-section');
        if (battleSection) {
            // 기존 스토리 섹션이 있다면 제거
            const existingStorySection = battleSection.querySelector('.battle-story-container');
            if (existingStorySection) {
                existingStorySection.remove();
            }
            
            // 새로운 스토리 컨테이너 생성
            const storyContainer = document.createElement('div');
            storyContainer.className = 'battle-story-container';
            storyContainer.appendChild(novelSection);
            
            // 전투 이미지 생성 버튼 추가
            const generateImageBtn = document.createElement('button');
            generateImageBtn.id = 'story-generate-battle-image-btn';
            generateImageBtn.className = 'btn btn-primary';
            generateImageBtn.textContent = '🎨 전투 장면 이미지 생성';
            generateImageBtn.addEventListener('click', generateBattleImage);
            
            // 이미지 컨테이너 추가
            const imageContainer = document.createElement('div');
            imageContainer.id = 'story-battle-image-container';
            imageContainer.className = 'battle-image-container hidden';
            imageContainer.innerHTML = `
                <div class="loader">이미지를 생성하고 있습니다...</div>
                <img id="story-generated-battle-image" src="" alt="AI Generated Battle Scene" class="hidden">
            `;
            
            storyContainer.appendChild(generateImageBtn);
            storyContainer.appendChild(imageContainer);
            
            console.log('Battle image generation button and container added to story section');
            
            // 아레나로 돌아가기 버튼 추가
            const backToArenaBtn = document.createElement('button');
            backToArenaBtn.id = 'back-to-arena-btn';
            backToArenaBtn.className = 'btn btn-secondary';
            backToArenaBtn.textContent = '🏟️ 아레나로 돌아가기';
            backToArenaBtn.addEventListener('click', async () => {
                console.log('아레나로 돌아가기 버튼 클릭됨');
                
                // 스토리 컨테이너 제거
                storyContainer.remove();
                
                // 전투 로그 레이어 제거됨
                
                // 게이지 바 컨테이너 숨기기
                const gaugeContainer = document.getElementById('new-battle-gauge-container');
                if (gaugeContainer) {
                    gaugeContainer.classList.add('hidden');
                }
                
                // 매칭된 상대방 화면 제거 (있다면)
                const matchedScreen = document.getElementById('matched-opponent-screen');
                if (matchedScreen) {
                    matchedScreen.remove();
                }
                
                // 전투 관련 전역 변수들 초기화
                selectedSkills = [];
                playerCharacterForBattle = null;
                opponentCharacterForBattle = null;
                // window.lastBattleData는 유지 (이미지 생성을 위해)
                
                // 전투 관련 상태 초기화
                resetBattleState();
                
                console.log('전투 상태 초기화 완료, 캐릭터 카드 화면으로 이동');
                
                // 로그인 후 첫 화면(캐릭터 카드 화면)으로 이동
                showView('character-cards');
            });
            storyContainer.appendChild(backToArenaBtn);
            
            // battle-section에 스토리 컨테이너 추가
            battleSection.appendChild(storyContainer);
            
            console.log('Battle story section created and displayed');
        } else {
            console.error('Battle section not found');
        }

    } catch (error) {
        console.error('Error generating novel log:', error);
        // 전투 로그 레이어 제거됨 - 에러는 콘솔에만 표시
        alert('소설을 생성하는 중 오류가 발생했습니다.');
    }
}

async function startTurnBasedBattle(player, opponent) {
    console.log('Turn-based Battle Start:', player.name, 'vs', opponent.name);

    // 1. Setup UI - 새로운 게이지 바 시스템
    const newBattleGaugeContainer = document.getElementById('new-battle-gauge-container');
    const gaugeFill = document.querySelector('.gauge-fill');
    const gaugePercentage = document.getElementById('gauge-percentage');
    const gaugeStatusText = document.getElementById('gauge-status-text');
    const gaugeBar = document.querySelector('.gauge-bar');
    
    battleLog.classList.remove('hidden');
    newBattleGaugeContainer.classList.remove('hidden');
    
    // 게이지 바 초기화
    gaugeFill.style.width = '0%';
    gaugePercentage.textContent = '0%';
    gaugeStatusText.textContent = '전투 시작!';
    gaugeBar.classList.add('active');
    
    // 전투 시작 메시지는 게이지 상태 텍스트로만 표시
    startBattleBtn.disabled = true;
    document.getElementById('player-skill-selection').classList.add('hidden');
    backToListBtn.disabled = true;

    // 2. Prepare battle data
    const opponentSkills = getRandomSkills(opponent);
    const battleTurns = [];
    const TOTAL_TURNS = 3; // 턴 수 단축
    
    const dynamicMessageElement = document.getElementById('dynamic-battle-message');
    dynamicMessageElement.textContent = `${player.name}과 ${opponent.name}의 전투가 시작됩니다...`;
    
    // 미리 정의된 전투 메시지 배열
    const battleMessages = [
        `${player.name}이(가) 공격을 시도합니다!`,
        `${opponent.name}이(가) 반격합니다!`,
        `치열한 공방이 이어집니다!`,
        `${player.name}이(가) 방어 자세를 취합니다!`,
        `${opponent.name}이(가) 강력한 공격을 준비합니다!`,
        `전투가 치열해지고 있습니다!`,
        `승부의 결정적 순간이 다가옵니다!`
    ];

    try {
        // 3. 미리 정의된 메시지와 함께 전투 진행 (80%까지만)
        for (let i = 1; i <= TOTAL_TURNS; i++) {
            // 미리 정의된 메시지 중 랜덤 선택
            const randomMessage = battleMessages[Math.floor(Math.random() * battleMessages.length)];
            
            // 동적 메시지로 표시
            dynamicMessageElement.textContent = randomMessage;
            
            // 턴 결과를 간단한 텍스트로 저장 (AI 생성 없음)
            const turnResult = `턴 ${i}: ${randomMessage}`;
            battleTurns.push(turnResult);

            // 전투는 80%까지만 진행 (새로운 게이지 바 애니메이션)
            const progress = (i / TOTAL_TURNS) * 80;
            gaugeFill.style.width = `${progress}%`;
            gaugePercentage.textContent = `${Math.round(progress)}%`;
            gaugeStatusText.textContent = `턴 ${i}/${TOTAL_TURNS} 진행 중...`;
            
            // 펄스 효과 추가
            gaugeFill.classList.add('pulse');
            setTimeout(() => gaugeFill.classList.remove('pulse'), 800);

            await sleep(800); // 대기시간 단축
        }

        // 4. 최종 판결
        const additionalMessages = [
            '치열한 공방이 계속되고 있습니다!',
            '승부의 결정적 순간이 다가옵니다!',
            '마지막 힘을 모으고 있습니다!',
            '결전의 시간이 왔습니다!'
        ];
        
        dynamicMessageElement.textContent = additionalMessages[Math.floor(Math.random() * additionalMessages.length)];
        
        const finalResult = await getFinalVerdict(player, opponent, battleTurns);

        let winner, loser;
        if (finalResult.winner_name === player.name) {
            winner = player;
            loser = opponent;
        } else {
            winner = opponent;
            loser = player;
        }

        // 5. 승패 업데이트
        await updateCharacterStats(winner, loser);
        
        // 6. 소설 로그 자동 생성 및 표시
        window.lastBattleData = {
            player,
            opponent,
            playerSkills: selectedSkills,
            opponentSkills,
            battleTurns,
            winner,
            loser,
            finalResult
        };
        
        console.log('Battle data set for novel generation:', window.lastBattleData);
        
        // 스토리 생성 시작 메시지
        const storyMessages = [
            '전투의 여운이 남아있습니다...',
            '숨막히는 대결이었습니다!',
            '놀라운 전투였습니다!',
            '역사에 남을 명승부입니다!'
        ];
        
        dynamicMessageElement.textContent = storyMessages[Math.floor(Math.random() * storyMessages.length)];
        gaugeFill.style.width = '90%';
        gaugePercentage.textContent = '90%';
        gaugeStatusText.textContent = '전투 마무리 중...';
        
        await sleep(1000);
        
        // 소설 생성 시작
        gaugeStatusText.textContent = '스토리 생성 중...';
        await generateAndShowNovelLog();
        
        // 소설 생성 완료 후 게이지를 100%로 완료하면서 승리자와 소설이 동시에 표시
        gaugeFill.style.width = '100%';
        gaugePercentage.textContent = '100%';
        gaugeStatusText.textContent = '전투 완료!';
        
        // 승리자와 함께 완료 메시지 표시 (소설과 동시에 나타남)
        dynamicMessageElement.innerHTML = `
            <div class="battle-complete-message">
                <h4>🎉 전투 완료!</h4>
                <p><strong>승리자: ${winner.name}</strong></p>
                <p>스토리가 생성되었습니다.</p>
            </div>
        `;
        
        // 완료 시 특별 효과
        gaugeFill.classList.add('pulse');
        gaugeBar.classList.remove('active');
        setTimeout(() => {
            gaugeFill.classList.remove('pulse');
            gaugeBar.style.boxShadow = '0 0 30px var(--success-color)';
        }, 500);
        
        // 이미지 생성 버튼은 스토리 섹션에 포함됨

    } catch (error) {
        console.error('Error during turn-based battle:', error);
        dynamicMessageElement.innerHTML = '<div class="error-message">전투 중 오류가 발생했습니다. 다시 시도해주세요.</div>';
    } finally {
        backToListBtn.disabled = false;
    }
}

// runBattleTurn 함수는 더 이상 사용하지 않음 (미리 정의된 메시지 사용으로 대체)

async function getFinalVerdict(player, opponent, battleTurns) {
    // 전투 중단 체크
    if (!window.battleInProgress) {
        console.log('getFinalVerdict: 전투가 중단되었습니다.');
        return {
            winner_name: player.name,
            battle_summary: '전투가 중단되었습니다.'
        };
    }
    
    const prompt = `
        You are the ultimate judge. Based on the turn-by-turn log of the battle, you must declare a winner.

        Battle Log:
        ${battleTurns.join('\n')}

        Your task is to return a single, stringified JSON object with two keys: "winner_name" and "battle_summary".
        - "winner_name": The name of the character who you declare the winner. Must be either "${player.name}" or "${opponent.name}".
        - "battle_summary": A short, conclusive summary (in Korean, 1-2 sentences) explaining WHY you chose the winner based on the flow of the battle.
    `;

    const result = await generateWithFallback(prompt);
    const response = await result.response;
    const text = response.text();
    const match = text.match(/\{.*\}/s);
    if (match) {
        return JSON.parse(match[0]);
    }
    return JSON.parse(text);
}

// ... (rest of the code remains the same)
// --- GENERAL MODAL HANDLING ---
window.addEventListener('click', (event) => {
    if (event.target == rankingModal) {
        rankingModal.classList.add('hidden');
    }
    if (event.target == rankingCharacterDetailModal) {
        rankingCharacterDetailModal.classList.add('hidden');
    }
    if (event.target == skillModal) {
        skillModal.classList.add('hidden');
    }
    if (event.target == novelLogModal) {
        novelLogModal.classList.add('hidden');
    }
});

// --- NOVEL LOG & IMAGE GENERATION --- //

// showNovelLogBtn.addEventListener('click', generateNovelLog); // Removed - novel now shows automatically
novelLogModal.querySelector('.close-btn').addEventListener('click', () => {
    novelLogModal.classList.add('hidden');
});
generateBattleImageBtn.addEventListener('click', generateBattleImage);

// --- RANKING SYSTEM ---
async function loadRanking() {
    rankingList.innerHTML = '<p>랭킹을 불러오는 중...</p>';
    
    try {
        // 모든 캐릭터 데이터 가져오기
        const q = query(collectionGroup(db, 'characters'));
        const querySnapshot = await getDocs(q);
        
        const characters = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const wins = data.wins || 0;
            const losses = data.losses || 0;
            const totalBattles = wins + losses;
            const winRate = totalBattles > 0 ? (wins / totalBattles * 100).toFixed(1) : 0;
            
            characters.push({
                id: doc.id,
                name: data.name,
                class: data.class,
                wins,
                losses,
                totalBattles,
                winRate: parseFloat(winRate),
                imageUrl: data.imageUrl
            });
        });
        
        // 승률 기준으로 정렬 (승률이 같으면 패배 횟수가 적은 순으로, 그것도 같으면 승리 횟수가 많은 순으로)
        characters.sort((a, b) => {
            if (b.winRate === a.winRate) {
                // 승률이 같으면 패배 횟수가 적은 순으로
                if (a.losses !== b.losses) {
                    return a.losses - b.losses;
                }
                // 패배 횟수도 같으면 승리 횟수가 많은 순으로
                return b.wins - a.wins;
            }
            return b.winRate - a.winRate;
        });
        
        // 상위 10개만 표시
        const top10 = characters.slice(0, 10);
        
        if (top10.length === 0) {
            rankingList.innerHTML = '<p>아직 배틀 기록이 없습니다.</p>';
            return;
        }
        
        rankingList.innerHTML = '';
        top10.forEach((character, index) => {
            const rankingItem = document.createElement('div');
            rankingItem.className = 'ranking-item';
            
            // 캐릭터 이미지 URL 처리
            const imageUrl = character.imageUrl || 'https://placehold.co/60x60/333/FFF?text=?';
            
            rankingItem.innerHTML = `
                <div class="ranking-rank">#${index + 1}</div>
                <img src="${imageUrl}" alt="${character.name}" class="ranking-character-image" onerror="this.src='https://placehold.co/60x60/333/FFF?text=?'">
                <div class="ranking-info">
                    <div class="ranking-name">${character.name}</div>
                    <div class="ranking-class">${character.class}</div>
                </div>
                <div class="ranking-stats">${character.winRate}%<br>(${character.wins}승 ${character.losses}패)</div>
            `;
            
            rankingItem.onclick = () => showRankingCharacterDetails(character);
            rankingList.appendChild(rankingItem);
        });
        
    } catch (error) {
        console.error('Error loading ranking:', error);
        rankingList.innerHTML = '<p>랭킹을 불러오는 중 오류가 발생했습니다.</p>';
    }
}

async function showRankingCharacterDetails(character) {
    try {
        // 캐시된 캐릭터 데이터에서 직접 찾기 (Firebase 쿼리 없이)
        let fullCharacterData = character;
        
        // allCharactersCache에서 해당 캐릭터 찾기
        if (allCharactersCache && allCharactersCache.length > 0) {
            const cachedCharacter = allCharactersCache.find(char => char.name === character.name);
            if (cachedCharacter) {
                fullCharacterData = { ...cachedCharacter, ...character };
            }
        }
        
        // 디버깅: 캐릭터 데이터 확인
        console.log('캐릭터 데이터:', fullCharacterData);
        console.log('스킬 데이터:', fullCharacterData.skills);
        
        // 캐릭터 이미지 URL 처리
        const imageUrl = fullCharacterData.imageUrl || 'https://placehold.co/300x300/333/FFF?text=?';
        
        // 스킬 정보 처리 (attack_skills와 defense_skills 모두 포함)
        let allSkills = [];
        if (fullCharacterData.attack_skills) {
            allSkills.push(...fullCharacterData.attack_skills.map(skill => ({...skill, type: '공격'})));
        }
        if (fullCharacterData.defense_skills) {
            allSkills.push(...fullCharacterData.defense_skills.map(skill => ({...skill, type: '방어'})));
        }
        
        const skillsHtml = allSkills.length > 0 ? 
            allSkills.map(skill => `
                <div class="skill-item">
                    <h4>${skill.name} <span class="skill-type">(${skill.type})</span></h4>
                    <p>${skill.description}</p>
                </div>
            `).join('') : '<p>스킬 정보가 없습니다.</p>';
        
        console.log('공격 스킬:', fullCharacterData.attack_skills);
        console.log('방어 스킬:', fullCharacterData.defense_skills);
        console.log('생성된 스킬 HTML:', skillsHtml);
        
        // 능력치 섹션 제거 (사용자 요청)
        
        rankingCharacterDetailContent.innerHTML = `
            <div class="character-detail-container">
                <div class="character-detail-header">
                    <div class="character-image-container">
                        <img src="${imageUrl}" alt="${fullCharacterData.name}" class="character-image" 
                             onerror="this.src='https://placehold.co/300x300/333/FFF?text=?'"
                             onclick="openImageModal('${imageUrl}', '${fullCharacterData.name}')"
                             style="cursor: pointer;">
                    </div>
                    <div class="character-basic-info">
                        <h2>${fullCharacterData.name}</h2>
                        <div class="character-rank">
                            <span class="rank-badge">${fullCharacterData.class}</span>
                        </div>
                        <div class="character-record">
                            <div class="record-item">
                                <span class="record-label">승률:</span>
                                <span class="record-value">${character.winRate}%</span>
                            </div>
                            <div class="record-item">
                                <span class="record-label">전적:</span>
                                <span class="record-value">${character.wins}승 ${character.losses}패</span>
                            </div>
                            <div class="record-item">
                                <span class="record-label">총 경기:</span>
                                <span class="record-value">${character.totalBattles}경기</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="character-detail-body">
                    <div class="character-story">
                        <h3>캐릭터 스토리</h3>
                        <p>${fullCharacterData.story || '스토리 정보가 없습니다.'}</p>
                    </div>
                    
                    <div class="character-skills">
                        <h3>스킬</h3>
                        <div class="skills-container">
                            ${skillsHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        rankingCharacterDetailModal.classList.remove('hidden');
        
    } catch (error) {
        console.error('Error loading character details:', error);
        alert('캐릭터 상세 정보를 불러오는 중 오류가 발생했습니다.');
    }
}

// generateNovelLog function removed - novel now displays automatically after battle

async function generateBattleImage() {
    console.log('=== 전투 이미지 생성 시작 ===');
    
    if (!window.lastBattleData) {
        console.error('Battle data is not available.');
        console.log('Current window.lastBattleData:', window.lastBattleData);
        return;
    }

    console.log('window.lastBattleData:', window.lastBattleData);
    
    // 스토리 섹션의 버튼과 컨테이너 찾기
    const storyGenerateBtn = document.getElementById('story-generate-battle-image-btn');
    const storyImageContainer = document.getElementById('story-battle-image-container');
    const storyGeneratedImage = document.getElementById('story-generated-battle-image');
    
    if (!storyGenerateBtn || !storyImageContainer) {
        console.error('Story image generation elements not found.');
        return;
    }
    
    // 이미 이미지가 생성되었는지 확인 (한 번만 생성 허용)
    if (storyGenerateBtn.dataset.imageGenerated === 'true') {
        console.log('이미지가 이미 생성되었습니다.');
        return;
    }
    
    storyGenerateBtn.disabled = true;
    storyGenerateBtn.innerHTML = '이미지 생성 중...';
    storyImageContainer.classList.remove('hidden');
    
    // 기존 이미지 초기화 (캐시 방지)
    if (storyGeneratedImage) {
        storyGeneratedImage.src = '';
        storyGeneratedImage.classList.add('hidden');
    }
    
    // 개선된 로딩 표시 생성 (빨간 동그라미 표시된 기존 로딩은 제거)
    let loader = storyImageContainer.querySelector('.image-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.className = 'image-loader';
        loader.innerHTML = `
            <div class="loader-content">
                <div class="spinner"></div>
                <p>AI가 전투 장면을 그리고 있습니다...</p>
            </div>
        `;
        storyImageContainer.appendChild(loader);
    }
    loader.classList.remove('hidden');

    const { player, opponent, playerSkills, opponentSkills } = window.lastBattleData;
    
    console.log('플레이어 정보:', {
        name: player.name,
        appearance_prompt: player.appearance_prompt,
        image_prompt: player.image_prompt
    });
    
    console.log('상대방 정보:', {
        name: opponent.name,
        appearance_prompt: opponent.appearance_prompt,
        image_prompt: opponent.image_prompt
    });

    // 캐릭터의 원본 외형 프롬프트와 이미지 분석을 통한 정확한 외형 추출
    const player1Appearance = player.appearance_prompt || player.image_prompt || 'fantasy character';
    const player2Appearance = opponent.appearance_prompt || opponent.image_prompt || 'fantasy character';
    
    console.log('추출된 외형 프롬프트:');
    console.log('플레이어 외형:', player1Appearance);
    console.log('상대방 외형:', player2Appearance);
    
    // 캐릭터 이미지 분석을 통한 추가 외형 정보 추출 (최대한 강화)
    const analyzeCharacterImage = async (character) => {
        if (!character.imageUrl) return '';
        
        try {
            // Gemini Vision API를 사용하여 캐릭터 이미지 분석 (극도로 상세하고 정확한 분석)
            const visionPrompt = `CRITICAL TASK: Analyze this character image with EXTREME PRECISION for AI image generation.
            
            You MUST extract EVERY visible detail to ensure 100% accurate character reproduction:
            
            === MANDATORY ANALYSIS SECTIONS ===
            
            1. EXACT SPECIES/CREATURE TYPE:
               - Precise species identification (human, specific animal type, fantasy creature, robot, etc.)
               - Anthropomorphic level (fully animal, humanoid animal, etc.)
               - Any hybrid characteristics
            
            2. DETAILED PHYSICAL ANATOMY:
               - FACE: Eye shape, color, size; nose type; mouth shape; ear type and position
               - TEETH: Visible teeth characteristics (fangs, buck teeth, etc.)
               - BODY: Build, proportions, posture, limb structure
               - SKIN/FUR/SCALES: Exact colors, patterns, texture, markings
               - HAIR/MANE: Style, length, color, texture
               - TAIL: Shape, size, fur/scale pattern (if present)
               - UNIQUE FEATURES: Horns, wings, claws, special appendages
            
            3. CLOTHING & ACCESSORIES:
               - Every piece of clothing with exact colors and materials
               - Armor pieces, weapons, tools, jewelry
               - Fabric textures, metal types, decorative elements
            
            4. DISTINCTIVE MARKINGS & CHARACTERISTICS:
               - Scars, tattoos, birthmarks, patterns
               - Magical auras, glowing elements
               - Expression, personality traits visible
            
            5. ART STYLE & RENDERING:
               - Cartoon, realistic, anime, fantasy art style
               - Color palette, shading style, line work
            
            === OUTPUT FORMAT ===
            Provide an ULTRA-DETAILED English description that captures EVERY visual element. Be obsessively specific about colors, shapes, textures, and proportions. This description will be used to generate an identical character.
            
            CRITICAL: Focus on species-specific features (beaver teeth, monkey tail, etc.) and unique characteristics that make this character instantly recognizable.
            
            Example: "Anthropomorphic beaver character with thick chocolate brown fur covering entire body, prominent large white front buck teeth protruding from mouth, small rounded ears positioned on top of head, black beady eyes, stocky muscular build, flat paddle-shaped tail with cross-hatch texture, wearing royal blue medieval plate armor with silver metallic trim and golden buckles, holding wooden staff with carved details, friendly smiling expression, cartoon art style with soft shading"`;
            
            // 이미지와 함께 프롬프트 전송
            const imageData = character.imageUrl;
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' }); // Vision 전용 모델
            
            const result = await model.generateContent([
                visionPrompt,
                {
                    inlineData: {
                        data: imageData.split(',')[1], // base64 데이터 추출
                        mimeType: 'image/jpeg'
                    }
                }
            ]);
            
            const response = await result.response;
            return response.text().trim();
        } catch (error) {
            console.log('이미지 분석 실패:', error);
            // 폴백으로 기본 텍스트 분석 시도
            try {
                const fallbackPrompt = `Based on the character name "${character.name}" and appearance description "${character.appearance_prompt || character.image_prompt || ''}", provide a detailed physical description for AI image generation. Focus on species-specific features and unique characteristics.`;
                const result = await generateWithFallback(fallbackPrompt);
                const response = await result.response;
                return response.text().trim();
            } catch (fallbackError) {
                console.log('폴백 분석도 실패:', fallbackError);
                return '';
            }
        }
    };
    
    // 두 캐릭터의 이미지 분석 수행
    const [player1Analysis, player2Analysis] = await Promise.all([
        analyzeCharacterImage(player),
        analyzeCharacterImage(opponent)
    ]);
    
    console.log('이미지 분석 결과:');
    console.log('플레이어 분석:', player1Analysis);
    console.log('상대방 분석:', player2Analysis);
    
    // 캐릭터별 특성 키워드 추출 (동물 캐릭터 등의 특성 보존 - 대폭 강화)
    const extractCharacterKeywords = (appearance, name, characterClass, analysis) => {
        const lowerAppearance = appearance.toLowerCase();
        const lowerName = name.toLowerCase();
        const lowerClass = (characterClass || '').toLowerCase();
        const lowerAnalysis = (analysis || '').toLowerCase();
        
        let keywords = [];
        let speciesKeywords = [];
        let detailKeywords = [];
        
        // 동물 특성 감지 및 강화 (더 정확하고 상세하게)
        if (lowerAppearance.includes('beaver') || lowerName.includes('비버') || lowerName.includes('beaver') || lowerAnalysis.includes('beaver')) {
            speciesKeywords.push('anthropomorphic beaver character', 'rodent mammal');
            detailKeywords.push('large prominent front teeth', 'brown thick fur', 'flat paddle-shaped tail', 'small round ears', 'beaver facial structure', 'stocky build', 'webbed feet');
        }
        if (lowerAppearance.includes('monkey') || lowerName.includes('원숭이') || lowerName.includes('monkey') || lowerAnalysis.includes('monkey')) {
            speciesKeywords.push('anthropomorphic monkey character', 'primate mammal');
            detailKeywords.push('long prehensile tail', 'fur-covered body', 'agile limbs', 'expressive face', 'monkey hands and feet', 'primate posture');
        }
        if (lowerAppearance.includes('spider') || lowerName.includes('거미') || lowerName.includes('spider') || lowerAnalysis.includes('spider')) {
            speciesKeywords.push('spider-themed character', 'arachnid creature');
            detailKeywords.push('eight limbs', 'multiple eyes', 'web patterns', 'dark chitinous exoskeleton', 'segmented body', 'spider mandibles');
        }
        if (lowerAppearance.includes('dragon') || lowerName.includes('용') || lowerName.includes('dragon') || lowerAnalysis.includes('dragon')) {
            speciesKeywords.push('draconic character', 'dragon creature');
            detailKeywords.push('scales covering body', 'large wings', 'reptilian features', 'long tail', 'clawed hands', 'fire elements', 'horned head');
        }
        if (lowerAppearance.includes('remote') || lowerName.includes('리모컨') || lowerName.includes('remote') || lowerAnalysis.includes('remote')) {
            speciesKeywords.push('remote control character', 'electronic device creature');
            detailKeywords.push('rectangular body shape', 'button interface', 'plastic or metal surface', 'electronic components', 'antenna or signal elements', 'digital display');
        }
        if (lowerAppearance.includes('robot') || lowerName.includes('로봇') || lowerName.includes('robot') || lowerAnalysis.includes('robot')) {
            speciesKeywords.push('robotic character', 'mechanical being');
            detailKeywords.push('metal plating', 'mechanical joints', 'glowing eyes', 'technological details', 'circuit patterns', 'metallic finish');
        }
        
        // 일반적인 외형 특성 추출
        const colorMatches = appearance.match(/\b(red|blue|green|yellow|black|white|brown|gray|purple|orange|pink|silver|gold)\b/gi);
        if (colorMatches) {
            detailKeywords.push(...colorMatches.map(color => `${color.toLowerCase()} coloring`));
        }
        
        keywords = [...speciesKeywords, ...detailKeywords];
        return keywords.join(', ');
    };
    
    const player1Keywords = extractCharacterKeywords(player1Appearance, player.name, player.class, player1Analysis);
    const player2Keywords = extractCharacterKeywords(player2Appearance, opponent.name, opponent.class, player2Analysis);
    
    console.log('추출된 키워드:');
    console.log('플레이어 키워드:', player1Keywords);
    console.log('상대방 키워드:', player2Keywords);
    
    // 고유한 요소 추가로 매번 다른 이미지 생성
    const timestamp = Date.now();
    const randomElement = Math.floor(Math.random() * 1000);
    const battleVariations = [
        'intense combat with sparks flying',
        'dramatic mid-air clash',
        'ground-shaking powerful exchange',
        'swift agile combat dance',
        'elemental powers colliding'
    ];
    const randomVariation = battleVariations[Math.floor(Math.random() * battleVariations.length)];
    
    // 분석된 정보를 결합한 정확한 캐릭터 외형 설명
    const enhancedPlayer1Desc = `${player1Appearance}${player1Analysis ? ', ' + player1Analysis : ''}${player1Keywords ? ', ' + player1Keywords : ''}`;
    const enhancedPlayer2Desc = `${player2Appearance}${player2Analysis ? ', ' + player2Analysis : ''}${player2Keywords ? ', ' + player2Keywords : ''}`;
    
    // 대폭 강화된 전투 이미지 프롬프트 생성
    const directBattlePrompt = `
MASTERPIECE QUALITY FANTASY BATTLE SCENE - ULTRA DETAILED CHARACTER ACCURACY REQUIRED

=== CHARACTER SPECIFICATIONS (MUST BE EXACT) ===

LEFT FIGHTER - ${player.name}:
${enhancedPlayer1Desc}
SPECIES CONFIRMATION: ${player1Keywords}
COMBAT ABILITIES: ${playerSkills.map(s => s.name || s.skill_name).join(', ')}

RIGHT FIGHTER - ${opponent.name}:
${enhancedPlayer2Desc}
SPECIES CONFIRMATION: ${player2Keywords}
COMBAT ABILITIES: ${opponentSkills.map(s => s.name || s.skill_name).join(', ')}

=== SCENE COMPOSITION ===
Medium shot battle scene, both characters clearly visible and distinct
Dynamic combat pose: ${randomVariation}
Characters positioned facing each other in epic confrontation
Battle moment ID: #${randomElement} (for uniqueness)

=== VISUAL REQUIREMENTS ===
- 16:9 aspect ratio, 800x450 pixels optimized
- Professional digital illustration quality
- Dramatic cinematic lighting with dynamic shadows
- Epic fantasy atmosphere with magical energy effects
- Detailed background environment suitable for battle
- High contrast and vibrant colors
- Masterpiece level artwork quality

=== CRITICAL CHARACTER ACCURACY RULES ===
1. SPECIES MUST BE EXACT: Each character's species/type cannot be changed
2. DISTINCTIVE FEATURES MANDATORY: All unique physical traits must be preserved
3. COLOR ACCURACY: Original colors and markings must be maintained
4. PROPORTIONS: Body structure and size relationships must match descriptions
5. NO HUMAN SUBSTITUTION: Non-human characters must remain non-human
6. EQUIPMENT/CLOTHING: All described items must be included accurately

RENDER PRIORITY: Character accuracy > artistic interpretation
STYLE: Epic fantasy battle art, professional game illustration quality

Generate this battle scene with absolute fidelity to character descriptions.
    `.trim();

    try {
        console.log("=== 대폭 강화된 최종 전투 이미지 프롬프트 ===");
        console.log(directBattlePrompt);
        console.log("=== 강화된 프롬프트 끝 ===");

        // 이미지 캐싱 방지를 위해 기존 이미지 제거
        if (storyGeneratedImage) {
            storyGeneratedImage.src = '';
        }
        
        // 직접 이미지 생성 (AI 재해석 단계 생략)
        console.log('이미지 생성 API 호출 시작...');
        
        const response = await fetch('/api/generate-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt: directBattlePrompt })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('이미지 생성 완료, 결과:', result.success ? '성공' : '실패');
        
        if (result.success && result.imageUrl && storyGeneratedImage) {
            storyGeneratedImage.src = result.imageUrl;
            // 이미지 크기 조정을 위한 스타일 적용
            storyGeneratedImage.style.maxWidth = '800px';
            storyGeneratedImage.style.maxHeight = '450px';
            storyGeneratedImage.style.width = '100%';
            storyGeneratedImage.style.height = 'auto';
            storyGeneratedImage.style.borderRadius = '8px';
            storyGeneratedImage.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
            console.log('이미지 URL 설정 및 스타일 적용 완료');
            
            // 이미지 생성 완료 표시
            storyGenerateBtn.innerHTML = '✅ 이미지 생성 완료';
            storyGenerateBtn.dataset.imageGenerated = 'true';
            storyGenerateBtn.style.backgroundColor = '#28a745';
            storyGenerateBtn.style.cursor = 'not-allowed';
        } else {
            throw new Error(result.message || '이미지 생성에 실패했습니다.');
        }
        
    } catch (error) {
        console.error('=== 전투 이미지 생성 오류 ===');
        console.error('오류 상세:', error);
        if (storyGeneratedImage) {
            storyGeneratedImage.alt = '이미지 생성 중 오류가 발생했습니다.';
            storyGeneratedImage.src = `https://placehold.co/600x400/ff0000/ffffff?text=Image+Gen+Error`;
            storyGeneratedImage.style.maxWidth = '600px';
            storyGeneratedImage.style.maxHeight = '400px';
            storyGeneratedImage.style.width = '100%';
            storyGeneratedImage.style.height = 'auto';
        }
        // 오류 시에도 버튼 비활성화 (재시도 방지)
        storyGenerateBtn.innerHTML = '❌ 이미지 생성 실패';
        storyGenerateBtn.dataset.imageGenerated = 'true';
        storyGenerateBtn.style.backgroundColor = '#dc3545';
        storyGenerateBtn.style.cursor = 'not-allowed';
    } finally {
        console.log('=== 전투 이미지 생성 완료 ===');
        // 로딩 표시 완전 제거 (중복 방지)
        const loader = storyImageContainer.querySelector('.image-loader');
        if (loader) {
            loader.remove();
        }
        if (storyGeneratedImage) {
            storyGeneratedImage.classList.remove('hidden');
        }
        // 버튼은 영구 비활성화 상태 유지
        storyGenerateBtn.disabled = true;
    }
}

// --- MIGRATION FUNCTIONS ---
async function migrateExistingCharacters() {
    try {
        console.log('Starting character migration for appearance_prompt field...');
        
        // 모든 캐릭터 조회
        const charactersQuery = query(collectionGroup(db, 'characters'));
        const charactersSnapshot = await getDocs(charactersQuery);
        
        let migratedCount = 0;
        const batch = writeBatch(db);
        
        charactersSnapshot.forEach((doc) => {
            const data = doc.data();
            
            // appearance_prompt 필드가 없고 image_prompt가 있는 경우 마이그레이션
            if (!data.appearance_prompt && data.image_prompt) {
                batch.update(doc.ref, {
                    appearance_prompt: data.image_prompt,
                    migrated: true,
                    migratedAt: new Date().toISOString()
                });
                migratedCount++;
                console.log(`Migrating character: ${data.name}`);
            }
        });
        
        if (migratedCount > 0) {
            await batch.commit();
            console.log(`Successfully migrated ${migratedCount} characters`);
            alert(`${migratedCount}개의 기존 캐릭터에 외형 정보를 추가했습니다.`);
        } else {
            console.log('No characters need migration');
        }
        
    } catch (error) {
        console.error('Error during character migration:', error);
        alert('캐릭터 마이그레이션 중 오류가 발생했습니다.');
    }
}

// --- ADMIN FUNCTIONS ---
async function loadAdminData() {
    try {
        // 모든 캐릭터 수 계산
        const charactersQuery = query(collectionGroup(db, 'characters'));
        const charactersSnapshot = await getDocs(charactersQuery);
        const totalCharacters = charactersSnapshot.size;
        
        // 모든 사용자 수 계산 (users 컬렉션에서)
        const usersQuery = query(collection(db, 'users'));
        const usersSnapshot = await getDocs(usersQuery);
        const totalUsers = usersSnapshot.size;
        
        // UI 업데이트
        totalCharactersCount.textContent = totalCharacters;
        totalUsersCount.textContent = totalUsers;
        
        // 모든 캐릭터 목록 로드
        await loadAllCharactersForAdmin();
        
    } catch (error) {
        console.error('Error loading admin data:', error);
        alert('관리자 데이터를 불러오는 중 오류가 발생했습니다.');
    }
}

async function loadAllCharactersForAdmin() {
    try {
        adminCharactersList.innerHTML = '<p>캐릭터 목록을 불러오는 중...</p>';
        
        console.log('Starting to load all characters for admin...');
        
        const q = query(collectionGroup(db, 'characters'));
        const querySnapshot = await getDocs(q);
        
        console.log('Total documents found:', querySnapshot.size);
        
        const characters = [];
        
        querySnapshot.forEach((doc) => {
            try {
                const data = doc.data();
                
                console.log(`Processing document:`, {
                    id: doc.id,
                    name: data.name,
                    ref: doc.ref,
                    path: doc.ref.path,
                    data: data
                });
                
                const wins = data.wins || 0;
                const losses = data.losses || 0;
                const totalBattles = wins + losses;
                const winRate = totalBattles > 0 ? (wins / totalBattles * 100).toFixed(1) : 0;
                
                // 사용자 ID 추출 (doc.ref.parent.parent.id 대신 더 안전한 방법)
                let userId = 'unknown';
                try {
                    if (doc.ref && doc.ref.parent && doc.ref.parent.parent) {
                        userId = doc.ref.parent.parent.id;
                    }
                } catch (refError) {
                    console.warn('Could not extract user ID for:', doc.id);
                }
                
                const character = {
                    id: doc.id,
                    userId: userId,
                    name: data.name || '이름 없음',
                    class: data.class || '클래스 없음',
                    wins,
                    losses,
                    totalBattles,
                    winRate: parseFloat(winRate),
                    imageUrl: data.imageUrl || 'https://placehold.co/512x512/333/FFF?text=?',
                    createdAt: data.createdAt || '알 수 없음'
                };
                
                characters.push(character);
                console.log('Added character:', character.name, 'from user:', character.userId);
                
            } catch (error) {
                console.warn('Error processing document:', doc.id, error);
            }
        });
        
        console.log(`Processing complete. Total processed: ${characters.length}`);
        
        // 생성일 기준으로 정렬 (최신순)
        characters.sort((a, b) => {
            if (a.createdAt === '알 수 없음') return 1;
            if (b.createdAt === '알 수 없음') return -1;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
        
        if (characters.length === 0) {
            adminCharactersList.innerHTML = '<p>등록된 캐릭터가 없습니다.</p>';
            return;
        }
        
        adminCharactersList.innerHTML = '';
        characters.forEach((character, index) => {
            const characterCard = document.createElement('div');
            characterCard.className = 'admin-character-card';
            characterCard.innerHTML = `
                <div class="admin-character-info">
                    <img src="${character.imageUrl}" alt="${character.name}" class="admin-character-image">
                    <div class="admin-character-details">
                        <h4>${character.name}</h4>
                        <p><strong>클래스:</strong> ${character.class}</p>
                        <p><strong>사용자 ID:</strong> ${character.userId}</p>
                        <p><strong>전적:</strong> ${character.wins}승 ${character.losses}패 (승률: ${character.winRate}%)</p>
                        <p><strong>생성일:</strong> ${character.createdAt}</p>
                    </div>
                </div>
                <div class="admin-character-actions">
                    <button class="delete-character-btn" onclick="deleteCharacterFromAdmin('${character.userId}', '${character.id}', '${character.name}')">
                        삭제
                    </button>
                </div>
            `;
            adminCharactersList.appendChild(characterCard);
        });
        
        console.log(`Displayed ${characters.length} characters in admin panel`);
        
    } catch (error) {
        console.error('Error loading characters for admin:', error);
        adminCharactersList.innerHTML = '<p>캐릭터 목록을 불러오는 중 오류가 발생했습니다.</p>';
    }
}

async function deleteCharacterFromAdmin(userId, characterId, characterName) {
    // 모달창으로 확인
    const modal = document.createElement('div');
    modal.className = 'delete-modal';
    modal.innerHTML = `
        <div class="delete-modal-content">
            <h3>캐릭터 삭제 확인</h3>
            <p>정말로 "<strong>${characterName}</strong>" 캐릭터를 삭제하시겠습니까?</p>
            <p style="color: #ff6b6b; font-size: 0.9em;">이 작업은 되돌릴 수 없습니다.</p>
            <div class="delete-modal-buttons">
                <button class="cancel-btn" onclick="closeDeleteModal()">취소</button>
                <button class="confirm-delete-btn" onclick="confirmDeleteCharacter('${userId}', '${characterId}', '${characterName}')">삭제</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // 모달 외부 클릭 시 닫기
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeDeleteModal();
        }
    });
}

// 모달 닫기 함수
function closeDeleteModal() {
    const modal = document.querySelector('.delete-modal');
    if (modal) {
        modal.remove();
    }
}

// 실제 삭제 실행 함수
async function confirmDeleteCharacter(userId, characterId, characterName) {
    closeDeleteModal();
    
    try {
        let deleted = false;
        
        // collectionGroup에서 모든 캐릭터를 가져와서 해당 ID 찾기
        console.log(`Searching for character ${characterId} using collectionGroup...`);
        
        const q = query(collectionGroup(db, 'characters'));
        const querySnapshot = await getDocs(q);
        
        // 해당 ID를 가진 문서 찾기
        for (const docSnapshot of querySnapshot.docs) {
            if (docSnapshot.id === characterId) {
                console.log(`Found character at path: ${docSnapshot.ref.path}`);
                await deleteDoc(docSnapshot.ref);
                console.log(`Character ${characterId} deleted successfully`);
                deleted = true;
                break;
            }
        }
        
        if (!deleted && userId !== 'unknown') {
            // collectionGroup으로 찾지 못한 경우 기존 방식으로 시도
            const characterRef = doc(db, 'users', userId, 'characters', characterId);
            const characterDoc = await getDoc(characterRef);
            
            if (characterDoc.exists()) {
                await deleteDoc(characterRef);
                console.log(`Character ${characterId} deleted from user ${userId}`);
                deleted = true;
            }
        }
        
        if (deleted) {
            console.log(`"${characterName}" 캐릭터가 성공적으로 삭제되었습니다.`);
            
            // 관리자 데이터 새로고침 (확인 메시지 없이)
            await loadAdminData();
        } else {
            throw new Error('캐릭터를 찾을 수 없습니다.');
        }
        
    } catch (error) {
        console.error('Error deleting character from admin:', error);
        alert('캐릭터 삭제 중 오류가 발생했습니다: ' + error.message);
    }
}

// 전역 함수로 등록 (HTML onclick에서 접근 가능하도록)
window.closeDeleteModal = closeDeleteModal;
window.confirmDeleteCharacter = confirmDeleteCharacter;

async function exportAdminData() {
    try {
        const q = query(collectionGroup(db, 'characters'));
        const querySnapshot = await getDocs(q);
        
        const characters = [];
        querySnapshot.forEach((doc) => {
            try {
                const data = doc.data();
                
                // 문서나 참조가 null인 경우 건너뛰기
                if (!doc || !doc.ref || !doc.ref.parent || !doc.ref.parent.parent) {
                    console.warn('Invalid document reference found during export, skipping:', doc.id);
                    return;
                }
                
                characters.push({
                    id: doc.id,
                    userId: doc.ref.parent.parent.id,
                    ...data
                });
            } catch (error) {
                console.warn('Error processing document during export:', doc.id, error);
            }
        });
        
        const dataStr = JSON.stringify(characters, null, 2);
        const dataBlob = new Blob([dataStr], {type: 'application/json'});
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `character_battle_data_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        alert('데이터가 성공적으로 내보내졌습니다.');
        
    } catch (error) {
        console.error('Error exporting data:', error);
        alert('데이터 내보내기 중 오류가 발생했습니다.');
    }
}

// 전역 함수로 만들어서 HTML onclick에서 호출 가능하게 함
window.deleteCharacterFromAdmin = deleteCharacterFromAdmin;
window.showBattleExitModal = showBattleExitModal;
window.confirmBattleExit = confirmBattleExit;
window.closeBattleExitModal = closeBattleExitModal;

// --- EVENT LISTENERS ---
adminBtn.addEventListener('click', () => {
    showView('admin');
    loadAdminData();
});

backToCardsFromAdminBtn.addEventListener('click', () => {
    showView('character-cards');
});

refreshDataBtn.addEventListener('click', () => {
    loadAdminData();
});

exportDataBtn.addEventListener('click', () => {
    exportAdminData();
});

// 마이그레이션 버튼 이벤트 리스너
const migrateCharactersBtn = document.getElementById('migrate-characters-btn');
migrateCharactersBtn.addEventListener('click', () => {
    if (confirm('기존 캐릭터들에게 외형 정보를 추가하시겠습니까? 이 작업은 전투 이미지 생성의 일관성을 향상시킵니다.')) {
        migrateExistingCharacters();
    }
});

// 새로운 게임 플로우 이벤트 리스너들
backToDetailFromMatchingBtn.addEventListener('click', () => {
    showView('character-detail');
});

backToMatchingBtn.addEventListener('click', () => {
    // 전투 중인지 확인
    const battleSection = document.getElementById('battle-section');
    const newBattleGaugeContainer = document.getElementById('new-battle-gauge-container');
    
    // 전투가 진행 중인 경우 (게이지가 표시되고 있는 경우)
    if (battleSection && !battleSection.classList.contains('hidden') && 
        newBattleGaugeContainer && !newBattleGaugeContainer.classList.contains('hidden')) {
        showBattleExitModal();
    } else {
        // 전투가 진행 중이 아닌 경우 바로 매칭 화면으로
        showView('matching');
    }
});

// 소설 로그에서 캐릭터 카드로 돌아가기 (기존 기능 유지)
const backToCardsFromNovelBtn = document.getElementById('back-to-cards-from-novel-btn');
if (backToCardsFromNovelBtn) {
    backToCardsFromNovelBtn.addEventListener('click', () => {
        novelLogModal.classList.add('hidden');
        showView('character-cards');
    });
}
