// ------------------------------------------------------------------
// 0. Firebase 설정 및 초기화
// ------------------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getFirestore, doc, setDoc, addDoc, collection, getDocs, getDoc, runTransaction, query, where, limit, orderBy, collectionGroup, deleteDoc, writeBatch, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";
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
const GEMINI_API_KEY = "AIzaSyBTbqLGoY22MHjgXP1uWh_X-oCpoeEBl1Q"; // 첫 번째 Gemini API 키
const GEMINI_API_KEY_2 = "AIzaSyBWGh2EuJ90wkCEJ1knfJbjl1XsJX6I1nI"; // 두 번째 Gemini API 키 (폴백용)

// --- INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 첫 번째 API 키로 초기화
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// 두 번째 API 키로 초기화 (폴백용)
const genAI2 = new GoogleGenerativeAI(GEMINI_API_KEY_2);

// 텍스트 생성용 Gemini 모델들 (폴백 시스템) - 한국어 응답 강제
const koreanSystemInstruction = "You must respond in Korean only. All narrative text, descriptions, and story content must be written in Korean. Character names, skill names, and proper nouns can remain in their original language, but all other text must be in Korean.";

// 첫 번째 API 키 모델들
const primaryModel = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-flash',
    systemInstruction: koreanSystemInstruction
});
const fallbackModel1 = genAI.getGenerativeModel({ 
    model: 'gemini-2.0-flash',
    systemInstruction: koreanSystemInstruction
});
const fallbackModel2 = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-flash-lite',
    systemInstruction: koreanSystemInstruction
});

// 두 번째 API 키 모델들 (폴백용)
const primaryModel2 = genAI2.getGenerativeModel({ 
    model: 'gemini-2.5-flash',
    systemInstruction: koreanSystemInstruction
});
const fallbackModel1_2 = genAI2.getGenerativeModel({ 
    model: 'gemini-2.0-flash',
    systemInstruction: koreanSystemInstruction
});
const fallbackModel2_2 = genAI2.getGenerativeModel({ 
    model: 'gemini-2.5-flash-lite',
    systemInstruction: koreanSystemInstruction
});

// 이미지 생성은 Craiyon API를 사용합니다.

// 2단계 모델 폴백 순서 정의 (API키1 → API키2)
const modelFallbackOrder = [
    // 첫 번째 API 키로 3개 모델 시도
    { name: 'gemini-2.5-flash', model: primaryModel, apiKey: 1 },
    { name: 'gemini-2.0-flash', model: fallbackModel1, apiKey: 1 },
    { name: 'gemini-2.5-flash-lite', model: fallbackModel2, apiKey: 1 },
    // 두 번째 API 키로 3개 모델 시도
    { name: 'gemini-2.5-flash (API키2)', model: primaryModel2, apiKey: 2 },
    { name: 'gemini-2.0-flash (API키2)', model: fallbackModel1_2, apiKey: 2 },
    { name: 'gemini-2.5-flash-lite (API키2)', model: fallbackModel2_2, apiKey: 2 }
];

// --- STATE ---
let currentUser = null;
let generatedCharacterData = null;
let playerCharacterForBattle = null;
let opponentCharacterForBattle = null;
let selectedCharacterCard = null;
let selectedSkills = [];

// 실시간 리스너 기반 전역 데이터
let allCharactersPool = []; // 실시간 업데이트되는 모든 캐릭터 풀
let userCharactersPool = []; // 실시간 업데이트되는 사용자 캐릭터 풀
let rankingData = []; // 실시간 업데이트되는 랭킹 데이터
let userLuna = 0; // 사용자의 루나 잔액

// 실시간 리스너 관리
let allCharactersUnsubscribe = null;
let userCharactersUnsubscribe = null;
let isRealTimeInitialized = false;

// ------------------------------------------------------------------
// 스토리 캐시 및 디테일 추적 시스템
// ------------------------------------------------------------------

// 스토리 캐시 클래스 - Firebase 읽기/쓰기 최적화
class StoryCache {
    constructor() {
        this.cache = new Map();
        this.detailsCache = new Map();
        this.lastSync = 0;
        this.pendingUpdates = new Map();
        this.SYNC_INTERVAL = 300000; // 5분
    }
    
    // 캐시에서 페이지 데이터 가져오기
    get(pageNumber) {
        return this.cache.get(pageNumber);
    }
    
    // 캐시에 페이지 데이터 저장
    set(pageNumber, pageData) {
        this.cache.set(pageNumber, pageData);
    }
    
    // 캐시에서 페이지 데이터 삭제
    delete(pageNumber) {
        return this.cache.delete(pageNumber);
    }
    
    // 스토리 디테일 가져오기 (캐싱 적용)
    async getDetails(storyId) {
        if (Date.now() - this.lastSync > this.SYNC_INTERVAL) {
            await this.syncDetailsWithFirebase(storyId);
        }
        return this.detailsCache.get(storyId) || this.getDefaultDetails();
    }
    
    // 로컬 디테일 업데이트
    updateDetailsLocal(storyId, updates) {
        const current = this.detailsCache.get(storyId) || this.getDefaultDetails();
        const updated = this.mergeDetails(current, updates);
        this.detailsCache.set(storyId, updated);
        
        // 대기 중인 업데이트에 추가
        const pending = this.pendingUpdates.get(storyId) || this.getDefaultDetails();
        this.pendingUpdates.set(storyId, this.mergeDetails(pending, updates));
    }
    
    // Firebase와 디테일 동기화
    async syncDetailsWithFirebase(storyId) {
        try {
            const detailsRef = doc(db, 'story_details', storyId);
            const detailsDoc = await getDoc(detailsRef);
            
            if (detailsDoc.exists()) {
                this.detailsCache.set(storyId, detailsDoc.data());
            } else {
                this.detailsCache.set(storyId, this.getDefaultDetails());
            }
            
            this.lastSync = Date.now();
        } catch (error) {
            console.error('디테일 동기화 오류:', error);
        }
    }
    
    // Firebase에 디테일 저장 (배치 처리)
    async saveDetailsToFirebase(storyId) {
        try {
            const pending = this.pendingUpdates.get(storyId);
            if (!pending) return;
            
            const detailsRef = doc(db, 'story_details', storyId);
            await setDoc(detailsRef, pending, { merge: true });
            
            // 대기 중인 업데이트 클리어
            this.pendingUpdates.delete(storyId);
            
            console.log('스토리 디테일 저장 완료');
        } catch (error) {
            console.error('디테일 저장 오류:', error);
            throw error;
        }
    }
    
    // 기본 디테일 구조
    getDefaultDetails() {
        return {
            characters: {},
            situations: {
                current: '',
                location: '',
                activeEvents: []
            },
            promises: [],
            relationships: {},
            items: {},
            lastUpdated: new Date().toISOString()
        };
    }
    
    // 디테일 병합
    mergeDetails(current, updates) {
        const merged = JSON.parse(JSON.stringify(current));
        
        // 캐릭터 정보 병합
        if (updates.characters) {
            Object.keys(updates.characters).forEach(charId => {
                if (!merged.characters[charId]) {
                    merged.characters[charId] = {};
                }
                Object.assign(merged.characters[charId], updates.characters[charId]);
            });
        }
        
        // 상황 정보 병합
        if (updates.situations) {
            Object.assign(merged.situations, updates.situations);
        }
        
        // 약속 추가
        if (updates.promises) {
            merged.promises = [...merged.promises, ...updates.promises];
        }
        
        // 관계 정보 병합
        if (updates.relationships) {
            Object.assign(merged.relationships, updates.relationships);
        }
        
        // 아이템 정보 병합
        if (updates.items) {
            Object.assign(merged.items, updates.items);
        }
        
        merged.lastUpdated = new Date().toISOString();
        return merged;
    }
}

// 디테일 추출기 클래스
class DetailExtractor {
    constructor() {
        this.keywords = {
            promises: ['약속', '만나자', '기다리', '나중에', '다음에', '후에'],
            items: ['받았다', '얻었다', '주었다', '가지고', '소지', '장비'],
            injuries: ['다쳤다', '부상', '상처', '아프다', '피'],
            emotions: ['화나', '기쁘', '슬프', '놀라', '무서', '걱정'],
            relationships: ['친구', '적', '동료', '연인', '가족', '스승'],
            locations: ['도착', '떠나', '이동', '향해', '에서', '으로'],
            battles: ['전투', '싸움', '공격', '방어', '승리', '패배']
        };
    }
    
    // 생성된 내용에서 디테일 추출
    extractFromContent(content, appearingCharacters) {
        const cleanContent = content.replace(/<[^>]*>/g, '').trim();
        const sentences = cleanContent.split(/[.!?]/).filter(s => s.trim().length > 5);
        
        const details = {
            characters: {},
            situations: {},
            promises: [],
            relationships: {},
            items: {}
        };
        
        // 등장 캐릭터들의 상태 업데이트
        appearingCharacters.forEach(char => {
            details.characters[char.id] = {
                lastAppeared: Date.now(),
                currentState: this.extractCharacterState(cleanContent, char.name),
                emotions: this.extractEmotions(cleanContent, char.name)
            };
        });
        
        // 상황 정보 추출
        details.situations = {
            current: this.extractCurrentSituation(cleanContent),
            location: this.extractLocation(cleanContent),
            activeEvents: this.extractActiveEvents(cleanContent)
        };
        
        // 약속 추출
        details.promises = this.extractPromises(cleanContent);
        
        // 관계 변화 추출
        details.relationships = this.extractRelationshipChanges(cleanContent, appearingCharacters);
        
        // 아이템 변화 추출
        details.items = this.extractItemChanges(cleanContent);
        
        return details;
    }
    
    // 캐릭터 상태 추출
    extractCharacterState(content, characterName) {
        const states = [];
        
        // 부상 상태 확인
        this.keywords.injuries.forEach(keyword => {
            if (content.includes(characterName) && content.includes(keyword)) {
                states.push(`부상: ${keyword}`);
            }
        });
        
        // 전투 상태 확인
        this.keywords.battles.forEach(keyword => {
            if (content.includes(characterName) && content.includes(keyword)) {
                states.push(`전투: ${keyword}`);
            }
        });
        
        return states.join(', ');
    }
    
    // 감정 상태 추출
    extractEmotions(content, characterName) {
        const emotions = [];
        
        this.keywords.emotions.forEach(keyword => {
            if (content.includes(characterName) && content.includes(keyword)) {
                emotions.push(keyword);
            }
        });
        
        return emotions;
    }
    
    // 현재 상황 추출
    extractCurrentSituation(content) {
        const sentences = content.split(/[.!?]/);
        const lastSentences = sentences.slice(-3).join('. ');
        return lastSentences.slice(0, 200);
    }
    
    // 위치 정보 추출
    extractLocation(content) {
        const locationKeywords = ['성', '마을', '숲', '산', '강', '바다', '동굴', '탑', '궁전'];
        
        for (const keyword of locationKeywords) {
            if (content.includes(keyword)) {
                const sentences = content.split(/[.!?]/);
                for (const sentence of sentences) {
                    if (sentence.includes(keyword)) {
                        return sentence.trim().slice(0, 100);
                    }
                }
            }
        }
        
        return '';
    }
    
    // 활성 이벤트 추출
    extractActiveEvents(content) {
        const events = [];
        const eventKeywords = ['전투', '모험', '탐험', '의식', '회의', '축제', '여행'];
        
        eventKeywords.forEach(keyword => {
            if (content.includes(keyword)) {
                events.push(keyword);
            }
        });
        
        return events;
    }
    
    // 약속 추출
    extractPromises(content) {
        const promises = [];
        const sentences = content.split(/[.!?]/);
        
        sentences.forEach(sentence => {
            this.keywords.promises.forEach(keyword => {
                if (sentence.includes(keyword)) {
                    promises.push({
                        content: sentence.trim(),
                        createdAt: new Date().toISOString(),
                        status: 'pending'
                    });
                }
            });
        });
        
        return promises;
    }
    
    // 관계 변화 추출
    extractRelationshipChanges(content, characters) {
        const changes = {};
        
        // 캐릭터 간 관계 키워드 확인
        for (let i = 0; i < characters.length; i++) {
            for (let j = i + 1; j < characters.length; j++) {
                const char1 = characters[i].name;
                const char2 = characters[j].name;
                
                this.keywords.relationships.forEach(keyword => {
                    if (content.includes(char1) && content.includes(char2) && content.includes(keyword)) {
                        const key = `${char1}-${char2}`;
                        changes[key] = keyword;
                    }
                });
            }
        }
        
        return changes;
    }
    
    // 아이템 변화 추출
    extractItemChanges(content) {
        const items = {};
        const sentences = content.split(/[.!?]/);
        
        sentences.forEach(sentence => {
            this.keywords.items.forEach(keyword => {
                if (sentence.includes(keyword)) {
                    // 간단한 아이템 추출 (더 정교한 로직 필요시 개선)
                    const words = sentence.split(' ');
                    const keywordIndex = words.findIndex(word => word.includes(keyword));
                    if (keywordIndex > 0) {
                        const itemName = words[keywordIndex - 1];
                        items[itemName] = {
                            action: keyword,
                            context: sentence.trim()
                        };
                    }
                }
            });
        });
        
        return items;
    }
}

// 전역 인스턴스 생성
const storyCache = new StoryCache();
const detailExtractor = new DetailExtractor();

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
// const backToMatchingBtn = document.getElementById('back-to-matching-btn'); // 제거됨

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
    console.log(`🔄 폴백 시스템 시작: ${modelFallbackOrder.length}개 모델 시도`);
    console.log('📋 모델 순서:', modelFallbackOrder.map(m => `${m.name} (API키${m.apiKey})`));
    
    for (let modelIndex = 0; modelIndex < modelFallbackOrder.length; modelIndex++) {
        const { name: modelName, model, apiKey } = modelFallbackOrder[modelIndex];
        
        console.log(`🔄 모델 ${modelIndex + 1}/${modelFallbackOrder.length}: ${modelName} (API키${apiKey}) 시도 중...`);
        
        // API 키 전환 시점 확인 및 메시지 표시
        if (modelIndex === 3) {
            updateProgress(null, '🔄 첫 번째 API 키 할당량 초과, 두 번째 API 키로 전환 중...');
            console.log('🔄 두 번째 API 키로 전환');
            await new Promise(res => setTimeout(res, 1000)); // 사용자가 메시지를 볼 수 있도록 대기
        }
        
        // 첫 번째 모델이 아닌 경우 폴백 상태 표시
        if (modelIndex > 0 && modelIndex !== 3) {
            updateModelStatus(modelName, 'fallback');
            await new Promise(res => setTimeout(res, 500)); // 사용자가 메시지를 볼 수 있도록 잠시 대기
        } else if (modelIndex === 0 || modelIndex === 3) {
            updateModelStatus(modelName, 'trying');
        }
        
        for (let attempt = 1; attempt <= maxRetriesPerModel; attempt++) {
            try {
                console.log(`Attempting with ${modelName} (API키${apiKey}) (attempt ${attempt}/${maxRetriesPerModel})`);
                const result = await model.generateContent(prompt);
                
                // 응답이 비어있거나 너무 짧은 경우 체크
                if (!result || !result.response || !result.response.text()) {
                    throw new Error('Empty or invalid response received');
                }
                
                const responseText = result.response.text();
                if (responseText.trim().length < 10) {
                    throw new Error('Response too short, likely incomplete');
                }
                
                console.log(`✅ Success with ${modelName} (API키${apiKey})`);
                updateModelStatus(modelName, 'success');
                return result;
                
            } catch (error) {
                console.warn(`❌ ${modelName} (API키${apiKey}) attempt ${attempt} failed:`, error.message);
                
                // 429 에러 (할당량 초과) 체크 추가
                if (error.message.includes('429') ||
                    error.message.includes('Too Many Requests') ||
                    error.message.includes('500') ||
                    error.message.includes('Internal Server Error') ||
                    error.message.includes('internal error') ||
                    error.message.includes('quota') || 
                    error.message.includes('limit') || 
                    error.message.includes('RESOURCE_EXHAUSTED') ||
                    error.message.includes('RATE_LIMIT_EXCEEDED')) {
                    console.log(`🔄 Server error or limit reached for ${modelName} (API키${apiKey}), switching to next model`);
                    updateModelStatus(modelName, 'failed');
                    break; // 다음 모델로 즉시 전환
                }
                
                // 마지막 시도가 아니면 잠시 대기
                if (attempt < maxRetriesPerModel) {
                    await new Promise(res => setTimeout(res, 1000 * attempt));
                } else {
                    console.log(`🔄 All attempts failed for ${modelName} (API키${apiKey}), trying next model`);
                    updateModelStatus(modelName, 'failed');
                }
            }
        }
        
        console.log(`❌ ${modelName} (API키${apiKey}) 완전 실패, 다음 모델로 이동`);
    }
    
    // 모든 모델이 실패한 경우
    console.log('❌ 모든 폴백 모델과 API 키가 실패했습니다.');
    updateProgress(null, '❌ 모든 API 키와 모델이 실패했습니다. 잠시 후 다시 시도해주세요.');
    throw new Error('All fallback models and API keys failed. Please try again later.');
}

// 기존 함수명과의 호환성을 위한 별칭
const generateWithRetry = generateWithFallback;

// --- LEGACY CACHING SYSTEM (통합됨) ---
// 기존 캐시 시스템은 새로운 스마트 캐시 시스템으로 대체됨
let lastRankingUpdate = 0;
const RANKING_UPDATE_INTERVAL = 5 * 60 * 1000; // 5분마다 랭킹 업데이트

// 레거시 함수들 (호환성 유지)
function getCachedCharacter(characterId) {
    const cacheKey = `char_${characterId}`;
    
    // 캐시에서 직접 확인
    if (isCacheValid(cacheKey, CACHE_DURATION.CHARACTER_DATA)) {
        const cachedData = characterDataCache.get(cacheKey);
        if (cachedData) {
            return cachedData;
        }
    }
    
    // 실시간 풀에서 확인
    if (allCharactersPool && allCharactersPool.length > 0) {
        const poolData = allCharactersPool.find(char => char.id === characterId);
        if (poolData) {
            setCache(cacheKey, poolData, 'CHARACTER_DATA');
            return poolData;
        }
    }
    
    return null;
}

function setCachedCharacter(characterId, data) {
    if (typeof setCache === 'function') {
        setCache(`char_${characterId}`, data, 'CHARACTER_DATA');
    }
}

// --- OPTIMIZED REAL-TIME LISTENERS ---
// 실시간 리스너 초기화 (최적화됨)
function initializeRealTimeListeners() {
    if (isRealTimeInitialized) return;
    
    console.log('🔄 최적화된 실시간 리스너 초기화 중...');
    
    // 선택적 캐릭터 실시간 리스너 (신규 캐릭터 감지용)
    const allCharactersQuery = collectionGroup(db, 'characters');
    allCharactersUnsubscribe = onSnapshot(allCharactersQuery, (snapshot) => {
        const newCharacters = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            const characterRef = doc.ref;
            const pathParts = characterRef.path.split('/');
            const userId = pathParts[1]; // users/{userId}/characters/{characterId}
            
            const character = {
                id: doc.id,
                userId: userId,
                ...data
            };
            
            newCharacters.push(character);
            
            // 캐시 업데이트 (신규 또는 변경된 캐릭터만)
            const existing = allCharactersPool.find(c => c.id === doc.id);
            if (!existing || existing.lastModified !== data.lastModified) {
                setCachedCharacter(doc.id, character);
            }
        });
        
        allCharactersPool = newCharacters;
        console.log(`✅ 전체 캐릭터 풀 업데이트: ${allCharactersPool.length}개`);
        
        // 배치 랭킹 업데이트 (5분마다만)
        const now = Date.now();
        if (now - lastRankingUpdate > RANKING_UPDATE_INTERVAL) {
            updateRankingData();
            lastRankingUpdate = now;
            console.log('🔄 배치 랭킹 업데이트 실행');
        }
        
        // 랭킹 모달이 열려있다면 UI 업데이트
        if (!rankingModal.classList.contains('hidden')) {
            displayRankingData(rankingData);
        }
    }, (error) => {
        console.error('전체 캐릭터 리스너 오류:', error);
    });
    
    isRealTimeInitialized = true;
    console.log('✅ 최적화된 실시간 리스너 초기화 완료');
}

// 사용자별 캐릭터 실시간 리스너 초기화
function initializeUserCharactersListener(userId) {
    if (userCharactersUnsubscribe) {
        userCharactersUnsubscribe();
    }
    
    const userCharactersQuery = collection(db, 'users', userId, 'characters');
    userCharactersUnsubscribe = onSnapshot(userCharactersQuery, (snapshot) => {
        userCharactersPool = [];
        snapshot.forEach((doc) => {
            userCharactersPool.push({
                id: doc.id,
                userId: userId,
                ...doc.data()
            });
        });
        
        console.log(`✅ 사용자 캐릭터 풀 업데이트: ${userCharactersPool.length}개`);
        
        // 앱 콘텐츠가 표시되어 있다면 UI 업데이트 (캐릭터 생성 후 즉시 반영)
        if (!appContent.classList.contains('hidden')) {
            displayUserCharacters(userCharactersPool);
        }
    }, (error) => {
        console.error('사용자 캐릭터 리스너 오류:', error);
    });
}

// 랭킹 데이터 업데이트
function updateRankingData() {
    const charactersWithStats = allCharactersPool.map(character => {
        const totalBattles = (character.wins || 0) + (character.losses || 0);
        const winRate = totalBattles > 0 ? ((character.wins || 0) / totalBattles * 100).toFixed(2) : "0.00";
        
        return {
            ...character,
            totalBattles,
            winRate
        };
    });
    
    // 승률 기준으로 정렬 (승률이 같으면 총 전투 수로 정렬)
    // 전투 기록이 있는 캐릭터를 우선 순위로 정렬하고 상위 10개만 유지
    rankingData = charactersWithStats
        .sort((a, b) => {
            const winRateA = parseFloat(a.winRate);
            const winRateB = parseFloat(b.winRate);
            
            // 전투 기록이 있는 캐릭터를 우선 순위로
            if (a.totalBattles > 0 && b.totalBattles === 0) return -1;
            if (a.totalBattles === 0 && b.totalBattles > 0) return 1;
            
            // 둘 다 전투 기록이 있거나 없는 경우 승률로 정렬
            if (winRateB !== winRateA) {
                return winRateB - winRateA;
            }
            return b.totalBattles - a.totalBattles;
        })
        .slice(0, 10); // 상위 10개만 유지
    
    console.log(`📊 랭킹 데이터 업데이트: ${rankingData.length}개 캐릭터`);
}

// 실시간 리스너 정리
function cleanupRealTimeListeners() {
    if (allCharactersUnsubscribe) {
        allCharactersUnsubscribe();
        allCharactersUnsubscribe = null;
    }
    
    if (userCharactersUnsubscribe) {
        userCharactersUnsubscribe();
        userCharactersUnsubscribe = null;
    }
    
    isRealTimeInitialized = false;
    allCharactersPool = [];
    userCharactersPool = [];
    rankingData = [];
    
    console.log('🧹 실시간 리스너 정리 완료');
}

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
    
    // 스토리 섹션도 숨김
    const storySection = document.getElementById('story-section');
    if (storySection) {
        storySection.classList.add('hidden');
    }

    if (view === 'auth') {
        authSection.classList.remove('hidden');
    } else if (view === 'character-cards') {
        appContent.classList.remove('hidden');
        characterCardsSection.classList.remove('hidden');
        // 실시간 리스너가 이미 데이터를 관리하므로 별도 로드 불필요
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
    } else if (view === 'story') {
        appContent.classList.remove('hidden');
        if (storySection) {
            storySection.classList.remove('hidden');
        }
    }
}

// --- AUTHENTICATION ---
onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        // 사용자 문서가 존재하지 않으면 생성
        try {
            const userDocRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);
            
            if (!userDoc.exists()) {
                await setDoc(userDocRef, {
                    uid: user.uid,
                    email: user.email,
                    createdAt: new Date().toISOString(),
                    lastLoginAt: new Date().toISOString()
                });
                console.log('새 사용자 문서 생성됨:', user.uid);
            } else {
                // 기존 사용자의 마지막 로그인 시간 업데이트
                await updateDoc(userDocRef, {
                    lastLoginAt: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('사용자 문서 처리 오류:', error);
        }
        
        logoutBtn.classList.remove('hidden');
        showRankingBtn.classList.remove('hidden');
        adminBtn.classList.remove('hidden');
        
        // Story 버튼 표시
        const showStoryBtn = document.getElementById('show-story-btn');
        if (showStoryBtn) {
            showStoryBtn.classList.remove('hidden');
        }
        
        // 실시간 리스너 초기화
        initializeRealTimeListeners();
        initializeUserCharactersListener(user.uid);
        
        // 소설 시스템 초기화
        initializeStorySystem();
        
        showView('character-cards');
        await loadUserLuna(); // 루나 잔액 로드
        initializeLunaDisplay(); // 루나 디스플레이 초기화
    } else {
        // 로그아웃 시 실시간 리스너 정리
        cleanupRealTimeListeners();
        
        logoutBtn.classList.add('hidden');
        showRankingBtn.classList.add('hidden');
        adminBtn.classList.add('hidden');
        
        // Story 버튼 숨김
        const showStoryBtn = document.getElementById('show-story-btn');
        if (showStoryBtn) {
            showStoryBtn.classList.add('hidden');
        }
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
    
    // 중복 아이디 체크를 위해 이메일 생성 후 Firebase Auth로 확인
    const email = await createEmailFromId(id);
    if (!email) return;
    
    // Firebase Auth에서 이메일 중복 확인은 createUserWithEmailAndPassword에서 자동으로 처리됨
    // 별도의 중복 체크 없이 바로 계정 생성 시도
    if (!email) return;

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // 사용자 정보를 Firestore에 저장
        await setDoc(doc(db, 'users', user.uid), {
            userId: id,
            email: email,
            luna: 0, // 초기 루나 없음
            maxCharacterSlots: 4, // 기본 캐릭터 슬롯 수
            createdAt: new Date().toISOString()
        });
        
        alert('회원가입이 완료되었습니다!');
    } catch (error) {
        if (error.code === 'auth/email-already-in-use') {
            alert('이미 사용 중인 아이디입니다.');
        } else {
            alert(`회원가입 실패: ${error.code}`);
        }
    }
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
    
    // 캐릭터 개수 제한 확인
    try {
        const userQuery = query(collection(db, `users/${currentUser.uid}/characters`));
        const userSnapshot = await getDocs(userQuery);
        
        // 사용자의 최대 슬롯 수 확인
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        const maxSlots = userDoc.exists() ? (userDoc.data().maxCharacterSlots || 4) : 4;
        
        if (userSnapshot.size >= maxSlots) {
            alert(`캐릭터는 최대 ${maxSlots}개까지만 생성할 수 있습니다. 슬롯을 확장하려면 50루나가 필요합니다.`);
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
        - 스킬 설명은 각각 정확히 2문장으로 작성하되, 자연스럽고 적절한 길이로 작성하세요.
        - 스킬의 효과와 특징을 명확하고 흥미롭게 설명해주세요.
        - 예시: "상대방의 약점이나 감정의 동요를 읽어내어 심리적인 압박을 가하거나, 혼란을 야기하는 강력한 정신 공격 스킬입니다."

        
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

        // 3. Prepare character data for preview
        parsedData.wins = 0;
        parsedData.losses = 0;
        parsedData.owner = currentUser.uid;
        parsedData.createdBy = currentUser.uid;
        parsedData.userId = currentUser.uid; // 재생성 버튼에서 사용하는 필드
        parsedData.createdAt = new Date().toISOString();
        // 외형 프롬프트를 별도로 저장 (전투 이미지 생성에 활용)
        parsedData.appearance_prompt = parsedData.image_prompt;
        // 강화된 프롬프트도 저장 (이미지 재생성에 활용)
        const conceptKeywords = getConceptKeywords(charConcept);
        parsedData.enhanced_prompt = `${parsedData.image_prompt}, ${conceptKeywords}, fantasy character portrait, ${parsedData.class || 'fantasy character'}, high quality, detailed, digital art, concept art style, professional illustration, centered composition, dramatic lighting, vibrant colors, masterpiece quality, full body or portrait view`;
        
        // Firebase에 캐릭터 저장
        await saveCharacter(parsedData);
        updateProgress(100, `${parsedData.name} 생성 완료!`);
        
        // 폼 리셋 및 화면 전환
        document.getElementById('char-concept').value = '';
        document.getElementById('char-name').value = '';
        showView('character-cards');
        
        // UI 강제 업데이트 (실시간 리스너와 동기화)
        setTimeout(() => {
            if (userCharactersPool.length > 0) {
                displayUserCharacters(userCharactersPool);
            }
        }, 500);
        
        console.log(`${parsedData.name} 캐릭터 생성 및 저장 완료`);

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
    console.log('=== 이미지 생성 API 호출 시작 ===');
    console.log('프롬프트 길이:', prompt.length);
    console.log('프롬프트 내용 (처음 200자):', prompt.substring(0, 200) + '...');
    
    try {
        console.log('서버 API 요청 전송 중...');
        const response = await fetch('/api/generate-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: prompt
            })
        });
        
        console.log('서버 API 응답 상태:', response.status, response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('서버 API 오류 응답:', errorText);
            throw new Error(`Server API request failed with status ${response.status}: ${errorText}`);
        }

        console.log('서버 응답 데이터 수신 중...');
        const responseData = await response.json();
        console.log('서버 응답:', responseData);
        
        if (responseData.success && responseData.imageUrl) {
            console.log(`=== 이미지 생성 성공 ===`);
            console.log(`모델: ${responseData.model}`);
            return responseData.imageUrl;
        } else {
            console.log('이미지 생성 실패, 플레이스홀더 사용');
            if (responseData.message) {
                console.log('서버 메시지:', responseData.message);
            }
            return responseData.imageUrl || `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgNTEyIDUxMiI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2ZmNjY2NiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIj5JbWFnZSBFcnJvcjwvdGV4dD48L3N2Zz4=`;
        }

    } catch (error) {
        console.error("=== 이미지 생성 API 오류 ===");
        console.error('오류 타입:', error.name);
        console.error('오류 메시지:', error.message);
        console.error('전체 오류:', error);
        // 오류 시 플레이스홀더 이미지 반환
        return `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgNTEyIDUxMiI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iI2ZmNjY2NiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIj5JbWFnZSBFcnJvcjwvdGV4dD48L3N2Zz4=`;
    }
}

// 컨셉에 따른 키워드 생성 함수
function getConceptKeywords(characterConcept) {
    let conceptKeywords = '';
    const lowerConcept = characterConcept.toLowerCase();
    
    if (lowerConcept.includes('용') || lowerConcept.includes('dragon')) {
        conceptKeywords = 'dragon-themed character, draconic features, scales, wings, fire elements';
    } else if (lowerConcept.includes('마법사') || lowerConcept.includes('wizard') || lowerConcept.includes('mage')) {
        conceptKeywords = 'wizard character, magical robes, staff or wand, mystical aura, spell effects';
    } else if (lowerConcept.includes('전사') || lowerConcept.includes('warrior') || lowerConcept.includes('knight')) {
        conceptKeywords = 'warrior character, armor, sword and shield, heroic pose, battle-ready';
    }
    
    return conceptKeywords;
}



// ...
async function generateAndUploadImage(imagePrompt, characterName, characterClass, characterConcept) {
    console.log(`Generating image for ${characterName} with AI...`);
    
    // 컨셉에 따른 특별한 프롬프트 처리
    const conceptKeywords = getConceptKeywords(characterConcept);
    
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
        // 캐릭터 문서 생성
        const docRef = await addDoc(collection(db, `users/${currentUser.uid}/characters`), characterData);
        
        // 신규 캐릭터의 battleHistory 서브컬렉션 초기화 (기존 캐릭터와 동일한 구조 보장)
        const initialBattleRecord = {
            isInitialRecord: true,
            characterId: docRef.id,
            characterName: characterData.name,
            createdAt: new Date().toISOString(),
            note: "캐릭터 생성 시 초기화된 전투 기록 컬렉션"
        };
        
        // battleHistory 서브컬렉션에 초기 문서 추가
        await addDoc(collection(docRef, 'battleHistory'), initialBattleRecord);
        
        alert(`${characterData.name}이(가) 당신의 동료가 되었습니다!`);
        console.log('신규 캐릭터 생성 완료 - battleHistory 서브컬렉션 초기화됨:', docRef.id);
        
        // 실시간 리스너가 자동으로 UI를 업데이트하므로 추가 작업 불필요
    } catch (error) {
        console.error("캐릭터 저장 오류: ", error);
        throw new Error('캐릭터를 데이터베이스에 저장하는 데 실패했습니다.');
    }
}

// --- CHARACTER MANAGEMENT ---
// 실시간 데이터를 사용하는 새로운 함수 (기존 호환성 유지)
function loadUserCharacters(forceRefresh = false) {
    if (!currentUser) return;
    
    // 실시간 리스너가 이미 데이터를 관리하므로 즉시 표시
    console.log(`실시간 사용자 캐릭터 풀 사용: ${userCharactersPool.length}개 캐릭터`);
    displayUserCharacters(userCharactersPool);
    return Promise.resolve();
}

// 사용자 캐릭터 표시 함수 분리
async function displayUserCharacters(userCharacters) {
    characterCardsGrid.innerHTML = '';
    
    // 사용자의 최대 슬롯 수 확인
    let maxSlots = 4;
    if (currentUser) {
        try {
            const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
            if (userDoc.exists()) {
                maxSlots = userDoc.data().maxCharacterSlots || 4;
            }
        } catch (error) {
            console.error('사용자 슬롯 정보 로드 오류:', error);
        }
    }
    
    // 캐릭터 생성 카드 추가
    const createCard = document.createElement('div');
    createCard.className = 'create-character-card';
    
    // 캐릭터 개수가 최대 슬롯에 도달했는지 확인
    const isLimitReached = userCharacters.length >= maxSlots;
    
    if (isLimitReached) {
        createCard.classList.add('disabled');
        createCard.innerHTML = `
            <div class="create-card-content">
                <div class="create-icon disabled">✕</div>
                <h3>생성 제한 도달</h3>
                <p>캐릭터 생성 한도에 도달했습니다</p>
                <p class="create-limit">(${userCharacters.length}/${maxSlots}개)</p>
                <button class="expand-slot-btn" onclick="expandCharacterSlot()">
                    🌙 슬롯 확장 (50루나)
                </button>
            </div>
        `;
    } else {
        createCard.innerHTML = `
            <div class="create-card-content">
                <div class="create-icon">+</div>
                <h3>새로운 영웅 생성</h3>
                <p>새로운 모험을 시작하세요</p>
                <p class="create-limit">(${userCharacters.length}/${maxSlots}개)</p>
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
            <img src="${(character.imageUrl || 'https://placehold.co/512x512/EEE/31343C.png?text=No+Image') + (character.imageUrl && !character.imageUrl.startsWith('data:') ? '?t=' + new Date().getTime() : '')}" alt="${character.name}" class="character-image" onerror="this.src='https://placehold.co/512x512/EEE/31343C.png?text=Error'">
        </div>
        <div class="character-info">
            <h3 class="character-name">${character.name}</h3>
            <p class="character-class">${character.class || '클래스 정보 없음'}</p>
            <div class="character-stats">
                <span class="win-rate">${winRate}%</span>
                <span class="record"><span class="wins">${wins}승</span> <span class="losses">${losses}패</span></span>
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
        <img src="${(character.imageUrl || 'https://placehold.co/512x512/EEE/31343C.png?text=No+Image') + (character.imageUrl && !character.imageUrl.startsWith('data:') ? '?t=' + new Date().getTime() : '')}" alt="${character.name}" class="character-card-image" onerror="this.src='https://placehold.co/512x512/EEE/31343C.png?text=Error'">
        <h3>${character.name}</h3>
        <p class="character-class">${character.class || '클래스 정보 없음'}</p>
        <p class="character-personality"><strong>성격:</strong> ${character.personality || '정보 없음'}</p>
        <p class="character-story">${character.story || '스토리 정보 없음'}</p>
        <p class="character-record">전적: <span class="wins">${character.wins || 0}승</span> / <span class="losses">${character.losses || 0}패</span></p>
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

// 캐릭터 이미지 재생성 함수
window.regenerateCharacterImage = async function(characterId) {
    console.log('캐릭터 이미지 재생성 시작:', characterId);
    
    if (!currentUser) {
        alert('로그인이 필요합니다.');
        return;
    }
    
    const LUNA_COST = 30;
    
    try {
        // 현재 루나 잔액 확인
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
            alert('사용자 정보를 찾을 수 없습니다.');
            return;
        }
        
        const currentLuna = userDoc.data().luna || 0;
        
        if (currentLuna < LUNA_COST) {
            alert(`루나가 부족합니다. 필요: ${LUNA_COST} 루나, 보유: ${currentLuna} 루나`);
            return;
        }
        
        // 캐릭터 데이터 가져오기
        const characterRef = await findCharacterRef(characterId);
        if (!characterRef) {
            alert('캐릭터 정보를 찾을 수 없습니다.');
            return;
        }
        
        const characterSnap = await getDoc(characterRef);
        if (!characterSnap.exists()) {
            alert('캐릭터 정보를 찾을 수 없습니다.');
            return;
        }
        
        const characterData = characterSnap.data();
        
        // 소유권 확인 (fallback 로직 포함)
        let characterOwnerId = characterData.userId;
        if (!characterOwnerId) {
            // userId가 없는 경우, 캐릭터가 현재 사용자의 subcollection에 있는지 확인
            try {
                const userCharRef = doc(db, `users/${currentUser.uid}/characters`, characterId);
                const userCharSnap = await getDoc(userCharRef);
                if (userCharSnap.exists()) {
                    characterOwnerId = currentUser.uid;
                    console.log('userId가 없는 캐릭터이지만 현재 사용자의 subcollection에서 발견됨 (재생성)');
                }
            } catch (error) {
                console.log('사용자 subcollection 확인 중 오류 (재생성):', error);
            }
        }
        
        if (characterOwnerId !== currentUser.uid) {
            alert('자신의 캐릭터만 이미지를 재생성할 수 있습니다.');
            return;
        }
        
        // 사용자 확인
        const confirmMessage = `${LUNA_COST}루나를 소모하여 "${characterData.name}"의 이미지를 재생성하시겠습니까?`;
        if (!confirm(confirmMessage)) {
            return;
        }
        
        // 재생성 버튼 비활성화 및 로딩 표시
        const regenerateBtn = document.querySelector('.regenerate-image-btn');
        if (regenerateBtn) {
            regenerateBtn.disabled = true;
            regenerateBtn.innerHTML = '⏳';
        }
        
        // 루나 차감
        const success = await spendLuna(LUNA_COST);
        if (!success) {
            alert('루나 차감에 실패했습니다.');
            if (regenerateBtn) {
                regenerateBtn.disabled = false;
                regenerateBtn.innerHTML = '🔄';
            }
            return;
        }
        
        console.log('루나 차감 완료, 이미지 생성 시작');
        
        // 저장된 강화된 프롬프트 사용, 없으면 기본 프롬프트 생성
        let imagePrompt;
        if (characterData.enhanced_prompt) {
            imagePrompt = characterData.enhanced_prompt;
            console.log('저장된 강화된 프롬프트 사용:', imagePrompt.substring(0, 100) + '...');
        } else {
            // 기존 방식으로 프롬프트 생성 (하위 호환성)
            imagePrompt = `A detailed fantasy character portrait: ${characterData.appearance || characterData.story || characterData.name}. High quality, fantasy art style, detailed character design, professional digital art.`;
            console.log('기본 프롬프트 생성 (강화된 프롬프트 없음):', imagePrompt);
        }
        
        console.log('이미지 생성 프롬프트:', imagePrompt);
        
        // 이미지 생성 API 호출
        const response = await fetch('/api/generate-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: imagePrompt,
                characterName: characterData.name
            })
        });
        
        if (!response.ok) {
            throw new Error(`이미지 생성 실패: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success || !result.imageUrl) {
            throw new Error('이미지 생성 결과가 올바르지 않습니다.');
        }
        
        console.log('새 이미지 생성 완료:', result.imageUrl);
        
        // Firebase에 새 이미지 URL 업데이트
        await updateDoc(characterRef, {
            imageUrl: result.imageUrl,
            lastImageUpdate: new Date().toISOString()
        });
        
        console.log('Firebase 업데이트 완료');
        
        // 실시간 데이터는 자동으로 업데이트되므로 별도 캐시 업데이트 불필요
        console.log('=== 실시간 데이터 확인 ===');
        console.log('실시간 캐릭터 풀 길이:', allCharactersPool.length);
        console.log('대상 캐릭터 ID:', characterId);
        console.log('새 이미지 URL:', result.imageUrl);
        
        // UI 즉시 업데이트 (캐시 버스팅 적용) - 모든 이미지 요소 업데이트
        const timestamp = new Date().getTime();
        const cacheBustingUrl = result.imageUrl.startsWith('data:') ? result.imageUrl : result.imageUrl + '?t=' + timestamp;
        
        // 캐릭터 데이터 가져오기
        const targetCharacterData = allCharactersPool.find(c => c.id === characterId);
        if (!targetCharacterData) {
            console.error('캐릭터 데이터를 찾을 수 없습니다:', characterId);
            return;
        }
        
        // 현재 표시된 캐릭터 상세 페이지가 재생성된 캐릭터와 일치하는지 확인
        const currentDetailCharacter = document.querySelector('.character-detail-container');
        const currentCharacterName = detailCharacterName ? detailCharacterName.textContent : '';
        const isCurrentCharacterDetail = currentDetailCharacter && 
            (currentCharacterName === targetCharacterData.name || 
             document.querySelector(`[onclick*="${characterId}"]`));
        
        console.log('=== 이미지 업데이트 디버깅 ===');
        console.log('현재 상세 페이지 캐릭터명:', currentCharacterName);
        console.log('재생성된 캐릭터명:', targetCharacterData.name);
        console.log('상세 페이지 일치 여부:', isCurrentCharacterDetail);
        
        // 캐릭터 상세 페이지의 이미지 업데이트 (현재 표시된 캐릭터가 재생성된 캐릭터인 경우에만)
        if (isCurrentCharacterDetail) {
            const characterImages = document.querySelectorAll('.character-image-container img');
            console.log('상세 페이지 이미지 요소들:', characterImages);
            characterImages.forEach(img => {
                // alt 속성으로 캐릭터 확인 후 업데이트 (정확히 일치하는 경우만)
                console.log('이미지 alt 속성:', img.alt, '비교 대상:', targetCharacterData.name);
                if (img.alt === targetCharacterData.name) {
                    img.src = cacheBustingUrl;
                    console.log('상세 페이지 이미지 요소 업데이트:', img, cacheBustingUrl);
                } else {
                    console.log('이미지 alt가 일치하지 않아 업데이트 건너뜀:', img.alt);
                }
            });
        }
        
        // 중복된 캐시 업데이트 코드 제거됨 (위에서 이미 처리됨)
        
        // 캐릭터 카드의 이미지도 업데이트 (data-character-id로 정확한 캐릭터만)
        const cardImages = document.querySelectorAll(`[data-character-id="${characterId}"] img`);
        console.log('=== 캐릭터 카드 이미지 업데이트 ===');
        console.log('찾은 카드 이미지 요소들:', cardImages);
        console.log('검색한 셀렉터:', `[data-character-id="${characterId}"] img`);
        cardImages.forEach(img => {
            img.src = cacheBustingUrl;
            console.log('카드 이미지 요소 업데이트:', img, cacheBustingUrl);
        });
        
        // 메인 캐릭터 목록에서 해당 캐릭터 이미지 업데이트
        const mainCharacterImages = document.querySelectorAll('.character-image');
        console.log('=== 메인 캐릭터 목록 이미지 업데이트 ===');
        console.log('찾은 메인 이미지 요소들:', mainCharacterImages);
        console.log('대상 캐릭터명:', targetCharacterData.name);
        mainCharacterImages.forEach(img => {
            console.log('이미지 alt 속성 확인:', img.alt, '비교 대상:', targetCharacterData.name);
            if (img.alt === targetCharacterData.name) {
                img.src = cacheBustingUrl;
                console.log('메인 목록 이미지 요소 업데이트:', img, cacheBustingUrl);
            } else {
                console.log('alt 속성이 일치하지 않아 업데이트 건너뜀:', img.alt);
            }
        });
        
        console.log('모든 이미지 UI 업데이트 완료:', cacheBustingUrl);
        
        // 강제로 이미지 새로고침 (업데이트된 이미지들만)
        setTimeout(() => {
            const allUpdatedImages = [
                ...document.querySelectorAll(`[data-character-id="${characterId}"] img`),
                ...Array.from(document.querySelectorAll('.character-image')).filter(img => img.alt === targetCharacterData.name)
            ];
            if (isCurrentCharacterDetail) {
                // 상세 페이지에서도 정확한 캐릭터만 추가
                const detailImages = Array.from(document.querySelectorAll('.character-image-container img'))
                    .filter(img => img.alt === targetCharacterData.name);
                allUpdatedImages.push(...detailImages);
            }
            
            console.log('강제 새로고침 대상 이미지들:', allUpdatedImages);
            allUpdatedImages.forEach(img => {
                img.style.display = 'none';
                img.offsetHeight; // 강제 리플로우
                img.style.display = '';
            });
        }, 100);
        
        // 재생성 버튼 복원
        if (regenerateBtn) {
            regenerateBtn.disabled = false;
            regenerateBtn.innerHTML = '🔄';
        }
        
        alert('이미지가 성공적으로 재생성되었습니다!');
        
        console.log('이미지 재생성 완료');
        
    } catch (error) {
        console.error('이미지 재생성 오류:', error);
        alert('이미지 재생성 중 오류가 발생했습니다: ' + error.message);
        
        // 재생성 버튼 복원
        const regenerateBtn = document.querySelector('.regenerate-image-btn');
        if (regenerateBtn) {
            regenerateBtn.disabled = false;
            regenerateBtn.innerHTML = '🔄';
        }
    }
}

// 캐릭터 상세 정보 표시
async function showCharacterDetail(character) {
    console.log('showCharacterDetail 호출됨, 캐릭터 ID:', character.id);
    
    // 페이지 상단으로 스크롤
    window.scrollTo(0, 0);
    
    // 실시간 데이터에서 최신 캐릭터 데이터 가져오기
    const latestCharacter = allCharactersPool.find(c => c.id === character.id) || character;
    console.log('실시간 풀에서 최신 캐릭터 데이터 가져옴:', latestCharacter.name);
    console.log('캐릭터 소유자 ID:', latestCharacter.userId);
    
    detailCharacterName.textContent = latestCharacter.name;
    
    const wins = latestCharacter.wins || 0;
    const losses = latestCharacter.losses || 0;
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
        const rank = sortedCharacters.findIndex(c => c.id === latestCharacter.id) + 1;
        characterRank = rank > 0 ? `${rank}위 / ${sortedCharacters.length}명` : '순위 없음';
    } catch (error) {
        console.error('순위 계산 오류:', error);
        characterRank = '순위 계산 실패';
    }
    
    // 최근 전투 기록 가져오기
    const recentBattles = await getRecentBattles(latestCharacter.id);
    
    // userId가 없는 기존 캐릭터를 위한 fallback 로직
    let characterOwnerId = latestCharacter.userId;
    if (!characterOwnerId) {
        // userId가 없는 경우, 캐릭터가 현재 사용자의 subcollection에 있는지 확인
        try {
            const userCharRef = doc(db, `users/${currentUser.uid}/characters`, character.id);
            const userCharSnap = await getDoc(userCharRef);
            if (userCharSnap.exists()) {
                characterOwnerId = currentUser.uid;
                console.log('userId가 없는 캐릭터이지만 현재 사용자의 subcollection에서 발견됨');
            }
        } catch (error) {
            console.log('사용자 subcollection 확인 중 오류:', error);
        }
    }
    
    // 디버깅 정보 출력
    console.log('=== 재생성 버튼 표시 조건 확인 ===');
    console.log('캐릭터 소유자 ID (원본):', latestCharacter.userId);
    console.log('캐릭터 소유자 ID (fallback 적용):', characterOwnerId);
    console.log('현재 사용자 ID:', currentUser?.uid);
    console.log('현재 사용자 객체:', currentUser);
    console.log('소유권 일치 여부:', characterOwnerId === currentUser?.uid);
    
    characterDetailContent.innerHTML = `
        <div class="character-detail-container">
            <!-- 캐릭터 이미지 섹션 -->
            <div class="character-detail-header">
                <div class="character-image-section">
                    <div class="character-image-container" onclick="openImageModal('${latestCharacter.imageUrl || 'https://placehold.co/512x512/EEE/31343C.png?text=No+Image'}', '${latestCharacter.name}')">
                        <img src="${(latestCharacter.imageUrl || 'https://placehold.co/512x512/EEE/31343C.png?text=No+Image') + (latestCharacter.imageUrl && !latestCharacter.imageUrl.startsWith('data:') ? '?t=' + new Date().getTime() : '')}" alt="${latestCharacter.name}" onerror="this.src='https://placehold.co/512x512/EEE/31343C.png?text=Error'">
                    </div>
                    <!-- 재생성 버튼 완전히 제거됨 -->
                </div>
                <div class="character-basic-info">
                    <h2>${latestCharacter.name}</h2>
                    <div class="character-class">${latestCharacter.class || '정보 없음'}</div>
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
                        ${latestCharacter.story || '스토리 정보가 없습니다.'}
                    </div>
                </div>
                
                <!-- 스킬 탭 -->
                <div id="skills-tab" class="tab-panel">
                    <div class="skills-section">
                        <div class="skills-category">
                            <div class="skills-category-header">
                                <h4>⚔️ 공격 스킬</h4>
                                <button class="add-skill-btn" onclick="addNewSkill('${latestCharacter.id}', 'attack')" title="새로운 공격 스킬 추가 (100루나)">➕</button>
                            </div>
                            <div class="skills-list">
                                ${latestCharacter.attack_skills && latestCharacter.attack_skills.length > 0 ? 
                                    latestCharacter.attack_skills.map((skill, index) => 
                                        `<div class="skill-card attack-skill">
                                            <div class="skill-icon">⚔️</div>
                                            <div class="skill-info">
                                                <div class="skill-name">${skill.name || skill.skill_name}</div>
                                                <div class="skill-description">${skill.description || skill.skill_description}</div>
                                            </div>
                                            <button class="upgrade-skill-btn" onclick="upgradeSkill('${latestCharacter.id}', 'attack', ${index})" title="스킬 업그레이드 (50루나)">⬆️</button>
                                        </div>`
                                    ).join('') : 
                                    '<div class="no-skills">공격 스킬이 없습니다.</div>'}
                            </div>
                        </div>
                        
                        <div class="skills-category">
                            <div class="skills-category-header">
                                <h4>🛡️ 방어 스킬</h4>
                                <button class="add-skill-btn" onclick="addNewSkill('${latestCharacter.id}', 'defense')" title="새로운 방어 스킬 추가 (100루나)">➕</button>
                            </div>
                            <div class="skills-list">
                                ${latestCharacter.defense_skills && latestCharacter.defense_skills.length > 0 ? 
                                    latestCharacter.defense_skills.map((skill, index) => 
                                        `<div class="skill-card defense-skill">
                                            <div class="skill-icon">🛡️</div>
                                            <div class="skill-info">
                                                <div class="skill-name">${skill.name || skill.skill_name}</div>
                                                <div class="skill-description">${skill.description || skill.skill_description}</div>
                                            </div>
                                            <button class="upgrade-skill-btn" onclick="upgradeSkill('${latestCharacter.id}', 'defense', ${index})" title="스킬 업그레이드 (50루나)">⬆️</button>
                                        </div>`
                                    ).join('') : 
                                    '<div class="no-skills">방어 스킬이 없습니다.</div>'}
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- 탄생 스토리 탭 -->
                <div id="origin-tab" class="tab-panel">
                    <div class="origin-story-content">
                        ${latestCharacter.origin_story || '이 캐릭터는 신비로운 힘에 의해 탄생했습니다. 그들의 기원은 고대의 전설 속에 숨겨져 있으며, 시간이 흐르면서 그 진실이 밝혀질 것입니다.'}
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
                <button class="action-btn battle-btn" onclick="startBattleFromDetail('${latestCharacter.id}')">
                    ⚔️ 전투 시작
                </button>
                <button class="action-btn designated-match-btn" onclick="showDesignatedMatchModal('${latestCharacter.id}')">
                    🎯 지정매칭
                </button>
                <button class="action-btn delete-btn" onclick="deleteCharacterFromDetail('${latestCharacter.id}', '${latestCharacter.name}')">
                    🗑️ 삭제
                </button>
            </div>
        </div>
    `;
    
    showView('character-detail');
}

// 상세 화면에서 전투 시작 - 매칭 화면으로 이동 (최적화됨)
async function startBattleFromDetail(characterId) {
    console.log('🚀 startBattleFromDetail 호출됨 (최적화), characterId:', characterId);
    console.log('현재 실시간 캐릭터 풀 길이:', allCharactersPool.length);
    
    let character = allCharactersPool.find(c => c.id === characterId) || null;
    
    // 실시간 풀에서 캐릭터를 찾을 수 없는 경우
    if (!character || allCharactersPool.length === 0) {
        console.log('실시간 풀에서 캐릭터를 찾을 수 없음');
        character = allCharactersPool.find(c => c.id === characterId);
    }
    
    if (character) {
        console.log('캐릭터 찾음:', character.name);
        
        // 플레이어 캐릭터의 최신 데이터를 캐시 우선으로 가져오기
        try {
            console.log('💾 플레이어 캐릭터 캐시 확인 중:', character.name);
            let cachedPlayer = getCachedCharacter(character.id);
            
            if (cachedPlayer) {
                console.log('✅ 캐시에서 플레이어 데이터 사용:', cachedPlayer.name);
                playerCharacterForBattle = cachedPlayer;
            } else {
                console.log('🔄 캐시 없음, Firebase에서 플레이어 데이터 가져오는 중');
                const playerRef = await findCharacterRef(character.id);
                if (playerRef) {
                    const playerDoc = await getDoc(playerRef);
                    if (playerDoc.exists()) {
                        const latestPlayerData = { id: playerDoc.id, ...playerDoc.data() };
                        setCachedCharacter(character.id, latestPlayerData); // 캐시에 저장
                        playerCharacterForBattle = latestPlayerData;
                        console.log('✅ Firebase에서 플레이어 데이터 로드 및 캐시 저장:', latestPlayerData.name);
                    } else {
                        console.log('플레이어 문서가 존재하지 않음, 실시간 풀 데이터 사용');
                        playerCharacterForBattle = character;
                    }
                } else {
                    console.log('플레이어 참조를 찾을 수 없음, 실시간 풀 데이터 사용');
                    playerCharacterForBattle = character;
                }
            }
            
            console.log('플레이어 공격 스킬 수:', playerCharacterForBattle.attack_skills?.length || 0);
            console.log('플레이어 방어 스킬 수:', playerCharacterForBattle.defense_skills?.length || 0);
        } catch (error) {
            console.error('플레이어 최신 데이터 가져오기 실패:', error);
            console.log('실시간 풀 데이터로 대체');
            playerCharacterForBattle = character;
        }
        
        // 상대방 찾기 - 자신의 캐릭터와 같은 사용자의 캐릭터 제외 (최적화됨)
        if (allCharactersPool.length > 1) {
            const availableOpponents = allCharactersPool.filter(c => 
                c.id !== character.id && c.userId !== currentUser.uid
            );
            
            if (availableOpponents.length === 0) {
                alert('매칭 가능한 다른 사용자의 캐릭터가 없습니다.');
                return;
            }
            
            const randomOpponent = availableOpponents[Math.floor(Math.random() * availableOpponents.length)];
            
            // 상대방의 최신 데이터를 캐시 우선으로 가져오기
            try {
                console.log('💾 상대방 캐릭터 캐시 확인 중:', randomOpponent.name);
                let cachedOpponent = getCachedCharacter(randomOpponent.id);
                
                if (cachedOpponent) {
                    console.log('✅ 캐시에서 상대방 데이터 사용:', cachedOpponent.name || 'Unknown');
                    opponentCharacterForBattle = cachedOpponent;
                } else {
                    console.log('🔄 캐시 없음, Firebase에서 상대방 데이터 가져오는 중');
                    const opponentRef = await findCharacterRef(randomOpponent.id);
                    if (opponentRef) {
                        const opponentDoc = await getDoc(opponentRef);
                        if (opponentDoc.exists()) {
                            const latestOpponentData = { id: opponentDoc.id, ...opponentDoc.data() };
                            setCachedCharacter(randomOpponent.id, latestOpponentData); // 캐시에 저장
                            opponentCharacterForBattle = latestOpponentData;
                            console.log('✅ Firebase에서 상대방 데이터 로드 및 캐시 저장:', latestOpponentData.name);
                        } else {
                            console.log('상대방 문서가 존재하지 않음, 실시간 풀 데이터 사용');
                            opponentCharacterForBattle = randomOpponent;
                        }
                    } else {
                        console.log('상대방 참조를 찾을 수 없음, 실시간 풀 데이터 사용');
                        opponentCharacterForBattle = randomOpponent;
                    }
                }
                
                console.log('상대방 공격 스킬 수:', opponentCharacterForBattle.attack_skills?.length || 0);
                console.log('상대방 방어 스킬 수:', opponentCharacterForBattle.defense_skills?.length || 0);
            } catch (error) {
                console.error('상대방 최신 데이터 가져오기 실패:', error);
                console.log('실시간 풀 데이터로 대체');
                opponentCharacterForBattle = randomOpponent;
            }
            
            console.log('🎯 상대방 선택됨:', opponentCharacterForBattle.name);
            
            // 매칭 화면으로 이동
            showView('matching');
            showMatchingScreen();
            // 페이지 상단으로 스크롤
            window.scrollTo(0, 0);
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
    // 스킬 선택 초기화 (최근 사용 스킬 자동 선택을 위해 generateSkillSelectionHTML에서 처리)
    selectedSkills = [];
    // 페이지 상단으로 스크롤
    window.scrollTo(0, 0);
    
    // opponentCharacterForBattle이 없는 경우 처리
    if (!opponentCharacterForBattle) {
        console.error('매칭된 상대방 정보가 없습니다.');
        matchingContent.innerHTML = `
            <div class="matching-container">
                <div class="error-message">
                    <h3>⚠️ 매칭 오류</h3>
                    <p>상대방 정보를 불러올 수 없습니다.</p>
                    <button onclick="showView('character-cards')" class="back-btn">돌아가기</button>
                </div>
            </div>
        `;
        return;
    }
    
    matchingContent.innerHTML = `
        <div class="matching-container">
            <!-- 상대방 캐릭터 정보 -->
            <div class="opponent-info-section">
                <h3>매칭된 상대</h3>
                <div class="opponent-card" onclick="showOpponentDetails()">
                    <img src="${opponentCharacterForBattle.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" 
                         alt="${opponentCharacterForBattle.name || 'Unknown'}" class="opponent-image">
                    <div class="opponent-info">
                        <h4>${opponentCharacterForBattle.name || 'Unknown Character'}</h4>
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
        
        // 스킬 선택 아이템 전체에 클릭 이벤트 리스너 추가 (모바일 드래그 방지 포함)
        const skillItems = document.querySelectorAll('.skill-selection-item');
        skillItems.forEach((item, index) => {
            console.log(`스킬 아이템 ${index} 클릭 이벤트 리스너 추가:`, item);
            
            let touchStartTime = 0;
            let touchStartX = 0;
            let touchStartY = 0;
            let isDragging = false;
            
            // 터치 시작 이벤트
            item.addEventListener('touchstart', function(event) {
                touchStartTime = Date.now();
                const touch = event.touches[0];
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
                isDragging = false;
            }, { passive: true });
            
            // 터치 이동 이벤트
            item.addEventListener('touchmove', function(event) {
                const touch = event.touches[0];
                const deltaX = Math.abs(touch.clientX - touchStartX);
                const deltaY = Math.abs(touch.clientY - touchStartY);
                
                // 10px 이상 이동하면 드래그로 간주
                if (deltaX > 10 || deltaY > 10) {
                    isDragging = true;
                }
            }, { passive: true });
            
            // 터치 종료 이벤트
            item.addEventListener('touchend', function(event) {
                const touchDuration = Date.now() - touchStartTime;
                
                // 드래그가 아니고, 터치 시간이 500ms 미만인 경우만 클릭으로 처리
                if (!isDragging && touchDuration < 500) {
                    event.preventDefault(); // 기본 클릭 이벤트 방지
                    handleSkillItemClick(event, item);
                }
            });
            
            // 일반 클릭 이벤트 (데스크톱용)
            item.addEventListener('click', function(event) {
                // 터치 이벤트가 있는 경우 클릭 이벤트 무시
                if (event.type === 'click' && 'ontouchstart' in window) {
                    return;
                }
                handleSkillItemClick(event, item);
            });
        });
        
        // 스킬 아이템 클릭 처리 함수
        function handleSkillItemClick(event, item) {
            // 체크박스나 라벨을 직접 클릭한 경우는 중복 처리 방지
            if (event.target.classList.contains('skill-checkbox') || 
                event.target.classList.contains('skill-checkbox-label') ||
                event.target.classList.contains('checkbox-custom')) {
                return;
            }
            
            // 해당 아이템 내의 체크박스 찾기
            const checkbox = item.querySelector('.skill-checkbox');
            if (checkbox) {
                // 체크박스 상태 토글
                checkbox.checked = !checkbox.checked;
                // change 이벤트 발생시켜서 기존 핸들러 호출
                checkbox.dispatchEvent(new Event('change'));
            }
        }
        
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
    
    // 최근 사용 스킬 자동 선택을 위한 준비
    const lastUsedSkills = playerCharacterForBattle.lastUsedSkills || [];
    const shouldAutoSelect = lastUsedSkills.length > 0;
    
    console.log('최근 사용 스킬:', lastUsedSkills);
    console.log('자동 선택 여부:', shouldAutoSelect);
    
    // 공격 스킬
    if (playerCharacterForBattle.attack_skills && playerCharacterForBattle.attack_skills.length > 0) {
        playerCharacterForBattle.attack_skills.forEach((skill, index) => {
            // 최근 사용 스킬과 일치하는지 확인
            const isLastUsed = shouldAutoSelect && lastUsedSkills.some(lastSkill => 
                (lastSkill.name || lastSkill.skill_name) === (skill.name || skill.skill_name)
            );
            const checkedAttr = isLastUsed ? 'checked' : '';
            const selectedClass = isLastUsed ? 'selected' : '';
            
            // 자동 선택된 스킬을 selectedSkills 배열에 추가
            if (isLastUsed && !selectedSkills.some(s => (s.name || s.skill_name) === (skill.name || skill.skill_name))) {
                selectedSkills.push(skill);
            }
            
            skillsHTML += `
                <div class="skill-selection-item ${selectedClass}">
                    <div class="skill-checkbox-container">
                        <input type="checkbox" id="matching-attack-skill-${index}" class="skill-checkbox" data-skill='${JSON.stringify(skill).replace(/'/g, "&apos;")}' data-skill-type="attack" ${checkedAttr}>
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
            // 최근 사용 스킬과 일치하는지 확인
            const isLastUsed = shouldAutoSelect && lastUsedSkills.some(lastSkill => 
                (lastSkill.name || lastSkill.skill_name) === (skill.name || skill.skill_name)
            );
            const checkedAttr = isLastUsed ? 'checked' : '';
            const selectedClass = isLastUsed ? 'selected' : '';
            
            // 자동 선택된 스킬을 selectedSkills 배열에 추가
            if (isLastUsed && !selectedSkills.some(s => (s.name || s.skill_name) === (skill.name || skill.skill_name))) {
                selectedSkills.push(skill);
            }
            
            skillsHTML += `
                <div class="skill-selection-item ${selectedClass}">
                    <div class="skill-checkbox-container">
                        <input type="checkbox" id="matching-defense-skill-${index}" class="skill-checkbox" data-skill='${JSON.stringify(skill).replace(/'/g, "&apos;")}' data-skill-type="defense" ${checkedAttr}>
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
    
    // 페이지 상단으로 스크롤
    window.scrollTo(0, 0);
    
    // 돌아가기 버튼 제거됨
    
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
                // 실시간 리스너가 자동으로 UI를 업데이트하므로 별도 처리 불필요
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
        await showOpponentModal(opponentData, opponentBattles);
        console.log('모달 표시 완료');
        
    } catch (error) {
        console.error('상대방 캐릭터 정보 로드 오류:', error);
        alert('상대방 캐릭터 정보를 불러오는 중 오류가 발생했습니다.');
    }
}

// 상대방 캐릭터 정보 모달 표시
async function showOpponentModal(character, battles) {
    console.log('showOpponentModal 호출됨, 캐릭터 데이터:', character);
    console.log('origin_story 값:', character.origin_story);
    console.log('story 값:', character.story);
    
    // 페이지 상단으로 스크롤
    window.scrollTo(0, 0);
    
    // Firebase에서 최신 캐릭터 데이터 가져오기
    let latestCharacter = character;
    try {
        const characterRef = doc(db, 'characters', character.id);
        const characterSnap = await getDoc(characterRef);
        if (characterSnap.exists()) {
            latestCharacter = { id: characterSnap.id, ...characterSnap.data() };
            console.log('Firebase에서 최신 캐릭터 데이터 가져옴:', latestCharacter.name);
        } else {
            console.log('Firebase에서 캐릭터를 찾을 수 없음, 캐시된 데이터 사용');
        }
    } catch (error) {
        console.error('Firebase에서 캐릭터 데이터 가져오기 실패:', error);
        console.log('캐시된 데이터 사용');
    }
    
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
                    <img src="${latestCharacter.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?'}" 
                         alt="${latestCharacter.name}" 
                         class="character-image-clickable">
                </div>
                <div class="opponent-basic-info">
                    <h2>${latestCharacter.name}</h2>
                    <p class="opponent-class">${latestCharacter.class || '정보 없음'}</p>
                </div>
                <div class="opponent-stats-grid">
                    <div class="opponent-stat-card">
                        <div class="opponent-stat-label">승리</div>
                        <div class="opponent-stat-value"><span class="wins">${latestCharacter.wins || 0}</span></div>
                    </div>
                    <div class="opponent-stat-card">
                        <div class="opponent-stat-label">패배</div>
                        <div class="opponent-stat-value"><span class="losses">${latestCharacter.losses || 0}</span></div>
                    </div>
                    <div class="opponent-stat-card">
                        <div class="opponent-stat-label">승률</div>
                        <div class="opponent-stat-value">${calculateWinRate(latestCharacter)}%</div>
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
                        ${latestCharacter.attack_skills && latestCharacter.attack_skills.length > 0 ? 
                            latestCharacter.attack_skills.map(skill => 
                                `<div class="opponent-skill-card attack-skill">
                                    <div class="opponent-skill-icon">⚔️</div>
                                    <div class="opponent-skill-info">
                                        <div class="opponent-skill-name">${skill.name || skill.skill_name}</div>
                                        <div class="opponent-skill-description">${skill.description || skill.skill_description}</div>
                                    </div>
                                </div>`
                            ).join('') : ''
                        }
                        ${latestCharacter.defense_skills && latestCharacter.defense_skills.length > 0 ? 
                            latestCharacter.defense_skills.map(skill => 
                                `<div class="opponent-skill-card defense-skill">
                                    <div class="opponent-skill-icon">🛡️</div>
                                    <div class="opponent-skill-info">
                                        <div class="opponent-skill-name">${skill.name || skill.skill_name}</div>
                                        <div class="opponent-skill-description">${skill.description || skill.skill_description}</div>
                                    </div>
                                </div>`
                            ).join('') : ''
                        }
                        ${(!latestCharacter.attack_skills || latestCharacter.attack_skills.length === 0) && 
                          (!latestCharacter.defense_skills || latestCharacter.defense_skills.length === 0) ? 
                            '<div class="no-skills">표시할 스킬이 없습니다.</div>' : ''
                        }
                    </div>
                </div>
                
                <!-- 배경 스토리 탭 -->
                <div id="opponent-story-tab" class="opponent-tab-panel">
                    <div class="opponent-story-content">
                        ${latestCharacter.origin_story || latestCharacter.story || latestCharacter.background || latestCharacter.description || '이 캐릭터는 신비로운 힘에 의해 탄생했습니다. 그들의 과거는 베일에 싸여 있지만, 강력한 힘과 의지를 가지고 있습니다.'}
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
        openImageModal(latestCharacter.imageUrl || 'https://placehold.co/200x200/333/FFF?text=?', latestCharacter.name);
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
function getAllCharactersForRanking() {
    // 실시간 데이터 사용 (Firebase 읽기 없음)
    console.log(`실시간 캐릭터 풀에서 랭킹용 데이터 반환: ${allCharactersPool.length}개 캐릭터`);
    return Promise.resolve(allCharactersPool);
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
            // 초기화 기록은 제외 (실제 전투 기록만 표시)
            if (data.isInitialRecord) {
                return;
            }
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
            // 실시간 리스너가 자동으로 UI를 업데이트하므로 추가 작업 불필요
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

    // 플레이어 캐릭터에 userId 정보 추가
    playerCharacterForBattle = { ...character, userId: currentUser.uid };
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
// 실시간 데이터를 사용하는 새로운 함수 (기존 호환성 유지)
function fetchAllCharacters(forceRefresh = false) {
    // 실시간 리스너가 이미 데이터를 관리하므로 즉시 반환
    console.log(`실시간 캐릭터 풀 사용: ${allCharactersPool.length}개 캐릭터`);
    return Promise.resolve();
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

// 상대방 선택 페이지네이션 변수
let currentOpponentPage = 1;
const OPPONENTS_PER_PAGE = 6;
let availableOpponents = [];

if (findOpponentBtn) {
    findOpponentBtn.addEventListener('click', () => {
        findOpponentBtn.disabled = true;
        opponentBattleCard.innerHTML = '<p>상대를 찾는 중...</p>';
        const battleGuideText = document.getElementById('battle-guide-text');

        try {
            // 실시간 데이터에서 상대 찾기 (Firebase 읽기 없음)
            availableOpponents = allCharactersPool.filter(char => char.userId !== currentUser.uid);

            if (availableOpponents.length === 0) {
                opponentBattleCard.innerHTML = '<p>싸울 상대가 아직 없습니다. 다른 유저가 캐릭터를 만들 때까지 기다려주세요.</p>';
                if (battleGuideText) {
                    battleGuideText.textContent = '현재 대결 가능한 상대가 없습니다.';
                }
                findOpponentBtn.disabled = false;
                return;
            }

            console.log(`총 ${availableOpponents.length}명의 상대 발견`);

            // 상대방 선택 화면 표시
            showOpponentSelectionScreen();

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
    const battleLog = document.getElementById('battle-log');
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
    
    // 상대방 선택 화면 제거
    const selectionScreen = document.getElementById('opponent-selection-screen');
    if (selectionScreen) {
        selectionScreen.remove();
    }
}

// 상대방 목록을 페이지네이션으로 표시
function displayOpponentsWithPagination() {
    const opponentsGrid = document.getElementById('opponents-grid');
    const paginationContainer = document.getElementById('opponent-pagination');
    
    if (!opponentsGrid || !paginationContainer) return;
    
    const totalPages = Math.ceil(availableOpponents.length / OPPONENTS_PER_PAGE);
    const startIndex = (currentOpponentPage - 1) * OPPONENTS_PER_PAGE;
    const endIndex = startIndex + OPPONENTS_PER_PAGE;
    const currentOpponents = availableOpponents.slice(startIndex, endIndex);
    
    // 상대방 카드들 표시
    opponentsGrid.innerHTML = '';
    currentOpponents.forEach(opponent => {
        const opponentCard = document.createElement('div');
        opponentCard.className = 'opponent-selection-card';
        opponentCard.onclick = () => selectOpponent(opponent);
        
        // 승률 계산
        const totalBattles = (opponent.wins || 0) + (opponent.losses || 0);
        const winRate = totalBattles > 0 ? Math.round((opponent.wins || 0) / totalBattles * 100) : 0;
        
        opponentCard.innerHTML = `
            <img src="${opponent.imageUrl || 'https://placehold.co/150x150/333/FFF?text=?'}" 
                 alt="${opponent.name}" class="opponent-card-image">
            <div class="opponent-card-info">
                <h4>${opponent.name}</h4>
                <p class="opponent-card-class">${opponent.class}</p>
                <p class="opponent-card-stats">승률: ${winRate}% (<span class="wins">${opponent.wins || 0}승</span> <span class="losses">${opponent.losses || 0}패</span>)</p>
            </div>
        `;
        
        opponentsGrid.appendChild(opponentCard);
    });
    
    // 페이지네이션 컨트롤 표시
    if (totalPages > 1) {
        paginationContainer.innerHTML = `
            <div class="opponent-pagination-info">
                ${startIndex + 1}-${Math.min(endIndex, availableOpponents.length)} / ${availableOpponents.length}명
            </div>
            <div class="opponent-pagination-controls">
                <button class="opponent-page-btn" ${currentOpponentPage === 1 ? 'disabled' : ''} 
                        onclick="changeOpponentPage(${currentOpponentPage - 1})">
                    이전
                </button>
                <div class="opponent-page-numbers">
                    ${generateOpponentPageNumbers(currentOpponentPage, totalPages)}
                </div>
                <button class="opponent-page-btn" ${currentOpponentPage === totalPages ? 'disabled' : ''} 
                        onclick="changeOpponentPage(${currentOpponentPage + 1})">
                    다음
                </button>
            </div>
        `;
    } else {
        paginationContainer.innerHTML = `
            <div class="opponent-pagination-info">
                총 ${availableOpponents.length}명
            </div>
        `;
    }
}

// 상대방 페이지 번호 생성
function generateOpponentPageNumbers(currentPage, totalPages) {
    let pageNumbers = '';
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
        pageNumbers += `
            <button class="opponent-page-number ${i === currentPage ? 'active' : ''}" 
                    onclick="changeOpponentPage(${i})">
                ${i}
            </button>
        `;
    }
    
    return pageNumbers;
}

// 상대방 페이지 변경
function changeOpponentPage(page) {
    const totalPages = Math.ceil(availableOpponents.length / OPPONENTS_PER_PAGE);
    if (page >= 1 && page <= totalPages) {
        currentOpponentPage = page;
        displayOpponentsWithPagination();
    }
}

// 상대방 선택
function selectOpponent(opponent) {
    opponentCharacterForBattle = opponent;
    console.log(`상대 선택: ${opponent.name}`);
    
    // 상대방 선택 화면 제거
    const selectionScreen = document.getElementById('opponent-selection-screen');
    if (selectionScreen) {
        selectionScreen.remove();
    }
    
    // 매칭된 상대방 화면으로 전환
    showMatchedOpponentScreen();
}

// 랜덤 상대 선택
function selectRandomOpponent() {
    if (availableOpponents.length === 0) return;
    
    const randomIndex = Math.floor(Math.random() * availableOpponents.length);
    const randomOpponent = availableOpponents[randomIndex];
    selectOpponent(randomOpponent);
}

// 상대방 선택에서 아레나로 돌아가기
function backToArenaFromSelection() {
    // 상대방 선택 화면 제거
    const selectionScreen = document.getElementById('opponent-selection-screen');
    if (selectionScreen) {
        selectionScreen.remove();
    }
    
    // 기존 UI 복원
    const battleArenaContainer = document.getElementById('battle-arena-container');
    const battleControls = document.getElementById('battle-controls');
    
    if (battleArenaContainer) battleArenaContainer.classList.remove('hidden');
    if (battleControls) battleControls.classList.remove('hidden');
    
    // 상대 찾기 버튼 활성화
    if (findOpponentBtn) findOpponentBtn.disabled = false;
    
    // 가이드 텍스트 복원
    const battleGuideText = document.getElementById('battle-guide-text');
    if (battleGuideText) {
        battleGuideText.textContent = '내 캐릭터 목록에서 전투에 내보낼 캐릭터를 선택하세요.';
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
    
    // 상대방 선택 화면도 제거
    const selectionScreen = document.getElementById('opponent-selection-screen');
    if (selectionScreen) {
        selectionScreen.remove();
    }
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
        // 새로운 상대 찾기 (자기 자신과 같은 사용자의 캐릭터 제외)
        const newOpponent = await findRandomOpponent();
        
        if (!newOpponent) {
            console.log('새로운 상대를 찾을 수 없어서 아레나로 돌아갑니다.');
            alert('다른 사용자의 캐릭터를 찾을 수 없습니다.');
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
// 상대방 선택 화면 표시
function showOpponentSelectionScreen() {
    // 페이지 상단으로 스크롤
    window.scrollTo(0, 0);
    
    // 기존 전투 UI 숨기기
    const battleArenaContainer = document.getElementById('battle-arena-container');
    const battleControls = document.getElementById('battle-controls');
    
    if (battleArenaContainer) battleArenaContainer.classList.add('hidden');
    if (battleControls) battleControls.classList.add('hidden');
    
    // 상대방 선택 화면 생성
    const selectionScreen = document.createElement('div');
    selectionScreen.id = 'opponent-selection-screen';
    selectionScreen.className = 'opponent-selection-screen';
    
    selectionScreen.innerHTML = `
        <div class="selection-header">
            <h3>상대방 선택</h3>
            <p>전투할 상대를 선택하세요 (총 ${availableOpponents.length}명)</p>
        </div>
        <div id="opponents-grid" class="opponents-grid"></div>
        <div id="opponent-pagination" class="opponent-pagination"></div>
        <div class="selection-actions">
            <button id="random-opponent-btn" class="random-opponent-btn">랜덤 매칭</button>
            <button id="back-to-arena-btn" class="back-to-arena-btn">돌아가기</button>
        </div>
    `;
    
    // 기존 arena에 추가
    const arena = document.getElementById('arena');
    arena.appendChild(selectionScreen);
    
    // 상대방 목록 표시
    displayOpponentsWithPagination();
    
    // 이벤트 리스너 추가
    document.getElementById('random-opponent-btn').addEventListener('click', selectRandomOpponent);
    document.getElementById('back-to-arena-btn').addEventListener('click', backToArenaFromSelection);
    
    // 가이드 텍스트 업데이트
    const battleGuideText = document.getElementById('battle-guide-text');
    if (battleGuideText) {
        battleGuideText.textContent = '전투할 상대를 선택하거나 랜덤 매칭을 이용하세요.';
    }
}

function showMatchedOpponentScreen() {
    // 페이지 상단으로 스크롤
    window.scrollTo(0, 0);
    
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

// 최근 상대 추적을 위한 전역 변수
let recentOpponents = [];
const MAX_RECENT_OPPONENTS = 5;

// 최근 상대 회피 기반 상대 찾기 함수
async function findRandomOpponent(playerCharacterId) {
    console.log('최근 상대 회피 기반 상대 찾기 시작...');
    
    // 실시간 풀이 비어있는지 확인
    if (allCharactersPool.length === 0) {
        console.log('실시간 캐릭터 풀이 비어있음');
    }
    
    // 자신의 캐릭터와 같은 사용자의 캐릭터 제외
    let availableOpponents = allCharactersPool.filter(c => 
        c.id !== playerCharacterId && c.userId !== currentUser.uid
    );
    
    if (availableOpponents.length === 0) {
        console.log('매칭 가능한 다른 사용자의 캐릭터가 없습니다.');
        return null;
    }
    
    // 최근 상대 회피 기반 상대 선택
    const selectedOpponent = selectOpponentWithWeights(availableOpponents, playerCharacterId);
    
    // 선택된 상대를 최근 상대 목록에 추가
    addToRecentOpponents(selectedOpponent.id);
    
    // 상대방의 최신 데이터를 Firebase에서 가져오기
    try {
        console.log('상대방 최신 데이터 가져오는 중:', selectedOpponent.name);
        const opponentRef = await findCharacterRef(selectedOpponent.id);
        if (opponentRef) {
            const opponentDoc = await getDoc(opponentRef);
            if (opponentDoc.exists()) {
                const latestOpponentData = { id: opponentDoc.id, ...opponentDoc.data() };
                console.log('최근 상대 회피 매칭 완료:', latestOpponentData.name);
                return latestOpponentData;
            }
        }
    } catch (error) {
        console.error('상대방 최신 데이터 가져오기 실패:', error);
    }
    
    // 최신 데이터를 가져올 수 없으면 캐시 데이터 반환
    return selectedOpponent;
}

// 최근 상대 회피 기반 상대 선택 함수
function selectOpponentWithWeights(availableOpponents, playerCharacterId) {
    // 최근 상대가 없거나 모든 상대가 최근 상대인 경우 랜덤 선택
    if (recentOpponents.length === 0 || availableOpponents.length <= recentOpponents.length) {
        const randomOpponent = availableOpponents[Math.floor(Math.random() * availableOpponents.length)];
        console.log(`랜덤 매칭: ${randomOpponent.name}`);
        return randomOpponent;
    }
    
    // 각 상대에 대한 가중치 계산 (최근 상대 회피만 적용)
    const weightedOpponents = availableOpponents.map(opponent => {
        let weight = 1.0; // 기본 가중치
        
        // 최근 상대 페널티 (최근에 만난 상대일수록 낮은 가중치)
        const recentIndex = recentOpponents.indexOf(opponent.id);
        if (recentIndex !== -1) {
            // 최근 순서에 따라 가중치 감소 (가장 최근 = 0.1, 그 다음 = 0.3, ...)
            weight *= (0.1 + (recentIndex * 0.2));
        }
        
        return { opponent, weight };
    });
    
    // 가중치 기반 랜덤 선택
    const totalWeight = weightedOpponents.reduce((sum, item) => sum + item.weight, 0);
    let randomValue = Math.random() * totalWeight;
    
    for (const item of weightedOpponents) {
        randomValue -= item.weight;
        if (randomValue <= 0) {
            console.log(`최근 상대 회피 매칭: ${item.opponent.name} (가중치: ${item.weight.toFixed(2)})`);
            return item.opponent;
        }
    }
    
    // 예외 상황에서는 마지막 상대 반환
    return weightedOpponents[weightedOpponents.length - 1].opponent;
}

// 최근 상대 목록에 추가
function addToRecentOpponents(opponentId) {
    // 이미 목록에 있다면 제거
    const existingIndex = recentOpponents.indexOf(opponentId);
    if (existingIndex !== -1) {
        recentOpponents.splice(existingIndex, 1);
    }
    
    // 맨 앞에 추가
    recentOpponents.unshift(opponentId);
    
    // 최대 개수 유지
    if (recentOpponents.length > MAX_RECENT_OPPONENTS) {
        recentOpponents = recentOpponents.slice(0, MAX_RECENT_OPPONENTS);
    }
    
    console.log('최근 상대 목록 업데이트:', recentOpponents);
}

// 최근 상대 목록 초기화 (선택적)
function clearRecentOpponents() {
    recentOpponents = [];
    console.log('최근 상대 목록 초기화됨');
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
            alert('매칭 가능한 다른 사용자의 캐릭터가 없습니다.');
            loadCharactersForArena();
            return;
        }
        
        // 새로운 상대 설정
        opponentCharacterForBattle = newOpponent;
        
        // 스킬 선택 초기화
        selectedSkills = [];
        
        // 매칭 화면 표시
        showMatchedOpponentScreenFresh(newOpponent);
        
        console.log('새로운 상대 매칭 완료:', newOpponent.name);
        
    } catch (error) {
        console.error('새로운 상대 매칭 중 오류:', error);
        loadCharactersForArena();
    }
}

// 전투 포기 후 완전히 새로운 매칭 화면 표시 함수
function showMatchedOpponentScreenFresh(opponent) {
    // 페이지 상단으로 스크롤
    window.scrollTo(0, 0);
    
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
    
    console.log('🏟️ 아레나 캐릭터 로딩 (최적화)...');
    
    // DOM 요소 존재 확인
    if (!arenaCharactersGrid) {
        console.error('arenaCharactersGrid element not found');
        return;
    }
    
    arenaCharactersGrid.innerHTML = '<p>캐릭터를 불러오는 중...</p>';
    
    try {
        const userCharacters = [];
        
        // 1. 캐시에서 현재 사용자의 캐릭터들 먼저 찾기
        if (allCharactersPool && allCharactersPool.length > 0) {
            const cachedUserChars = allCharactersPool.filter(char => 
                char.createdBy === currentUser.uid || char.userId === currentUser.uid
            );
            
            console.log(`💾 캐시에서 ${cachedUserChars.length}개 캐릭터 발견`);
            userCharacters.push(...cachedUserChars);
        }
        
        // 2. 캐시에 데이터가 없거나 부족한 경우에만 Firebase에서 로드
        if (userCharacters.length === 0) {
            console.log('🔄 캐시에 데이터 없음, Firebase에서 로드...');
            
            // 현재 사용자의 캐릭터들을 로드
            const userQuery = query(collection(db, `users/${currentUser.uid}/characters`), orderBy('name', 'asc'));
            const userSnapshot = await getDocs(userQuery);
            
            userSnapshot.forEach((doc) => {
                const charData = { id: doc.id, userId: currentUser.uid, ...doc.data() };
                userCharacters.push(charData);
                // 캐시에도 저장
                setCachedCharacter(doc.id, charData);
            });
            
            // 전체 캐릭터에서 현재 사용자가 만든 캐릭터 추가 확인
            const allCharsQuery = query(collectionGroup(db, 'characters'));
            const allCharsSnapshot = await getDocs(allCharsQuery);
            
            allCharsSnapshot.forEach((doc) => {
                const charData = doc.data();
                if (charData.createdBy === currentUser.uid) {
                    const existingChar = userCharacters.find(c => c.id === doc.id);
                    if (!existingChar) {
                        const fullCharData = { id: doc.id, userId: currentUser.uid, ...charData };
                        userCharacters.push(fullCharData);
                        // 캐시에도 저장
                        setCachedCharacter(doc.id, fullCharData);
                    }
                }
            });
        }
        
        console.log(`✅ 총 ${userCharacters.length}개 아레나 캐릭터 로드 완료`);
        
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
     let character = allCharactersPool.find(c => c.id === characterId);
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
    
    // 상대방 최신 데이터 가져오기 (캐시된 데이터 사용)
    console.log('상대방 캐시된 데이터 사용:', opponentCharacterForBattle.name);
    
    // 상대방 스킬 랜덤 선택 (최신 데이터 기반)
    const opponentSkills = getRandomSkills(opponentCharacterForBattle);
    console.log('상대방 선택된 스킬:', opponentSkills.map(s => s.name || s.skill_name));
    
    // 전투 데이터 준비 (전체 캐릭터 객체 포함)
    const battleData = {
        player: {
            ...playerCharacterForBattle,
            skills: selectedSkills
        },
        opponent: {
            ...opponentCharacterForBattle,
            skills: opponentSkills
        }
    };
    
    console.log('전투 데이터 준비 완료:', {
        playerCreatedBy: battleData.player.createdBy,
        opponentCreatedBy: battleData.opponent.createdBy,
        playerName: battleData.player.name,
        opponentName: battleData.opponent.name
    });
    
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
    
    // finalResult 변수를 함수 스코프에서 선언
    let finalResult = null;
    let isPlayerWin = false;
    
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
        finalResult = await getFinalVerdict(battleData.player, battleData.opponent, selectedSkills, opponentSkills, battleTurns);
        console.log('최종 결과:', finalResult);
        
        // 최종 결과는 게이지 상태 텍스트로만 표시
        
        // 승부 결과에 따른 처리 (null 체크 추가)
        const playerName = playerCharacterForBattle?.name || battleData?.player?.name || 'Unknown';
        isPlayerWin = finalResult.winner_name === playerName;
        
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
        
        // 게이지 100% 완료 후 루나 지급 알림 표시 (플레이어가 승리한 경우에만)
        if (isPlayerWin) {
            console.log('플레이어 승리 - 루나 지급 알림 표시 시도');
            try {
                // 루나 지급 처리
                await awardLunaToCharacterOwner(playerCharacterForBattle.id || playerCharacterForBattle.character_id || playerCharacterForBattle.name);
                console.log('루나 지급 완료');
            } catch (error) {
                console.error('루나 지급 실패:', error);
            }
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
            const messageClass = isPlayerWin ? 'battle-complete-message battle-complete-message-win' : 'battle-complete-message battle-complete-message-lose';
            dynamicMessageElement.innerHTML = `
                <div class="${messageClass}">
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

// 전투 기록 저장 함수 (최적화됨 - 문서 크기 제한 해결)
async function saveBattleRecord(winnerData, loserData, battleData) {
    try {
        // 스킬 정보를 간소화 (이름만 저장)
        const simplifySkills = (skills) => {
            if (!skills || !Array.isArray(skills)) return [];
            return skills.map(skill => {
                if (typeof skill === 'string') return skill;
                return skill.name || skill;
            });
        };
        
        // 기본 전투 기록 (battles 컬렉션용 - 최소한의 정보만)
        const battleRecord = {
            winnerId: winnerData.id,
            winnerName: winnerData.name,
            loserId: loserData.id,
            loserName: loserData.name,
            battleDate: new Date().toISOString(),
            playerSkills: simplifySkills(battleData.playerSkills),
            opponentSkills: simplifySkills(battleData.opponentSkills),
            createdAt: new Date().toISOString()
        };
        
        // 승자의 전투 기록 (개별 battleHistory용)
        const winnerBattleRecord = {
            ...battleRecord,
            result: 'win',
            opponentId: loserData.id,
            opponentName: loserData.name,
            opponentImage: loserData.imageUrl || null
        };
        
        // 패자의 전투 기록 (개별 battleHistory용)
        const loserBattleRecord = {
            ...battleRecord,
            result: 'lose',
            opponentId: winnerData.id,
            opponentName: winnerData.name,
            opponentImage: winnerData.imageUrl || null
        };
        
        // 각 캐릭터의 개별 전투 기록만 저장 (battles 컬렉션 제거로 크기 문제 해결)
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

async function updateWinsLosses(winnerId, loserId) {
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

        console.log('Firebase transaction 시작 - 승패기록과 전투기록 동시 저장');
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

            // 승패 기록 업데이트
            transaction.update(winnerRef, { wins: newWins });
            transaction.update(loserRef, { losses: newLosses });
            
            // 전투 기록 저장은 별도의 saveBattleRecord 함수에서 처리됨 (중복 방지)
            console.log('전투 기록은 별도 함수에서 처리됩니다.');
        });
        
        console.log('승패기록과 전투기록이 동시에 저장되었습니다.');
        
        // 즉시 UI 업데이트
        console.log('UI 업데이트 시작');
        // 캐시 강제 갱신으로 최신 데이터 반영
        await loadUserCharacters(true);
        console.log('UI 업데이트 완료');
        
    } catch (e) {
        console.error('Transaction failed: ', e);
    }
}

// 캐릭터 참조 캐시
// 🚀 스마트 캐시 시스템
let characterRefCache = new Map(); // 캐릭터 참조 캐시
let characterDataCache = new Map(); // 캐릭터 데이터 캐시 (새로 추가)
let cacheTimestamps = new Map(); // 캐시 타임스탬프
let pendingRequests = new Map(); // 중복 요청 방지

// 캐시 설정
const CACHE_DURATION = {
    CHARACTER_DATA: 5 * 60 * 1000, // 캐릭터 기본 정보: 5분
    SKILL_DATA: 1 * 60 * 1000,     // 스킬 정보: 1분
    RANKING_DATA: 30 * 1000,       // 랭킹: 30초
    BATTLE_STATS: 0                // 승패 기록: 실시간
};

// 캐시 유효성 검사
function isCacheValid(key, duration) {
    const timestamp = cacheTimestamps.get(key);
    if (!timestamp) return false;
    return (Date.now() - timestamp) < duration;
}

// 캐시 저장
function setCache(key, data, type = 'CHARACTER_DATA') {
    characterDataCache.set(key, data);
    cacheTimestamps.set(key, Date.now());
    console.log(`💾 캐시 저장: ${key} (${type})`);
}

// 캐시 삭제
function clearCache(key) {
    characterDataCache.delete(key);
    cacheTimestamps.delete(key);
    characterRefCache.delete(key);
    console.log(`🗑️ 캐시 삭제: ${key}`);
}

// 🚀 배치 처리 시스템
let batchQueue = [];
let batchTimer = null;
const BATCH_DELAY = 10000; // 10초마다 배치 처리

// 배치에 작업 추가
function addToBatch(operation) {
    // Firebase 할당량 문제로 인해 배치 처리를 일시적으로 비활성화
    // 대신 즉시 개별 처리
    console.log(`🔄 개별 처리로 전환: ${operation.type}`);
    processIndividualOperation(operation);
}

// 개별 작업 처리 함수
async function processIndividualOperation(operation) {
    try {
        switch (operation.type) {
            case 'BATTLE_RECORD':
                // battles 컬렉션 저장 제거 (문서 크기 제한 문제 해결)
                console.log('📊 전투 기록은 개별 캐릭터 battleHistory에만 저장됩니다');
                break;
            case 'SKILL_UPDATE':
                if (operation.ref && operation.data && Object.keys(operation.data).length > 0) {
                    await updateDoc(operation.ref, operation.data);
                    console.log('⚔️ 스킬 개별 업데이트 완료');
                }
                break;
            case 'STATS_UPDATE':
                if (operation.ref && operation.data && Object.keys(operation.data).length > 0) {
                    await updateDoc(operation.ref, operation.data);
                    console.log('📈 통계 개별 업데이트 완료');
                }
                break;
        }
    } catch (error) {
        console.error(`❌ ${operation.type} 개별 처리 실패:`, error);
        // 오프라인 저장으로 폴백
        if (!isOnline()) {
            saveOfflineAction({
                type: 'batch_operation',
                operation: operation,
                timestamp: new Date().toISOString()
            });
        }
    }
}

// 배치 처리 실행
async function processBatch() {
    if (batchQueue.length === 0) {
        batchTimer = null;
        return;
    }
    
    console.log(`🚀 배치 처리 시작: ${batchQueue.length}개 작업`);
    const currentBatch = [...batchQueue];
    batchQueue = [];
    batchTimer = null;
    
    // 타입별로 그룹화
    const groupedOps = currentBatch.reduce((groups, op) => {
        if (!groups[op.type]) groups[op.type] = [];
        groups[op.type].push(op);
        return groups;
    }, {});
    
    // 각 타입별로 배치 처리
    for (const [type, operations] of Object.entries(groupedOps)) {
        try {
            await processBatchByType(type, operations);
            console.log(`✅ ${type} 배치 처리 완료: ${operations.length}개`);
        } catch (error) {
            console.error(`❌ ${type} 배치 처리 실패:`, error);
        }
    }
}

// 타입별 배치 처리
async function processBatchByType(type, operations) {
    switch (type) {
        case 'BATTLE_RECORD':
            await processBattleRecordBatch(operations);
            break;
        case 'SKILL_UPDATE':
            await processSkillUpdateBatch(operations);
            break;
        case 'STATS_UPDATE':
            await processStatsUpdateBatch(operations);
            break;
        default:
            console.warn(`알 수 없는 배치 타입: ${type}`);
    }
}

// 전투 기록 배치 처리 (battles 컬렉션 저장 제거)
async function processBattleRecordBatch(operations) {
    try {
        // battles 컬렉션 저장 제거 (문서 크기 제한 문제 해결)
        // 전투 기록은 개별 캐릭터의 battleHistory 서브컬렉션에만 저장됩니다
        console.log(`📊 전투 기록 배치 처리 스킵: ${operations.length}개 (개별 캐릭터 기록만 사용)`);
    } catch (error) {
        console.error('❌ 전투 기록 배치 처리 오류:', error);
        // 개별 저장으로 폴백
        for (const op of operations) {
            try {
                const battleRef = doc(collection(db, 'battles'));
                await setDoc(battleRef, op.data);
            } catch (individualError) {
                console.error('❌ 개별 전투 기록 저장 실패:', individualError);
            }
        }
    }
}

// 스킬 업데이트 배치 처리
async function processSkillUpdateBatch(operations) {
    try {
        const batch = writeBatch(db);
        
        operations.forEach(op => {
            // 참조와 데이터 유효성 검사
            if (!op.ref || !op.data || typeof op.data !== 'object') {
                console.error('❌ 유효하지 않은 스킬 업데이트 데이터:', op);
                return;
            }
            
            // 필드 값 검증
            const cleanData = {};
            for (const [key, value] of Object.entries(op.data)) {
                if (value !== undefined && value !== null) {
                    cleanData[key] = value;
                }
            }
            
            if (Object.keys(cleanData).length > 0) {
                batch.update(op.ref, cleanData);
            }
        });
        
        await batch.commit();
        console.log(`⚔️ 스킬 업데이트 배치 완료: ${operations.length}개`);
    } catch (error) {
        console.error('❌ 스킬 업데이트 배치 처리 오류:', error);
        // 개별 업데이트로 폴백
        for (const op of operations) {
            try {
                if (op.ref && op.data) {
                    await updateDoc(op.ref, op.data);
                }
            } catch (individualError) {
                console.error('❌ 개별 스킬 업데이트 실패:', individualError);
            }
        }
    }
}

// 통계 업데이트 배치 처리
async function processStatsUpdateBatch(operations) {
    try {
        const batch = writeBatch(db);
        
        operations.forEach(op => {
            // 참조와 데이터 유효성 검사
            if (!op.ref || !op.data || typeof op.data !== 'object') {
                console.error('❌ 유효하지 않은 통계 업데이트 데이터:', op);
                return;
            }
            
            // 필드 값 검증
            const cleanData = {};
            for (const [key, value] of Object.entries(op.data)) {
                if (value !== undefined && value !== null) {
                    cleanData[key] = value;
                }
            }
            
            if (Object.keys(cleanData).length > 0) {
                batch.update(op.ref, cleanData);
            }
        });
        
        await batch.commit();
        console.log(`📈 통계 업데이트 배치 완료: ${operations.length}개`);
    } catch (error) {
        console.error('❌ 통계 업데이트 배치 처리 오류:', error);
        // 개별 업데이트로 폴백
        for (const op of operations) {
            try {
                if (op.ref && op.data) {
                    await updateDoc(op.ref, op.data);
                }
            } catch (individualError) {
                console.error('❌ 개별 통계 업데이트 실패:', individualError);
            }
        }
    }
}

// 승패 업데이트 (배치 처리 버전)
async function updateWinsLossesBatch(winnerId, loserId) {
    try {
        // 오프라인 상태 확인
        if (!isOnline()) {
            console.log('📱 오프라인 상태: 전투 결과를 로컬에 저장');
            saveOfflineAction({
                type: 'BATTLE_RESULT',
                winnerId: winnerId,
                loserId: loserId
            });
            return;
        }
        
        // 캐릭터 참조 찾기
        const winnerRef = await findCharacterRef(winnerId);
        const loserRef = await findCharacterRef(loserId);
        
        if (!winnerRef || !loserRef) {
            console.error('캐릭터 참조를 찾을 수 없습니다');
            // 오프라인 액션으로 저장
            saveOfflineAction({
                type: 'BATTLE_RESULT',
                winnerId: winnerId,
                loserId: loserId
            });
            return;
        }
        
        // 캐시에서 현재 데이터 확인
        let winnerData = characterDataCache.get(winnerId);
        let loserData = characterDataCache.get(loserId);
        
        // 캐시에 없거나 만료된 경우 Firebase에서 가져오기
        if (!winnerData || !isCacheValid(winnerId, 'battle')) {
            const winnerDoc = await getDoc(winnerRef);
            if (winnerDoc.exists()) {
                winnerData = winnerDoc.data();
                setCache(winnerId, winnerData, 'battle');
            }
        }
        
        if (!loserData || !isCacheValid(loserId, 'battle')) {
            const loserDoc = await getDoc(loserRef);
            if (loserDoc.exists()) {
                loserData = loserDoc.data();
                setCache(loserId, loserData, 'battle');
            }
        }
        
        // 승패 통계 계산
        const winnerWins = (winnerData.wins || 0) + 1;
        const winnerLosses = winnerData.losses || 0;
        const loserWins = loserData.wins || 0;
        const loserLosses = (loserData.losses || 0) + 1;
        
        // 캐시 업데이트
        const updatedWinnerData = { ...winnerData, wins: winnerWins, losses: winnerLosses };
        const updatedLoserData = { ...loserData, wins: loserWins, losses: loserLosses };
        setCache(winnerId, updatedWinnerData, 'battle');
        setCache(loserId, updatedLoserData, 'battle');
        
        // 배치에 추가
        addToBatch({
            type: 'STATS_UPDATE',
            ref: winnerRef,
            data: { wins: winnerWins, losses: winnerLosses }
        });
        
        addToBatch({
            type: 'STATS_UPDATE',
            ref: loserRef,
            data: { wins: loserWins, losses: loserLosses }
        });
        
        console.log(`📊 승패 통계 배치 큐에 추가: 승자 ${winnerWins}승 ${winnerLosses}패, 패자 ${loserWins}승 ${loserLosses}패`);
        
    } catch (error) {
        console.error('배치 승패 업데이트 실패:', error);
    }
}

// 🔄 오프라인 백업 시스템
const OFFLINE_STORAGE_KEY = 'character_battle_offline_data';
const OFFLINE_ACTIONS_KEY = 'character_battle_offline_actions';

// 오프라인 데이터 저장
function saveToOfflineStorage(key, data) {
    try {
        const offlineData = JSON.parse(localStorage.getItem(OFFLINE_STORAGE_KEY) || '{}');
        offlineData[key] = {
            data: data,
            timestamp: Date.now()
        };
        localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(offlineData));
        console.log(`💾 오프라인 저장: ${key}`);
    } catch (error) {
        console.error('오프라인 저장 실패:', error);
    }
}

// 오프라인 데이터 불러오기
function loadFromOfflineStorage(key) {
    try {
        const offlineData = JSON.parse(localStorage.getItem(OFFLINE_STORAGE_KEY) || '{}');
        const item = offlineData[key];
        if (item && (Date.now() - item.timestamp) < 300000) { // 5분 이내
            console.log(`📱 오프라인에서 불러옴: ${key}`);
            return item.data;
        }
        return null;
    } catch (error) {
        console.error('오프라인 불러오기 실패:', error);
        return null;
    }
}

// 오프라인 액션 저장
function saveOfflineAction(action) {
    try {
        const actions = JSON.parse(localStorage.getItem(OFFLINE_ACTIONS_KEY) || '[]');
        actions.push({
            ...action,
            timestamp: Date.now(),
            id: Date.now() + Math.random()
        });
        localStorage.setItem(OFFLINE_ACTIONS_KEY, JSON.stringify(actions));
        console.log(`📝 오프라인 액션 저장: ${action.type}`);
    } catch (error) {
        console.error('오프라인 액션 저장 실패:', error);
    }
}

// 오프라인 액션 동기화
async function syncOfflineActions() {
    try {
        const actions = JSON.parse(localStorage.getItem(OFFLINE_ACTIONS_KEY) || '[]');
        if (actions.length === 0) return;
        
        console.log(`🔄 오프라인 액션 동기화 시작: ${actions.length}개`);
        
        for (const action of actions) {
            try {
                switch (action.type) {
                    case 'BATTLE_RESULT':
                        await updateWinsLossesBatch(action.winnerId, action.loserId);
                        break;
                    case 'SKILL_UPDATE':
                        await saveLastUsedSkills(action.characterId, action.skills);
                        break;
                    default:
                        console.warn(`알 수 없는 오프라인 액션: ${action.type}`);
                }
            } catch (error) {
                console.error(`오프라인 액션 동기화 실패: ${action.type}`, error);
            }
        }
        
        // 동기화 완료 후 오프라인 액션 삭제
        localStorage.removeItem(OFFLINE_ACTIONS_KEY);
        console.log('✅ 오프라인 액션 동기화 완료');
        
    } catch (error) {
        console.error('오프라인 동기화 실패:', error);
    }
}

// 네트워크 상태 확인
function isOnline() {
    return navigator.onLine;
}

// 온라인 상태 변경 감지
window.addEventListener('online', () => {
    console.log('🌐 온라인 상태로 변경됨');
    syncOfflineActions();
});

window.addEventListener('offline', () => {
    console.log('📱 오프라인 상태로 변경됨');
});

// 🚀 스마트 캐릭터 데이터 로딩 (중복 요청 방지 + 캐시)
async function getCharacterDataSmart(characterId, forceRefresh = false) {
    try {
        const cacheKey = `char_${characterId}`;
        
        // 진행 중인 요청이 있으면 기다리기 (중복 요청 방지)
        if (pendingRequests.has(cacheKey)) {
            console.log(`⏳ 진행 중인 요청 대기: ${characterId}`);
            return await pendingRequests.get(cacheKey);
        }
        
        // 캐시 확인 (강제 새로고침이 아닌 경우)
        if (!forceRefresh && isCacheValid(cacheKey, CACHE_DURATION.CHARACTER_DATA)) {
            const cachedData = characterDataCache.get(cacheKey);
            if (cachedData) {
                console.log(`💾 캐시에서 캐릭터 데이터 반환: ${characterId}`);
                return cachedData;
            }
        }
        
        // 실시간 풀에서 먼저 확인
        if (allCharactersPool && allCharactersPool.length > 0) {
            const poolData = allCharactersPool.find(char => char.id === characterId);
            if (poolData) {
                setCache(cacheKey, poolData, 'CHARACTER_DATA');
                // 오프라인 백업에도 저장
                saveToOfflineStorage(cacheKey, poolData);
                console.log(`✅ 실시간 풀에서 캐릭터 데이터 반환: ${characterId}`);
                return poolData;
            }
        }
        
        // 오프라인 상태이거나 Firebase 오류 시 오프라인 데이터 사용
        if (!isOnline()) {
            const offlineData = loadFromOfflineStorage(cacheKey);
            if (offlineData) {
                console.log(`📱 오프라인 모드: 로컬 데이터 사용 ${characterId}`);
                setCache(cacheKey, offlineData, 'CHARACTER_DATA');
                return offlineData;
            }
        }
        
        // Firebase에서 로딩 (최후 수단)
        const requestPromise = loadCharacterFromFirebase(characterId);
        pendingRequests.set(cacheKey, requestPromise);
        
        try {
            const firebaseData = await requestPromise;
            if (firebaseData) {
                setCache(cacheKey, firebaseData, 'CHARACTER_DATA');
                // 오프라인 백업에도 저장
                saveToOfflineStorage(cacheKey, firebaseData);
                console.log(`🔄 Firebase에서 캐릭터 데이터 로딩: ${characterId}`);
            }
            return firebaseData;
        } catch (error) {
            // Firebase 오류 시 오프라인 데이터 시도
            console.warn('Firebase 오류, 오프라인 데이터 시도:', error);
            const offlineData = loadFromOfflineStorage(cacheKey);
            if (offlineData) {
                console.log(`🔄 Firebase 오류로 오프라인 데이터 사용: ${characterId}`);
                setCache(cacheKey, offlineData, 'CHARACTER_DATA');
                return offlineData;
            }
            throw error;
        } finally {
            pendingRequests.delete(cacheKey);
        }
        
    } catch (error) {
        console.error('스마트 캐릭터 데이터 로딩 실패:', error);
        pendingRequests.delete(`char_${characterId}`);
        return null;
    }
}

// Firebase에서 캐릭터 로딩 (헬퍼 함수)
async function loadCharacterFromFirebase(characterId) {
    const charRef = await findCharacterRef(characterId);
    if (!charRef) return null;
    
    const charDoc = await getDoc(charRef);
    if (charDoc.exists()) {
        return { id: characterId, ...charDoc.data() };
    }
    return null;
}

async function findCharacterRef(characterId) {
    try {
        // characterId가 유효한지 확인
        if (!characterId) {
            console.error('❌ 유효하지 않은 characterId:', characterId);
            return null;
        }
        
        console.log('🔍 findCharacterRef 호출됨 (최적화), characterId:', characterId);
        
        // 참조 캐시에서 먼저 확인
        if (characterRefCache.has(characterId)) {
            const cachedRef = characterRefCache.get(characterId);
            console.log('💾 참조 캐시에서 찾음:', cachedRef.path);
            return cachedRef;
        }
        
        // 실시간 리스너의 캐시된 데이터에서 찾기 (Firebase 읽기 절약)
        if (allCharactersPool && allCharactersPool.length > 0) {
            const cachedCharacter = allCharactersPool.find(char => char.id === characterId);
            if (cachedCharacter && cachedCharacter.userId) {
                try {
                    const charRef = doc(db, `users/${cachedCharacter.userId}/characters`, characterId);
                    characterRefCache.set(characterId, charRef); // 참조 캐시에 저장
                    console.log('✅ 실시간 풀에서 찾음 및 참조 캐시 저장:', charRef.path);
                    return charRef;
                } catch (refError) {
                    console.error('실시간 풀에서 참조 생성 오류:', refError);
                }
            }
        }
        
        // 캐시에 없으면 현재 사용자의 캐릭터에서 찾기 (최후 수단)
        if (currentUser?.uid) {
            try {
                const userCharRef = doc(db, `users/${currentUser.uid}/characters`, characterId);
                const userCharDoc = await getDoc(userCharRef);
                
                if (userCharDoc.exists()) {
                    characterRefCache.set(characterId, userCharRef); // 참조 캐시에 저장
                    console.log('🔄 Firebase에서 찾음 및 참조 캐시 저장:', userCharRef.path);
                    return userCharRef;
                }
            } catch (fbError) {
                console.error('Firebase 참조 또는 조회 오류:', fbError);
            }
        }
        
        console.log('❌ 캐릭터를 찾을 수 없음:', characterId);
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
    
    // 최근 사용 스킬이 있는지 확인
    const lastUsedSkills = opponent.lastUsedSkills || [];
    console.log('상대방 최근 사용 스킬:', lastUsedSkills);
    
    if (lastUsedSkills.length >= 2) {
        // 최근 사용 스킬이 2개 이상 있으면 그대로 사용
        console.log('상대방 최근 사용 스킬 2개를 사용합니다.');
        selectedSkills.push(...lastUsedSkills.slice(0, 2));
    } else if (lastUsedSkills.length === 1) {
        // 최근 사용 스킬이 1개만 있으면 그것을 포함하고 나머지는 랜덤
        console.log('상대방 최근 사용 스킬 1개와 랜덤 스킬 1개를 사용합니다.');
        selectedSkills.push(lastUsedSkills[0]);
        
        // 나머지 1개는 랜덤으로 선택 (이미 선택된 스킬 제외)
        const allSkills = [];
        if (opponent.attack_skills) allSkills.push(...opponent.attack_skills);
        if (opponent.defense_skills) allSkills.push(...opponent.defense_skills);
        
        const availableSkills = allSkills.filter(skill => 
            (skill.name || skill.skill_name) !== (lastUsedSkills[0].name || lastUsedSkills[0].skill_name)
        );
        
        if (availableSkills.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableSkills.length);
            selectedSkills.push(availableSkills[randomIndex]);
        }
    } else {
        // 최근 사용 스킬이 없으면 기존 랜덤 로직 사용
        console.log('상대방 최근 사용 스킬이 없어 랜덤 선택합니다.');
        
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

// 캐릭터의 최근 사용 스킬을 저장하는 함수
async function saveLastUsedSkills(characterId, skills) {
    try {
        console.log('saveLastUsedSkills 호출됨:', characterId, skills);
        
        if (!characterId || !skills || skills.length === 0) {
            console.log('유효하지 않은 데이터로 스킬 저장 건너뜀');
            return;
        }
        
        // 스킬 데이터 정규화 및 undefined 값 필터링
        const normalizedSkills = skills
            .filter(skill => skill && (skill.name || skill.skill_name)) // null/undefined 스킬 및 이름이 없는 스킬 제거
            .map(skill => {
                const normalized = {
                    name: skill.name || skill.skill_name,
                    type: skill.type,
                    description: skill.description
                };
                
                // undefined 값이 있는 필드 제거
                Object.keys(normalized).forEach(key => {
                    if (normalized[key] === undefined) {
                        delete normalized[key];
                    }
                });
                
                return normalized;
            })
            .filter(skill => skill.name); // 이름이 없는 스킬 최종 제거
        
        // Firebase에 최근 사용 스킬 저장 (올바른 경로 사용)
        const characterRef = await findCharacterRef(characterId);
        
        if (!characterRef) {
            console.log('캐릭터 참조를 찾을 수 없어 스킬 저장을 건너뜀:', characterId);
            return;
        }
        
        try {
            // 문서가 존재하는지 확인
            const docSnap = await getDoc(characterRef);
            if (docSnap.exists()) {
                await updateDoc(characterRef, {
                    lastUsedSkills: normalizedSkills,
                    lastUsedSkillsTimestamp: new Date().toISOString()
                });
                console.log('최근 사용 스킬 저장 완료:', characterId, normalizedSkills);
            } else {
                console.log('캐릭터 문서가 존재하지 않아 스킬 저장을 건너뜀:', characterId);
            }
        } catch (updateError) {
            console.error('문서 업데이트 중 오류:', updateError);
            // 문서가 존재하지 않는 경우 새로 생성
            if (updateError.code === 'not-found') {
                console.log('문서가 존재하지 않아 스킬 저장을 건너뜀:', characterId);
            }
        }
        
    } catch (error) {
        console.error('스킬 저장 중 오류:', error);
    }
}

async function updateCharacterStats(winner, loser) {
    try {
        console.log('📊 updateCharacterStats 함수 호출됨 (배치 처리 버전)');
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
        
        // 전투 기록 배치 추가 제거 (battles 컬렉션 저장 안함)
        // 전투 기록은 saveBattleRecord 함수에서 개별 캐릭터 battleHistory에만 저장됩니다
        
        console.log('🚀 배치 처리로 승패 업데이트 시작');
        await updateWinsLossesBatch(winnerId, loserId);
        console.log('✅ 배치 처리 승패 업데이트 완료');
        
        // 플레이어와 상대방 모두의 최근 사용 스킬 저장
        if (window.lastBattleData?.playerSkills && window.lastBattleData.player) {
            // 플레이어의 스킬 저장
            const playerId = window.lastBattleData.player.id || window.lastBattleData.player.character_id || window.lastBattleData.player.name;
            await saveLastUsedSkills(playerId, window.lastBattleData.playerSkills);
        }
        
        if (window.lastBattleData?.opponentSkills && window.lastBattleData.opponent) {
            // 상대방의 스킬 저장
            const opponentId = window.lastBattleData.opponent.id || window.lastBattleData.opponent.character_id || window.lastBattleData.opponent.name;
            await saveLastUsedSkills(opponentId, window.lastBattleData.opponentSkills);
        }
        
        // 루나 지급은 updateWinsLosses 함수에서 처리됨
        
        // 실시간 리스너가 자동으로 UI를 업데이트하므로 수동 새로고침 불필요
        console.log('실시간 리스너가 자동으로 랭킹과 캐릭터 목록을 업데이트합니다.');
        
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

    // 사용된 스킬 이름과 설명 추출
    const playerSkillDetails = playerSkills.map(skill => `${skill.name || skill.skill_name}: ${skill.description}`).join('\n');
    const opponentSkillDetails = opponentSkills.map(skill => `${skill.name || skill.skill_name}: ${skill.description}`).join('\n');
    
    // 스킬 이름만 추출 (기존 로직 유지)
    const playerSkillNames = playerSkills.map(skill => skill.name || skill.skill_name).join(', ');
    const opponentSkillNames = opponentSkills.map(skill => skill.name || skill.skill_name).join(', ');

    const prompt = `
        당신은 재능 있는 소설가입니다. 두 캐릭터 간의 전투에 대한 짧고 극적인 이야기를 한국어로 작성해주세요.
        이야기는 5-7개 문단 정도의 길이여야 합니다.
        캐릭터들의 내면의 생각, 대화, 환경, 그리고 제공된 전투 로그를 바탕으로 한 클라이맥스 결말을 포함해주세요.
        이야기는 결정적이어야 하며 최종 승자를 반영해야 합니다.
        
        **중요: 전투에서 사용된 실제 스킬 이름들을 스토리 내러티브에 반드시 포함해야 합니다.**
        **캐릭터 배경을 사용하여 의미 있는 연결, 라이벌 관계, 또는 전투 내러티브를 이끄는 철학적 갈등을 만들어주세요.**
        **모든 서술, 묘사, 대화는 반드시 한국어로 작성해주세요. 스킬 이름과 캐릭터 이름만 원래 언어를 유지할 수 있습니다.**

        - 캐릭터 1 (플레이어): ${player.name} (${player.class})
          - 사용한 스킬:
${playerSkillDetails}
          - 성격: ${player.personality}
          - 배경 스토리: ${player.story || '알려지지 않은 과거'}
          - 기원 스토리: ${player.origin_story || '신비로운 기원'}
        - 캐릭터 2 (상대방): ${opponent.name} (${opponent.class})
          - 사용한 스킬:
${opponentSkillDetails}
          - 성격: ${opponent.personality}
          - 배경 스토리: ${opponent.story || '알려지지 않은 과거'}
          - 기원 스토리: ${opponent.origin_story || '신비로운 기원'}
        - 전투 로그 (턴별):\n${battleTurns.join('\n')}
        - 최종 승자: ${winner.name}

        다음과 같은 매력적이고 서사적인 스타일로 이야기를 작성해주세요:
        1. 각 캐릭터의 과거 경험이 전투 스타일과 결정에 어떻게 영향을 미치는지 반영
        2. 그들의 배경이 서로 간의 긴장감이나 연결을 어떻게 만드는지 보여주기
        3. 그들의 철학과 동기를 드러내는 대화 포함
        4. 개인적 역사를 바탕으로 한 승리/패배에 대한 반응 묘사
        5. 전투 중 사용되는 특정 스킬들과 그 효과를 반드시 언급하고, 스킬의 특성이 전투 전개에 미치는 영향을 묘사
        
        단순히 사건을 나열하지 말고, 그들의 이야기를 의미 있는 내러티브로 엮어주세요.
    `;

    try {
        const result = await generateWithFallback(prompt);
        const response = await result.response;
        const novelText = response.text();
        
        // Format the text into paragraphs and apply styling
        const formattedNovel = formatNovelTextWithStyling(novelText, playerSkillNames, opponentSkillNames, player.name, opponent.name);

        console.log('Generated novel text:', novelText);
        console.log('Formatted novel:', formattedNovel);
        
        // 루나 지급은 updateWinsLosses 함수에서 처리됨 (중복 지급 방지)
        console.log('전투 스토리 표시 - 루나 지급은 이미 updateWinsLosses에서 처리됨');
        
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
            
            // 전투 이미지 생성 버튼 추가 (베타 버전, 루나 소모)
            const generateImageBtn = document.createElement('button');
            generateImageBtn.id = 'story-generate-battle-image-btn';
            generateImageBtn.className = 'btn btn-primary';
            generateImageBtn.innerHTML = '🎨 전투 장면 이미지 생성 <span class="beta-badge">Beta</span><span class="luna-cost">1000</span>';
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
            
            // 버튼 컨테이너 생성
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'battle-story-buttons';
            buttonContainer.style.cssText = 'display: flex; gap: 15px; justify-content: center; margin-top: 20px; flex-wrap: wrap;';
            
            // 다음전투 버튼 추가 (매칭 화면으로 이동)
            const nextBattleBtn = document.createElement('button');
            nextBattleBtn.id = 'next-battle-btn';
            nextBattleBtn.className = 'btn btn-primary';
            nextBattleBtn.innerHTML = '⚔️ 다음전투';
            nextBattleBtn.addEventListener('click', async () => {
                console.log('다음전투 버튼 클릭됨 - 매칭 화면으로 이동');
                
                // 스토리 컨테이너 제거
                storyContainer.remove();
                
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
                
                // 전투 관련 전역 변수들 초기화 (일부만)
                selectedSkills = [];
                opponentCharacterForBattle = null;
                // playerCharacterForBattle은 유지 (같은 캐릭터로 다음 전투)
                
                console.log('매칭 화면으로 이동 중...');
                
                // 매칭 화면으로 이동
                if (playerCharacterForBattle) {
                    startBattleFromDetail(playerCharacterForBattle.id);
                } else {
                    // 플레이어 캐릭터가 없으면 캐릭터 선택 화면으로
                    showView('character-cards');
                }
            });
            
            // 아레나로 돌아가기 버튼 추가
            const backToArenaBtn = document.createElement('button');
            backToArenaBtn.id = 'back-to-arena-btn';
            backToArenaBtn.className = 'btn btn-secondary';
            backToArenaBtn.textContent = '🏟️ 아레나로 돌아가기';
            backToArenaBtn.addEventListener('click', async () => {
                console.log('아레나로 돌아가기 버튼 클릭됨');
                
                // 스토리 컨테이너 제거
                storyContainer.remove();
                
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
            
            // 버튼들을 컨테이너에 추가
            buttonContainer.appendChild(nextBattleBtn);
            buttonContainer.appendChild(backToArenaBtn);
            storyContainer.appendChild(buttonContainer);
            
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
        
        const finalResult = await getFinalVerdict(player, opponent, selectedSkills, opponentSkills, battleTurns);

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
        const isPlayerWin = winner.name === player.name;
        const messageClass = isPlayerWin ? 'battle-complete-message battle-complete-message-win' : 'battle-complete-message battle-complete-message-lose';
        dynamicMessageElement.innerHTML = `
            <div class="${messageClass}">
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

async function getFinalVerdict(player, opponent, playerSkills, opponentSkills, battleTurns) {
    // 전투 중단 체크
    if (!window.battleInProgress) {
        console.log('getFinalVerdict: 전투가 중단되었습니다.');
        return {
            winner_name: player.name,
            battle_summary: '전투가 중단되었습니다.'
        };
    }
    
    const prompt = `
        당신은 전투 심판관입니다. 다음 정보를 종합하여 승자를 결정하세요.

        전투 참가자:
        - ${player.name}:
          스킬1: ${playerSkills[0].name} - ${playerSkills[0].description}
          스킬2: ${playerSkills[1].name} - ${playerSkills[1].description}
          
        - ${opponent.name}:
          스킬1: ${opponentSkills[0].name} - ${opponentSkills[0].description}
          스킬2: ${opponentSkills[1].name} - ${opponentSkills[1].description}

        판정 원칙:
        1. 스킬 설명을 문자 그대로 해석하되 게임 밸런스 고려
        2. '절대', '무적' 등은 합리적 한계 내에서 해석
        3. 창의적이고 구체적인 스킬일수록 높은 효과
        4. 2개 스킬의 조합과 시너지 효과 중요
        5. 논리적 모순 시 능동적 스킬 > 수동적 스킬
        6. 무승부 금지, 반드시 승자 결정

        전투 로그:
        ${battleTurns.join('\n')}

        위 원칙에 따라 스킬 효과를 종합 판단하여 승자를 결정하세요.
        
        응답은 반드시 다음 형식의 JSON 객체로 해주세요:
        {"winner_name": "승자 이름", "battle_summary": "승리 이유 (한국어, 1-2문장)"}
        승자 이름은 반드시 "${player.name}" 또는 "${opponent.name}" 중 하나여야 합니다.
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

// --- RANKING SYSTEM (페이지네이션 최적화) ---
let currentRankingPage = 1;
const RANKING_ITEMS_PER_PAGE = 10;

function loadRanking() {
    rankingList.innerHTML = '<p>랭킹을 불러오는 중...</p>';
    
    try {
        // 실시간 랭킹 데이터 사용 (Firebase 읽기 없음)
        console.log(`📊 실시간 랭킹 데이터 사용: ${rankingData.length}개 캐릭터`);
        currentRankingPage = 1; // 페이지 초기화
        displayRankingDataWithPagination(rankingData);
        
    } catch (error) {
        console.error('Error loading ranking:', error);
        rankingList.innerHTML = '<p>랭킹을 불러오는 중 오류가 발생했습니다.</p>';
    }
}

// 페이지네이션이 적용된 랭킹 데이터 표시 함수
function displayRankingDataWithPagination(allRankingData) {
    if (allRankingData.length === 0) {
        rankingList.innerHTML = '<p>아직 배틀 기록이 없습니다.</p>';
        return;
    }
    
    const totalPages = Math.ceil(allRankingData.length / RANKING_ITEMS_PER_PAGE);
    const startIndex = (currentRankingPage - 1) * RANKING_ITEMS_PER_PAGE;
    const endIndex = startIndex + RANKING_ITEMS_PER_PAGE;
    const pageData = allRankingData.slice(startIndex, endIndex);
    
    console.log(`📄 랭킹 페이지 ${currentRankingPage}/${totalPages} (${pageData.length}개 항목)`);
    
    rankingList.innerHTML = '';
    
    // 페이지네이션 컨트롤 추가
    const paginationContainer = document.createElement('div');
    paginationContainer.className = 'ranking-pagination';
    paginationContainer.innerHTML = `
        <div class="pagination-info">
            <span>페이지 ${currentRankingPage} / ${totalPages} (총 ${allRankingData.length}개 캐릭터)</span>
        </div>
        <div class="pagination-controls">
            <button id="ranking-prev-btn" ${currentRankingPage === 1 ? 'disabled' : ''}>◀ 이전</button>
            <span class="page-numbers">
                ${generatePageNumbers(currentRankingPage, totalPages)}
            </span>
            <button id="ranking-next-btn" ${currentRankingPage === totalPages ? 'disabled' : ''}>다음 ▶</button>
        </div>
    `;
    
    rankingList.appendChild(paginationContainer);
    
    // 랭킹 아이템들 표시
    pageData.forEach((character, index) => {
        const globalRank = startIndex + index + 1;
        const rankingItem = document.createElement('div');
        rankingItem.className = 'ranking-item';
        
        // 캐릭터 이미지 URL 처리
        const imageUrl = character.imageUrl || 'https://placehold.co/60x60/333/FFF?text=?';
        
        rankingItem.innerHTML = `
            <div class="ranking-rank">#${globalRank}</div>
            <img src="${imageUrl}" alt="${character.name}" class="ranking-character-image" onerror="this.src='https://placehold.co/60x60/333/FFF?text=?'">
            <div class="ranking-info">
                <div class="ranking-name">${character.name}</div>
                <div class="ranking-class">${character.class}</div>
            </div>
            <div class="ranking-stats">${character.winRate}%<br>(<span class="wins">${character.wins || 0}승</span> <span class="losses">${character.losses || 0}패</span>)</div>
        `;
        
        rankingItem.onclick = () => showRankingCharacterDetails(character);
        rankingList.appendChild(rankingItem);
    });
    
    // 페이지네이션 이벤트 리스너 추가
    const prevBtn = document.getElementById('ranking-prev-btn');
    const nextBtn = document.getElementById('ranking-next-btn');
    
    if (prevBtn) {
        prevBtn.onclick = () => {
            if (currentRankingPage > 1) {
                currentRankingPage--;
                displayRankingDataWithPagination(allRankingData);
            }
        };
    }
    
    if (nextBtn) {
        nextBtn.onclick = () => {
            if (currentRankingPage < totalPages) {
                currentRankingPage++;
                displayRankingDataWithPagination(allRankingData);
            }
        };
    }
    
    // 페이지 번호 클릭 이벤트
    const pageNumberBtns = rankingList.querySelectorAll('.page-number-btn');
    pageNumberBtns.forEach(btn => {
        btn.onclick = () => {
            const pageNum = parseInt(btn.dataset.page);
            if (pageNum !== currentRankingPage) {
                currentRankingPage = pageNum;
                displayRankingDataWithPagination(allRankingData);
            }
        };
    });
}

// 페이지 번호 생성 함수
function generatePageNumbers(currentPage, totalPages) {
    let pageNumbers = '';
    const maxVisiblePages = 5;
    
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    
    // 끝 페이지가 조정되면 시작 페이지도 다시 조정
    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === currentPage ? 'active' : '';
        pageNumbers += `<button class="page-number-btn ${isActive}" data-page="${i}">${i}</button>`;
    }
    
    return pageNumbers;
}

// 기존 displayRankingData 함수는 호환성을 위해 유지
function displayRankingData(top10) {
    displayRankingDataWithPagination(top10);
}

function showRankingCharacterDetails(character) {
    try {
        // 페이지 상단으로 스크롤
        window.scrollTo(0, 0);
        
        // 실시간 데이터에서 최신 캐릭터 데이터 가져오기 (Firebase 읽기 없음)
        let fullCharacterData = character;
        
        // 실시간 캐릭터 풀에서 최신 데이터 조회
        const latestCharacter = allCharactersPool.find(char => char.name === character.name);
        if (latestCharacter) {
            fullCharacterData = { ...latestCharacter, ...character };
            console.log('실시간 데이터에서 최신 캐릭터 데이터 로드됨:', fullCharacterData);
        } else {
            console.warn('실시간 데이터에서 캐릭터를 찾을 수 없음, 기본 데이터 사용:', character.name);
        }
        
        // 디버깅: 캐릭터 데이터 확인
        console.log('최종 캐릭터 데이터:', fullCharacterData);
        console.log('공격 스킬:', fullCharacterData.attack_skills);
        console.log('방어 스킬:', fullCharacterData.defense_skills);
        
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
                                <span class="record-value"><span class="wins">${character.wins || 0}승</span> <span class="losses">${character.losses || 0}패</span></span>
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
    
    // 루나 소모 확인 및 처리 (1000 루나)
    const LUNA_COST = 1000;
    
    if (!currentUser) {
        alert('로그인이 필요합니다.');
        return;
    }
    
    try {
        // 현재 루나 잔액 확인
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
            alert('사용자 정보를 찾을 수 없습니다.');
            return;
        }
        
        const currentLuna = userDoc.data().luna || 0;
        
        if (currentLuna < LUNA_COST) {
            alert(`루나가 부족합니다. 필요: ${LUNA_COST} 루나, 보유: ${currentLuna} 루나`);
            return;
        }
        
        // 루나 소모 확인
        const confirmSpend = confirm(`전투 이미지 생성에 ${LUNA_COST} 루나가 소모됩니다. 계속하시겠습니까?`);
        if (!confirmSpend) {
            return;
        }
        
        // 루나 차감
        await updateDoc(userDocRef, {
            luna: currentLuna - LUNA_COST
        });
        
        console.log(`루나 ${LUNA_COST} 소모됨. 남은 루나: ${currentLuna - LUNA_COST}`);
        
        // 루나 표시 업데이트
        const lunaDisplay = document.getElementById('luna-amount');
        if (lunaDisplay) {
            lunaDisplay.textContent = (currentLuna - LUNA_COST).toLocaleString();
        }
        
    } catch (error) {
        console.error('루나 처리 중 오류:', error);
        alert('루나 처리 중 오류가 발생했습니다.');
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

    // 캐릭터의 강화 프롬프트 사용 (간결하게)
    const player1Appearance = player.image_prompt || player.appearance_prompt || 'fantasy character';
    const player2Appearance = opponent.image_prompt || opponent.appearance_prompt || 'fantasy character';
    
    console.log('캐릭터 강화 프롬프트:');
    console.log('플레이어:', player1Appearance);
    console.log('상대방:', player2Appearance);
    
    // 간결한 전투 이미지 프롬프트 생성 (3000자 제한 준수)
    const directBattlePrompt = `Epic fantasy battle scene: ${player.name} (${player1Appearance.substring(0, 200)}) vs ${opponent.name} (${player2Appearance.substring(0, 200)}). Dynamic combat pose, cinematic lighting, professional digital art, 16:9 aspect ratio.`.trim();

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
        console.log('Starting character migration for appearance_prompt and enhanced_prompt fields...');
        
        // 모든 캐릭터 조회
        const charactersQuery = query(collectionGroup(db, 'characters'));
        const charactersSnapshot = await getDocs(charactersQuery);
        
        let migratedCount = 0;
        const batch = writeBatch(db);
        
        charactersSnapshot.forEach((doc) => {
            const data = doc.data();
            
            // appearance_prompt 또는 enhanced_prompt 필드가 없고 image_prompt가 있는 경우 마이그레이션
            if ((!data.appearance_prompt || !data.enhanced_prompt) && data.image_prompt) {
                const updateData = {
                    migrated: true,
                    migratedAt: new Date().toISOString()
                };
                
                // appearance_prompt가 없으면 추가
                if (!data.appearance_prompt) {
                    updateData.appearance_prompt = data.image_prompt;
                }
                
                // enhanced_prompt가 없으면 생성해서 추가
                if (!data.enhanced_prompt) {
                    // 컨셉 정보가 있으면 사용, 없으면 빈 문자열
                    const conceptKeywords = data.concept ? getConceptKeywords(data.concept) : '';
                    updateData.enhanced_prompt = `${data.image_prompt}, ${conceptKeywords}, fantasy character portrait, ${data.class || 'fantasy character'}, high quality, detailed, digital art, concept art style, professional illustration, centered composition, dramatic lighting, vibrant colors, masterpiece quality, full body or portrait view`;
                }
                
                batch.update(doc.ref, updateData);
                migratedCount++;
                console.log(`Migrating character: ${data.name}`);
            }
        });
        
        if (migratedCount > 0) {
            await batch.commit();
            console.log(`Successfully migrated ${migratedCount} characters`);
            alert(`${migratedCount}개의 기존 캐릭터에 강화된 프롬프트 정보를 추가했습니다.`);
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
        
        // 현재 사용자의 루나 표시 업데이트
        const adminCurrentLuna = document.getElementById('admin-current-luna');
        if (adminCurrentLuna && currentUser) {
            adminCurrentLuna.textContent = userLuna;
        }
        
        // 모든 캐릭터 목록 로드
        await loadAllCharactersForAdmin();
        
        // 모든 사용자 목록 자동 로드
        const allUsers = await loadAllUsers();
        displaySearchResults(allUsers);
        
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
window.upgradeSkill = upgradeSkill;
window.addNewSkill = addNewSkill;

// --- EVENT LISTENERS ---
adminBtn.addEventListener('click', () => {
    const password = prompt('관리자 비밀번호를 입력하세요:');
    if (password === '4321') {
        showView('admin');
        loadAdminData();
    } else if (password !== null) {
        alert('비밀번호가 틀렸습니다.');
    }
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

// 루나 관리 시스템 이벤트 리스너들
let selectedUserId = null;
let selectedUserData = null;

// 사용자 검색 버튼
const searchUsersBtn = document.getElementById('search-users-btn');
if (searchUsersBtn) {
    console.log('사용자 검색 버튼 이벤트 리스너 추가됨');
    searchUsersBtn.addEventListener('click', async () => {
        console.log('사용자 검색 버튼 클릭됨');
        const searchInput = document.getElementById('user-search-input');
        const searchTerm = searchInput.value.trim();
        console.log('검색어:', searchTerm);
        
        const users = await searchUsers(searchTerm);
        console.log('검색 결과:', users);
        displaySearchResults(users);
    });
} else {
    console.error('사용자 검색 버튼을 찾을 수 없습니다: search-users-btn');
}

// 검색 입력창에서 엔터키 처리
const userSearchInput = document.getElementById('user-search-input');
if (userSearchInput) {
    console.log('사용자 검색 입력창 이벤트 리스너 추가됨');
    userSearchInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            console.log('엔터키 눌림, 검색 시작');
            const searchTerm = e.target.value.trim();
            console.log('검색어:', searchTerm);
            const users = await searchUsers(searchTerm);
            console.log('검색 결과:', users);
            displaySearchResults(users);
        }
    });
} else {
    console.error('사용자 검색 입력창을 찾을 수 없습니다: user-search-input');
}

// 루나 추가 버튼
const addLunaBtn = document.getElementById('add-luna-btn');
addLunaBtn.addEventListener('click', async () => {
    if (!selectedUserId) {
        alert('먼저 사용자를 선택해주세요.');
        return;
    }
    
    const amountInput = document.getElementById('luna-amount-input');
    const amount = parseInt(amountInput.value);
    
    if (!amount || amount <= 0) {
        alert('올바른 루나 수량을 입력해주세요.');
        return;
    }
    
    await manageLuna(selectedUserId, amount, 'add');
});

// 루나 감소 버튼
const subtractLunaBtn = document.getElementById('subtract-luna-btn');
subtractLunaBtn.addEventListener('click', async () => {
    if (!selectedUserId) {
        alert('먼저 사용자를 선택해주세요.');
        return;
    }
    
    const amountInput = document.getElementById('luna-amount-input');
    const amount = parseInt(amountInput.value);
    
    if (!amount || amount <= 0) {
        alert('올바른 루나 수량을 입력해주세요.');
        return;
    }
    
    await manageLuna(selectedUserId, amount, 'subtract');
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

// backToMatchingBtn 제거됨 - 더 이상 사용하지 않음

// 소설 로그에서 캐릭터 카드로 돌아가기 (기존 기능 유지)
const backToCardsFromNovelBtn = document.getElementById('back-to-cards-from-novel-btn');
if (backToCardsFromNovelBtn) {
    backToCardsFromNovelBtn.addEventListener('click', () => {
        novelLogModal.classList.add('hidden');
        showView('character-cards');
    });
}

// ------------------------------------------------------------------
// 루나 시스템 관련 함수들
// ------------------------------------------------------------------

// 루나 잔액 업데이트 함수
function updateLunaDisplay() {
    const lunaAmountElement = document.getElementById('luna-amount');
    if (lunaAmountElement) {
        lunaAmountElement.textContent = userLuna;
    }
}

// 루나 잔액 로드 함수
async function loadUserLuna() {
    if (!currentUser) return;
    
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            userLuna = userData.luna || 0;
        } else {
            userLuna = 0;
        }
        updateLunaDisplay();
    } catch (error) {
        console.error('Error loading user luna:', error);
        userLuna = 0;
        updateLunaDisplay();
    }
}

// 루나 잔액 저장 함수
async function saveUserLuna() {
    if (!currentUser) return;
    
    try {
        await setDoc(doc(db, 'users', currentUser.uid), {
            luna: userLuna
        }, { merge: true });
    } catch (error) {
        console.error('Error saving user luna:', error);
    }
}

// 루나 추가 함수 (전투 승리 시 호출)
async function addLuna(amount) {
    userLuna += amount;
    updateLunaDisplay();
    await saveUserLuna();
}

// 캐릭터 소유자에게 루나 지급 함수 (오프라인 사용자 포함)
async function awardLunaToCharacterOwner(characterId) {
    try {
        console.log('=== 루나 지급 시작 ===');
        console.log('awardLunaToCharacterOwner 시작 - characterId:', characterId);
        console.log('characterId 타입:', typeof characterId);
        
        // 캐릭터의 소유자 찾기
        console.log('findCharacterRef 호출 중...');
        const characterRef = await findCharacterRef(characterId);
        console.log('findCharacterRef 결과:', characterRef);
        
        if (!characterRef) {
            console.log('❌ 캐릭터를 찾을 수 없습니다:', characterId);
            return;
        }
        
        console.log('캐릭터 문서 가져오는 중...');
        const characterDoc = await getDoc(characterRef);
        console.log('캐릭터 문서 존재 여부:', characterDoc.exists());
        
        if (!characterDoc.exists()) {
            console.log('❌ 캐릭터 문서가 존재하지 않습니다:', characterId);
            return;
        }
        
        const characterData = characterDoc.data();
        console.log('캐릭터 데이터:', characterData);
        
        const ownerId = characterData.createdBy;
        console.log('캐릭터 소유자 ID:', ownerId);
        
        if (!ownerId) {
            console.log('❌ 캐릭터 소유자 정보가 없습니다:', characterId);
            console.log('캐릭터 데이터 전체:', JSON.stringify(characterData, null, 2));
            return;
        }
        
        console.log('✅ 캐릭터 소유자 찾음:', ownerId);
        
        // 소유자의 루나 정보 가져오기
        console.log('사용자 루나 정보 가져오는 중...');
        const userRef = doc(db, 'users', ownerId);
        const userDoc = await getDoc(userRef);
        console.log('사용자 문서 존재 여부:', userDoc.exists());
        
        let currentLuna = 0;
        if (userDoc.exists()) {
            const userData = userDoc.data();
            currentLuna = userData.luna || 0;
            console.log('현재 사용자 데이터:', userData);
        } else {
            console.log('사용자 문서가 존재하지 않음, 새로 생성됩니다.');
        }
        
        console.log('현재 루나:', currentLuna);
        
        // 루나 1개 추가
        const newLuna = currentLuna + 1;
        console.log('새 루나 값:', newLuna);
        
        // 사용자 문서에 루나 업데이트
        console.log('Firebase에 루나 업데이트 중...');
        await setDoc(userRef, {
            luna: newLuna
        }, { merge: true });
        
        console.log(`✅ 캐릭터 소유자 ${ownerId}에게 루나 1개 지급 완료 (${currentLuna} -> ${newLuna})`);
        
        // 현재 로그인한 사용자가 루나를 받은 경우 UI 업데이트 및 알림 표시
        if (currentUser && currentUser.uid === ownerId) {
            console.log('현재 로그인한 사용자가 루나를 받았습니다. UI 업데이트 중...');
            userLuna = newLuna;
            updateLunaDisplay();
            
            // 루나 지급 알림 표시
            console.log('showLunaRewardNotification 함수 호출 시작');
            try {
                showLunaRewardNotification();
                console.log('showLunaRewardNotification 함수 호출 완료');
            } catch (error) {
                console.error('showLunaRewardNotification 함수 호출 중 오류:', error);
            }
            
            console.log('✅ 현재 사용자의 루나 UI 업데이트 및 알림 표시 완료');
        } else {
            console.log('다른 사용자가 루나를 받았습니다. 현재 사용자:', currentUser?.uid, '루나 받은 사용자:', ownerId);
        }
        
        console.log('=== 루나 지급 완료 ===');
        
    } catch (error) {
        console.error('❌ 캐릭터 소유자에게 루나 지급 중 오류:', error);
        console.error('오류 스택:', error.stack);
    }
}

// 루나 지급 알림 표시 함수
function showLunaRewardNotification() {
    // 기존 알림이 있다면 제거
    const existingNotification = document.querySelector('.luna-reward-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // 알림 요소 생성
    const notification = document.createElement('div');
    notification.className = 'luna-reward-notification';
    notification.innerHTML = `
        <div class="notification-content">
            <div class="notification-icon">🌙</div>
            <div class="notification-text">
                <h3>전투 승리!</h3>
                <p>루나 1개를 획득했습니다!</p>
            </div>
            <button class="notification-close" onclick="this.parentElement.parentElement.remove()">&times;</button>
        </div>
    `;
    
    // 스타일 적용
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 0;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        animation: slideInRight 0.5s ease-out;
        max-width: 350px;
        overflow: hidden;
    `;
    
    // 내부 콘텐츠 스타일
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        .luna-reward-notification .notification-content {
            display: flex;
            align-items: center;
            padding: 16px;
            gap: 12px;
        }
        
        .luna-reward-notification .notification-icon {
            font-size: 32px;
            flex-shrink: 0;
        }
        
        .luna-reward-notification .notification-text h3 {
            margin: 0 0 4px 0;
            font-size: 16px;
            font-weight: bold;
        }
        
        .luna-reward-notification .notification-text p {
            margin: 0;
            font-size: 14px;
            opacity: 0.9;
        }
        
        .luna-reward-notification .notification-close {
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
            padding: 4px;
            margin-left: auto;
            opacity: 0.7;
            transition: opacity 0.2s;
        }
        
        .luna-reward-notification .notification-close:hover {
            opacity: 1;
        }
    `;
    
    // 스타일과 알림을 DOM에 추가
    document.head.appendChild(style);
    document.body.appendChild(notification);
    
    // 5초 후 자동으로 제거
    setTimeout(() => {
        if (notification && notification.parentElement) {
            notification.style.animation = 'slideInRight 0.5s ease-out reverse';
            setTimeout(() => {
                if (notification && notification.parentElement) {
                    notification.remove();
                }
            }, 500);
        }
    }, 5000);
    
    console.log('루나 지급 알림이 표시되었습니다.');
}

// 루나 차감 함수 (스킬 업그레이드/추가 시 호출)
async function spendLuna(amount) {
    console.log('=== spendLuna 시작 ===');
    console.log('차감할 amount:', amount);
    console.log('현재 userLuna:', userLuna);
    console.log('userLuna >= amount:', userLuna >= amount);
    
    if (userLuna >= amount) {
        console.log('루나 차감 진행');
        userLuna -= amount;
        console.log('차감 후 userLuna:', userLuna);
        
        console.log('updateLunaDisplay 호출');
        updateLunaDisplay();
        
        console.log('saveUserLuna 호출');
        await saveUserLuna();
        console.log('saveUserLuna 완료');
        
        console.log('spendLuna 성공 반환');
        return true;
    }
    
    console.log('루나 부족으로 spendLuna 실패');
    return false;
}

// 캐릭터 슬롯 확장 함수
window.expandCharacterSlot = async function() {
    console.log('=== 캐릭터 슬롯 확장 시작 ===');
    
    if (!currentUser) {
        alert('로그인이 필요합니다.');
        return;
    }
    
    const SLOT_EXPANSION_COST = 50;
    
    try {
        // 현재 사용자 정보 확인
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
            alert('사용자 정보를 찾을 수 없습니다.');
            return;
        }
        
        const userData = userDoc.data();
        const currentLuna = userData.luna || 0;
        const currentMaxSlots = userData.maxCharacterSlots || 4;
        
        // 루나 부족 확인
        if (currentLuna < SLOT_EXPANSION_COST) {
            alert(`루나가 부족합니다. 필요: ${SLOT_EXPANSION_COST} 루나, 보유: ${currentLuna} 루나`);
            return;
        }
        
        // 확인 다이얼로그
        const confirmMessage = `${SLOT_EXPANSION_COST}루나를 소모하여 캐릭터 슬롯을 1개 확장하시겠습니까?\n현재 슬롯: ${currentMaxSlots}개 → ${currentMaxSlots + 1}개`;
        if (!confirm(confirmMessage)) {
            return;
        }
        
        // 루나 차감 및 슬롯 확장
        await updateDoc(userDocRef, {
            luna: currentLuna - SLOT_EXPANSION_COST,
            maxCharacterSlots: currentMaxSlots + 1
        });
        
        // 로컬 상태 업데이트
        userLuna = currentLuna - SLOT_EXPANSION_COST;
        updateLunaDisplay();
        
        alert(`슬롯 확장 완료! 새로운 슬롯 수: ${currentMaxSlots + 1}개`);
        
        // UI 새로고침 - 실시간 리스너가 자동으로 업데이트하므로 별도 호출 불필요
        // 하지만 즉시 반영을 위해 현재 캐릭터 목록을 다시 표시
        if (!characterCardsSection.classList.contains('hidden')) {
            displayUserCharacters(userCharactersPool);
        }
        
        console.log('=== 캐릭터 슬롯 확장 완료 ===');
        
    } catch (error) {
        console.error('슬롯 확장 오류:', error);
        alert('슬롯 확장 중 오류가 발생했습니다.');
    }
};

// 스킬 업그레이드 함수
async function upgradeSkill(characterId, skillType, skillIndex) {
    console.log('🔧 [DEBUG] upgradeSkill 시작:', { characterId, skillType, skillIndex });
    
    const cost = 50;
    
    console.log('🔧 [DEBUG] Luna 확인:', { userLuna, cost });
    if (userLuna < cost) {
        console.log('🔧 [DEBUG] Luna 부족으로 중단');
        alert(`스킬 업그레이드\n\n루나가 부족합니다. 필요한 루나: ${cost}, 보유 루나: ${userLuna}`);
        return;
    }
    
    // 로딩 스피너 표시
    console.log('🔧 [DEBUG] 로딩 스피너 표시');
    const spinner = showLoadingSpinner('스킬을 업그레이드하고 있습니다...');
    
    try {
        // 캐릭터 데이터 가져오기
        console.log('🔧 [DEBUG] 캐릭터 데이터 가져오기 시도:', { currentUserUid: currentUser.uid, characterId });
        const characterRef = doc(db, 'users', currentUser.uid, 'characters', characterId);
        const characterDoc = await getDoc(characterRef);
        console.log('🔧 [DEBUG] characterDoc 결과:', { exists: characterDoc.exists() });
        
        if (!characterDoc.exists()) {
            console.error('🔧 [DEBUG] 캐릭터 문서가 존재하지 않음');
            hideLoadingSpinner(spinner);
            alert('캐릭터를 찾을 수 없습니다.');
            return;
        }
        
        const characterData = characterDoc.data();
        console.log('🔧 [DEBUG] 캐릭터 데이터:', characterData);
        
        const skillsField = skillType === 'attack' ? 'attack_skills' : 'defense_skills';
        const skills = characterData[skillsField];
        console.log('🔧 [DEBUG] 스킬 정보:', { skillsField, skills, skillIndex });
        
        if (!skills || !skills[skillIndex]) {
            console.error('🔧 [DEBUG] 스킬을 찾을 수 없음:', { skills, skillIndex });
            hideLoadingSpinner(spinner);
            alert('스킬을 찾을 수 없습니다.');
            return;
        }
        
        const originalSkill = skills[skillIndex];
        console.log('🔧 [DEBUG] 원본 스킬:', originalSkill);
        
        // AI로 업그레이드된 스킬 생성
        console.log('🔧 [DEBUG] AI 스킬 업그레이드 생성 시작');
        const upgradedSkill = await generateUpgradedSkill(originalSkill, characterData);
        console.log('🔧 [DEBUG] 업그레이드된 스킬:', upgradedSkill);
        
        hideLoadingSpinner(spinner);
        
        if (!upgradedSkill) {
            console.error('🔧 [DEBUG] 스킬 업그레이드 생성 실패');
            alert('스킬 업그레이드 생성에 실패했습니다.');
            return;
        }
        
        // 사용자에게 확인 요청
        console.log('🔧 [DEBUG] 사용자 확인 모달 표시');
        const confirmed = await showSkillUpgradeModal(originalSkill, upgradedSkill, cost);
        console.log('🔧 [DEBUG] 사용자 확인 결과:', confirmed);
        
        if (confirmed) {
            console.log('🔧 [DEBUG] 사용자가 확인함 - 업그레이드 진행');
            
            // 루나 차감
            console.log('🔧 [DEBUG] Luna 차감 시작');
            await spendLuna(cost);
            console.log('🔧 [DEBUG] Luna 차감 완료, 새로운 Luna:', userLuna);
            
            // 스킬 업데이트
            console.log('🔧 [DEBUG] 스킬 업데이트 시작');
            skills[skillIndex] = upgradedSkill;
            console.log('🔧 [DEBUG] 업데이트할 데이터:', { [skillsField]: skills });
            
            await updateDoc(characterRef, {
                [skillsField]: skills
            });
            console.log('🔧 [DEBUG] Firebase 업데이트 완료');
            
            alert('스킬이 성공적으로 업그레이드되었습니다!');
            
            // 캐릭터 상세 화면 새로고침
            console.log('🔧 [DEBUG] 캐릭터 상세 화면 새로고침 시작');
            const updatedCharacterData = {
                ...characterData,
                id: characterId,
                [skillsField]: skills
            };
            console.log('🔧 [DEBUG] 업데이트된 캐릭터 데이터:', updatedCharacterData);
            showCharacterDetail(updatedCharacterData);
            console.log('🔧 [DEBUG] upgradeSkill 완료');
        } else {
            console.log('🔧 [DEBUG] 사용자가 취소함');
        }
        
    } catch (error) {
        console.error('🔧 [DEBUG] 스킬 업그레이드 오류:', error);
        console.error('🔧 [DEBUG] 오류 스택:', error.stack);
        hideLoadingSpinner(spinner);
        alert('스킬 업그레이드 중 오류가 발생했습니다.');
    }
}

// 새 스킬 추가 함수
async function addNewSkill(characterId, skillType) {
    const cost = 100;
    
    console.log('=== addNewSkill 시작 ===');
    console.log('characterId:', characterId);
    console.log('skillType:', skillType);
    console.log('현재 userLuna:', userLuna);
    console.log('필요한 cost:', cost);
    
    if (userLuna < cost) {
        console.log('루나 부족으로 함수 종료');
        alert(`새로운 스킬추가\n\n루나가 부족합니다. 필요한 루나: ${cost}, 보유 루나: ${userLuna}`);
        return;
    }
    
    const confirmed = confirm(`${cost} 루나를 사용하여 새로운 ${skillType === 'attack' ? '공격' : '방어'} 스킬을 추가하시겠습니까?`);
    console.log('초기 확인 결과:', confirmed);
    
    if (!confirmed) {
        console.log('사용자가 초기 확인을 취소함');
        return;
    }
    
    // 로딩 스피너 표시
    const spinner = showLoadingSpinner('새로운 스킬을 생성하고 있습니다...');
    console.log('로딩 스피너 표시됨');
    
    try {
        // 캐릭터 데이터 가져오기
        console.log('캐릭터 데이터 가져오기 시작');
        console.log('currentUser:', currentUser);
        console.log('currentUser.uid:', currentUser?.uid);
        
        const characterRef = doc(db, 'users', currentUser.uid, 'characters', characterId);
        console.log('characterRef 생성됨');
        
        const characterDoc = await getDoc(characterRef);
        console.log('characterDoc 가져옴:', characterDoc.exists());
        
        if (!characterDoc.exists()) {
            console.log('캐릭터 문서가 존재하지 않음');
            hideLoadingSpinner(spinner);
            alert('캐릭터를 찾을 수 없습니다.');
            return;
        }
        
        const characterData = characterDoc.data();
        console.log('캐릭터 데이터:', characterData);
        console.log('기존 attack_skills:', characterData.attack_skills);
        console.log('기존 defense_skills:', characterData.defense_skills);
        
        // AI로 새 스킬 생성
        console.log('AI 스킬 생성 시작');
        const newSkill = await generateNewSkill(skillType, characterData);
        console.log('생성된 새로운 스킬:', newSkill);
        
        hideLoadingSpinner(spinner);
        console.log('로딩 스피너 숨김');
        
        if (!newSkill) {
            console.log('스킬 생성 실패');
            alert('새 스킬 생성에 실패했습니다.');
            return;
        }
        
        // 사용자에게 확인 요청
        console.log('🔍 DEBUG: 사용자 확인 모달 표시 시작');
        console.log('🔍 DEBUG: showNewSkillModal에 전달할 newSkill:', newSkill);
        console.log('🔍 DEBUG: showNewSkillModal에 전달할 cost:', cost);
        const skillConfirmed = await showNewSkillModal(newSkill, cost);
        console.log('🔍 DEBUG: 사용자 스킬 확인 결과:', skillConfirmed);
        
        if (skillConfirmed) {
            console.log('사용자가 스킬을 확인함 - 루나 차감 및 스킬 추가 진행');
            
            // 루나 차감
            console.log('루나 차감 시작, 현재 루나:', userLuna);
            await spendLuna(cost);
            console.log('루나 차감 완료, 새 루나:', userLuna);
            
            // 스킬 추가 (올바른 필드명 사용)
            const skillsField = skillType === 'attack' ? 'attack_skills' : 'defense_skills';
            console.log('사용할 스킬 필드:', skillsField);
            
            const currentSkills = characterData[skillsField] || [];
            console.log('현재 스킬 목록:', currentSkills);
            console.log('현재 스킬 개수:', currentSkills.length);
            
            currentSkills.push(newSkill);
            console.log('새 스킬 추가 후 목록:', currentSkills);
            console.log('새 스킬 추가 후 개수:', currentSkills.length);
            
            console.log('Firebase 업데이트 시작');
            console.log('업데이트할 데이터:', { [skillsField]: currentSkills });
            
            await updateDoc(characterRef, {
                [skillsField]: currentSkills
            });
            console.log('Firebase 업데이트 완료');
            
            alert('새 스킬이 성공적으로 추가되었습니다!');
            
            // 캐릭터 상세 화면 새로고침
            console.log('🔍 DEBUG: 캐릭터 상세 화면 새로고침 시작');
            console.log('🔍 DEBUG: 업데이트된 스킬 필드:', skillsField);
            console.log('🔍 DEBUG: 업데이트된 스킬 목록:', currentSkills);
            
            // 매칭 관련 변수 초기화 (스킬이 화면 하단에 표시되는 것을 방지)
            console.log('🔍 DEBUG: 매칭 관련 변수 초기화');
            const previousPlayerCharacter = playerCharacterForBattle;
            playerCharacterForBattle = null;
            opponentCharacterForBattle = null;
            selectedSkills = [];
            
            // 업데이트된 캐릭터 데이터로 상세 화면 새로고침
            const updatedCharacterData = {
                ...characterData,
                id: characterId,
                [skillsField]: currentSkills
            };
            console.log('🔍 DEBUG: showCharacterDetail 호출 전 - 업데이트된 캐릭터 데이터:', updatedCharacterData);
            showCharacterDetail(updatedCharacterData);
            console.log('🔍 DEBUG: showCharacterDetail 호출 완료');
            
            // 매칭 관련 UI 요소들 숨기기
            console.log('🔍 DEBUG: 매칭 관련 UI 요소 숨기기');
            const skillChoicesContainer = document.getElementById('skill-choices');
            const matchedSkillChoices = document.getElementById('matched-skill-choices');
            const skillSelectionContainer = document.getElementById('skill-selection-container');
            
            if (skillChoicesContainer) {
                console.log('🔍 DEBUG: skillChoicesContainer 숨김');
                skillChoicesContainer.innerHTML = '';
                skillChoicesContainer.style.display = 'none';
            }
            if (matchedSkillChoices) {
                console.log('🔍 DEBUG: matchedSkillChoices 숨김');
                matchedSkillChoices.innerHTML = '';
                matchedSkillChoices.style.display = 'none';
            }
            if (skillSelectionContainer) {
                console.log('🔍 DEBUG: skillSelectionContainer 숨김');
                skillSelectionContainer.classList.add('hidden');
            }
        } else {
            console.log('사용자가 스킬 확인을 취소함');
        }
        
    } catch (error) {
        hideLoadingSpinner(spinner);
        console.error('Error adding new skill:', error);
        console.error('Error stack:', error.stack);
        alert('새 스킬 추가 중 오류가 발생했습니다.');
    }
    
    console.log('=== addNewSkill 종료 ===');
}

// AI로 업그레이드된 스킬 생성
async function generateUpgradedSkill(originalSkill, characterData) {
    console.log('🔧 [DEBUG] generateUpgradedSkill 시작:', { originalSkill, characterData });
    
    const prompt = `다음 캐릭터의 스킬을 한 단계 업그레이드해주세요.

캐릭터 정보:
- 이름: ${characterData.name}
- 컨셉: ${characterData.concept}
- 스토리: ${characterData.story}

업그레이드할 원본 스킬:
- 이름: ${originalSkill.name}
- 설명: ${originalSkill.description}

업그레이드 요구사항:
1. 원본 스킬의 핵심 컨셉과 테마를 유지하면서 다음 4가지 진화 방향 중 하나를 무작위로 선택하여 업그레이드해주세요:
   - 분화형: 원본 능력을 특정 상황에 특화시켜 극도로 강력하게 만들되, 다른 상황에서는 취약점 노출
   - 융합형: 원본 능력과 다른 요소(마력, 감정, 환경 등)를 융합하여 새로운 복합 효과 창조
   - 확장형: 원본 능력의 범위나 대상을 확장하여 광역 또는 다중 효과로 발전
   - 변이형: 원본 능력의 핵심은 유지하되 완전히 다른 형태나 활용법으로 변화

2. 스킬 이름은 단순히 "슈퍼", "강화된", "상급" 등의 접두사를 붙이지 말고, 진화 방향에 맞는 창의적이고 독특한 이름으로 변경해주세요

3. 설명은 정확히 2문장으로 작성하되, 기존 스킬 설명과 비슷한 길이를 유지하세요

4. 진화된 강력한 효과를 명확하고 흥미롭게 설명해주세요

5. 기존 스킬의 핵심 컨셉은 반드시 유지하되, 선택한 진화 방향에 따라 독창적이고 다양한 발전 양상을 보여주세요

6. 예시:
   - 분화형: "복제의 방패" → "선택적 흡수막" (특정 속성만 선별 흡수하여 극강 방어)
   - 융합형: "복제의 방패" → "반사 증폭막" (흡수 + 마력 융합으로 증폭 반격)
   - 확장형: "복제의 방패" → "집단 보호막" (개인 → 팀 전체 보호로 확장)
   - 변이형: "복제의 방패" → "에너지 변환로" (방어 → 다양한 보조 능력으로 변환)

다음 JSON 형식으로만 응답해주세요:
{
  "name": "업그레이드된 스킬 이름 (창의적이고 진화 방향을 반영한 이름)",
  "description": "업그레이드된 스킬 설명 (자연스러운 길이, 강력한 효과 중심)"
}`;
    
    console.log('🔧 [DEBUG] AI 프롬프트 생성 완료, generateWithFallback 호출');
    
    try {
        const result = await generateWithFallback(prompt);
        console.log('🔧 [DEBUG] generateWithFallback 결과:', result);
        
        const responseText = result.response ? result.response.text() : result;
        console.log('🔧 [DEBUG] AI 응답 텍스트:', responseText);
        
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        console.log('🔧 [DEBUG] JSON 매치 결과:', jsonMatch);
        
        if (jsonMatch) {
            const skillData = JSON.parse(jsonMatch[0]);
            console.log('🔧 [DEBUG] 파싱된 스킬 데이터:', skillData);
            
            const finalSkill = {
                name: skillData.name,
                description: skillData.description
            };
            console.log('🔧 [DEBUG] 최종 반환할 스킬:', finalSkill);
            return finalSkill;
        } else {
            console.error('🔧 [DEBUG] JSON 매치 실패');
        }
    } catch (error) {
        console.error('🔧 [DEBUG] generateUpgradedSkill 오류:', error);
        console.error('🔧 [DEBUG] 오류 스택:', error.stack);
    }
    
    console.log('🔧 [DEBUG] generateUpgradedSkill null 반환');
    return null;
}

// AI로 새 스킬 생성
async function generateNewSkill(skillType, characterData) {
    const prompt = `다음 캐릭터에게 새로운 ${skillType === 'attack' ? '공격' : '방어'} 스킬을 만들어주세요.

캐릭터 정보:
- 이름: ${characterData.name}
- 컨셉: ${characterData.concept}
- 스토리: ${characterData.story}

기존 ${skillType === 'attack' ? '공격' : '방어'} 스킬들:
${((skillType === 'attack' ? characterData.attackSkills : characterData.defenseSkills) || []).map(skill => `- ${skill.name}: ${skill.description}`).join('\n')}

새 스킬 요구사항:
1. 캐릭터의 컨셉과 스토리에 맞는 ${skillType === 'attack' ? '공격' : '방어'} 스킬을 만들어주세요
2. 기존 스킬들과 중복되지 않는 독특한 스킬을 만들어주세요
3. 스킬 이름과 설명은 창의적이고 흥미롭게 작성해주세요
4. 설명은 정확히 2문장으로 작성하되, 자연스럽고 적절한 길이로 작성하세요
5. 스킬의 효과와 특징을 명확하고 흥미롭게 설명해주세요
6. 예시: "상대방의 약점이나 감정의 동요를 읽어내어 심리적인 압박을 가하거나, 혼란을 야기하는 강력한 정신 공격 스킬입니다."

다음 JSON 형식으로만 응답해주세요:
{
  "name": "새 스킬 이름",
  "description": "새 스킬 설명 (자연스러운 길이, 강력한 효과 중심)"
}`;
    
    try {
        const result = await generateWithFallback(prompt);
        const responseText = result.response ? result.response.text() : result;
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
            const skillData = JSON.parse(jsonMatch[0]);
            console.log('🔍 DEBUG: generateNewSkill - 생성된 스킬 데이터:', skillData);
            const finalSkill = {
                name: skillData.name,
                description: skillData.description
            };
            console.log('🔍 DEBUG: generateNewSkill - 최종 반환할 스킬:', finalSkill);
            return finalSkill;
        }
    } catch (error) {
        console.error('Error generating new skill:', error);
    }
    
    return null;
}

// 스킬 업그레이드 확인 모달
function showSkillUpgradeModal(originalSkill, upgradedSkill, cost) {
    console.log('🔧 [DEBUG] showSkillUpgradeModal 시작:', { originalSkill, upgradedSkill, cost });
    
    return new Promise((resolve) => {
        console.log('🔧 [DEBUG] Promise 생성, 모달 HTML 생성 시작');
        
        const modal = document.createElement('div');
        modal.className = 'skill-upgrade-modal';
        modal.innerHTML = `
            <div class="skill-upgrade-modal-content">
                <h3>🔮 스킬 업그레이드</h3>
                <div class="skill-comparison">
                    <div class="original-skill">
                        <h4>현재 스킬</h4>
                        <div class="skill-info">
                            <strong>${originalSkill.name}</strong>
                            <p>${originalSkill.description}</p>
                        </div>
                    </div>
                    <div class="arrow">➡️</div>
                    <div class="upgraded-skill">
                        <h4>업그레이드된 스킬</h4>
                        <div class="skill-info">
                            <strong>${upgradedSkill.name}</strong>
                            <p>${upgradedSkill.description}</p>
                        </div>
                    </div>
                </div>
                <div class="cost-info">
                    <p>💰 비용: ${cost} 루나</p>
                </div>
                <div class="modal-buttons">
                    <button class="cancel-btn" onclick="closeSkillUpgradeModal(false)">취소</button>
                    <button class="confirm-btn" onclick="closeSkillUpgradeModal(true)">업그레이드</button>
                </div>
            </div>
        `;
        
        console.log('🔧 [DEBUG] 모달 HTML 생성 완료, DOM에 추가');
        document.body.appendChild(modal);
        console.log('🔧 [DEBUG] 모달이 DOM에 추가됨');
        
        window.closeSkillUpgradeModal = (confirmed) => {
            console.log('🔧 [DEBUG] closeSkillUpgradeModal 호출됨, confirmed:', confirmed);
            modal.remove();
            delete window.closeSkillUpgradeModal;
            console.log('🔧 [DEBUG] 모달 제거 완료, Promise resolve 호출');
            resolve(confirmed);
        };
        
        // 모달 외부 클릭 시 취소
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                console.log('🔧 [DEBUG] 모달 외부 클릭으로 취소');
                window.closeSkillUpgradeModal(false);
            }
        });
        
        console.log('🔧 [DEBUG] 모달 이벤트 리스너 설정 완료');
    });
}



// 새 스킬 확인 모달
function showNewSkillModal(newSkill, cost) {
    console.log('🔍 showNewSkillModal called with:', { newSkill, cost });
    return new Promise((resolve) => {
        console.log('🔍 Creating new skill modal...');
        const modal = document.createElement('div');
        modal.className = 'new-skill-modal';
        modal.innerHTML = `
            <div class="new-skill-modal-content">
                <h3>✨ 새 스킬 추가</h3>
                <div class="new-skill-preview">
                    <div class="skill-info">
                        <strong>${newSkill.name}</strong>
                        <p>${newSkill.description}</p>

                    </div>
                </div>
                <div class="cost-info">
                    <p>💰 비용: ${cost} 루나</p>
                </div>
                <div class="modal-buttons">
                    <button class="cancel-btn" onclick="closeNewSkillModal(false)">취소</button>
                    <button class="confirm-btn" onclick="closeNewSkillModal(true)">추가</button>
                </div>
            </div>
        `;
        
        console.log('🔍 Appending modal to document body...');
        document.body.appendChild(modal);
        console.log('🔍 Modal appended successfully');
        
        window.closeNewSkillModal = (confirmed) => {
            console.log('🔍 closeNewSkillModal called with confirmed:', confirmed);
            modal.remove();
            delete window.closeNewSkillModal;
            console.log('🔍 Resolving promise with:', confirmed);
            resolve(confirmed);
        };
        
        // 모달 외부 클릭 시 취소
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                console.log('🔍 Modal background clicked, closing with false');
                window.closeNewSkillModal(false);
            }
        });
    });
}

// 앱 초기화 시 루나 디스플레이 설정
function initializeLunaDisplay() {
    const lunaDisplay = document.getElementById('luna-display');
    if (lunaDisplay && currentUser) {
        lunaDisplay.classList.remove('hidden');
        updateLunaDisplay();
    }
}

// 로딩 스피너 표시 함수
function showLoadingSpinner(message = '로딩 중...') {
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner-overlay';
    spinner.innerHTML = `
        <div class="loading-spinner-content">
            <div class="spinner"></div>
            <p class="loading-message">${message}</p>
        </div>
    `;
    
    document.body.appendChild(spinner);
    return spinner;
}

// 로딩 스피너 숨기기 함수
function hideLoadingSpinner(spinner) {
    if (spinner && spinner.parentNode) {
        spinner.parentNode.removeChild(spinner);
    }
}

// 모든 사용자 로드 함수
async function loadAllUsers() {
    console.log('loadAllUsers 함수 호출됨');
    try {
        const usersRef = collection(db, 'users');
        const querySnapshot = await getDocs(usersRef);
        const users = [];
        
        console.log('사용자 문서 수:', querySnapshot.size);
        
        querySnapshot.forEach((doc) => {
            const userData = doc.data();
            console.log('사용자 데이터:', doc.id, userData);
            
            // userId가 있는 경우 그대로 사용, 없는 경우 uid 사용
            let displayUserId = userData.userId;
            if (!displayUserId && userData.uid) {
                displayUserId = userData.uid;
            }
            if (!displayUserId) {
                displayUserId = doc.id; // 마지막 대안으로 문서 ID 사용
            }
            
            users.push({
                id: doc.id,
                userId: displayUserId,
                originalUserId: userData.userId, // 원본 사용자 아이디 저장
                email: userData.email, // 이메일 정보도 포함
                luna: userData.luna || 0
            });
        });
        
        // 사용자 아이디 순으로 정렬
        users.sort((a, b) => a.userId.localeCompare(b.userId));
        console.log('로드된 사용자 목록:', users);
        return users;
    } catch (error) {
        console.error('사용자 로드 오류:', error);
        return [];
    }
}

// 사용자 검색 함수
async function searchUsers(searchTerm) {
    console.log('searchUsers 함수 호출됨, 검색어:', searchTerm);
    const allUsers = await loadAllUsers();
    console.log('전체 사용자 수:', allUsers.length);
    
    if (!searchTerm || searchTerm.trim() === '') {
        console.log('검색어가 없어서 모든 사용자 반환');
        return allUsers; // 검색어가 없으면 모든 사용자 반환
    }
    
    // 검색어로 필터링 - userId가 있는 경우와 이메일로 매칭하는 경우 모두 처리
    const searchResults = [];
    
    for (const user of allUsers) {
        console.log('사용자 검사 중:', user);
        
        // 1. userId가 있고 검색어와 매칭되는 경우
        if (user.originalUserId && user.originalUserId.toLowerCase().includes(searchTerm.toLowerCase())) {
            console.log('originalUserId로 매칭됨:', user.originalUserId);
            searchResults.push(user);
            continue;
        }
        
        // 2. 기존 사용자들을 위해 검색어를 해시화해서 이메일과 매칭
        try {
            const searchEmail = await createEmailFromId(searchTerm);
            console.log('검색어로 생성된 이메일:', searchEmail);
            console.log('사용자 이메일:', user.email);
            if (user.email === searchEmail) {
                console.log('이메일 매칭 성공!');
                // 매칭된 사용자에게 원본 아이디 추가
                user.originalUserId = searchTerm;
                searchResults.push(user);
                continue;
            }
        } catch (error) {
            console.error('이메일 해시 생성 오류:', error);
        }
        
        // 3. 부분 매칭을 위해 userId로도 검색
        if (user.userId && user.userId.toLowerCase().includes(searchTerm.toLowerCase())) {
            console.log('userId로 매칭됨:', user.userId);
            searchResults.push(user);
        }
    }
    
    console.log('검색 결과:', searchResults);
    return searchResults;
}

// 사용자 검색 결과 표시
function displaySearchResults(users) {
    console.log('displaySearchResults 함수 호출됨, 사용자 수:', users.length);
    const resultsContainer = document.getElementById('user-search-results');
    
    if (!resultsContainer) {
        console.error('사용자 검색 결과 컨테이너를 찾을 수 없습니다: user-search-results');
        return;
    }
    
    // hidden 클래스 제거하여 컨테이너를 표시
    resultsContainer.classList.remove('hidden');
    resultsContainer.innerHTML = '';
    
    if (users.length === 0) {
        resultsContainer.innerHTML = '<p>검색 결과가 없습니다.</p>';
        console.log('검색 결과 없음');
        return;
    }
    
    users.forEach(user => {
        const userElement = document.createElement('div');
        userElement.className = 'user-result-item';
        
        // 표시할 사용자 아이디 결정 (원본 아이디 우선, 없으면 해시 아이디 앞 8자리만 표시)
        let displayId;
        if (user.originalUserId) {
            displayId = user.originalUserId;
        } else {
            // 해시 아이디의 경우 앞 8자리만 표시하고 "..." 추가
            displayId = user.userId.substring(0, 8) + '...';
        }
        
        userElement.innerHTML = `
            <span class="user-id" title="${user.userId}">${displayId}</span>
            <span class="user-luna">${user.luna} 루나</span>
        `;
        
        userElement.addEventListener('click', (event) => {
            selectUser(user, userElement);
        });
        
        resultsContainer.appendChild(userElement);
    });
    
    console.log('사용자 검색 결과 표시 완료');
}

// 사용자 선택
function selectUser(user, element) {
    console.log('selectUser 호출됨:', user);
    
    // 이전 선택 해제
    document.querySelectorAll('.user-result-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // 현재 선택 표시 (element가 있으면 사용, 없으면 찾기)
    if (element) {
        element.classList.add('selected');
    } else {
        // 사용자 ID로 해당 요소 찾기
        const userElements = document.querySelectorAll('.user-result-item');
        userElements.forEach(item => {
            const userIdSpan = item.querySelector('.user-id');
            if (userIdSpan && (userIdSpan.textContent === (user.originalUserId || user.userId.substring(0, 8) + '...'))) {
                item.classList.add('selected');
            }
        });
    }
    
    // 선택된 사용자 정보 저장
    window.selectedUser = user;
    
    // 루나 관리 컨트롤 업데이트
    const displayId = user.originalUserId || user.userId;
    document.getElementById('selected-user-id').textContent = displayId;
    document.getElementById('selected-user-luna').textContent = user.luna;
    document.getElementById('selected-user-slots').textContent = user.maxCharacterSlots || 4;
    
    // 루나 관리 패널 표시
    const lunaControls = document.getElementById('luna-management-controls');
    if (lunaControls) {
        lunaControls.classList.remove('hidden');
        lunaControls.style.display = 'block';
    }
    
    console.log('루나 관리 패널 표시됨');
}

// 선택된 사용자에게 루나 추가
async function addLunaToSelectedUser() {
    console.log('addLunaToSelectedUser 호출됨');
    console.log('window.selectedUser:', window.selectedUser);
    
    if (!window.selectedUser) {
        console.log('사용자가 선택되지 않음');
        alert('먼저 사용자를 선택해주세요.');
        return;
    }
    
    const amountInput = document.getElementById('luna-amount-input');
    console.log('루나 입력 요소:', amountInput);
    console.log('입력된 값:', amountInput ? amountInput.value : 'null');
    
    const amount = parseInt(amountInput.value);
    console.log('파싱된 수량:', amount);
    console.log('isNaN(amount):', isNaN(amount));
    console.log('amount <= 0:', amount <= 0);
    
    if (isNaN(amount) || amount <= 0) {
        console.log('올바르지 않은 수량');
        alert('올바른 루나 수량을 입력해주세요.');
        return;
    }
    
    try {
        const userRef = doc(db, 'users', window.selectedUser.id);
        const newLuna = window.selectedUser.luna + amount;
        
        await updateDoc(userRef, {
            luna: newLuna
        });
        
        // UI 업데이트
        window.selectedUser.luna = newLuna;
        document.getElementById('selected-user-luna').textContent = newLuna;
        
        // 검색 결과도 업데이트
        const selectedElement = document.querySelector('.user-result-item.selected .user-luna');
        if (selectedElement) {
            selectedElement.textContent = `${newLuna} 루나`;
        }
        
        const displayId = window.selectedUser.originalUserId || window.selectedUser.userId;
        alert(`${displayId}에게 ${amount} 루나를 추가했습니다.`);
        document.getElementById('luna-amount-input').value = '';
        
        // 현재 사용자가 선택된 사용자와 같다면 헤더의 루나 표시도 업데이트
        if (currentUser && currentUser.uid === window.selectedUser.id) {
            const lunaAmountElement = document.getElementById('luna-amount');
            if (lunaAmountElement) {
                lunaAmountElement.textContent = newLuna;
            }
        }
    } catch (error) {
        console.error('루나 추가 오류:', error);
        alert('루나 추가 중 오류가 발생했습니다.');
    }
}

// 선택된 사용자에게서 루나 차감
async function subtractLunaFromSelectedUser() {
    console.log('subtractLunaFromSelectedUser 함수 호출됨');
    console.log('window.selectedUser:', window.selectedUser);
    
    if (!window.selectedUser) {
        alert('먼저 사용자를 선택해주세요.');
        return;
    }
    
    const lunaAmountElement = document.getElementById('luna-amount-input');
    console.log('luna-amount-input 엘리먼트:', lunaAmountElement);
    console.log('luna-amount-input 값:', lunaAmountElement ? lunaAmountElement.value : 'null');
    
    const amount = parseInt(document.getElementById('luna-amount-input').value);
    console.log('파싱된 amount:', amount);
    console.log('isNaN(amount):', isNaN(amount));
    console.log('amount <= 0:', amount <= 0);
    
    if (isNaN(amount) || amount <= 0) {
        alert('올바른 루나 수량을 입력해주세요.');
        return;
    }
    
    if (window.selectedUser.luna < amount) {
        alert('사용자의 루나가 부족합니다.');
        return;
    }
    
    try {
        const userRef = doc(db, 'users', window.selectedUser.id);
        const newLuna = window.selectedUser.luna - amount;
        
        await updateDoc(userRef, {
            luna: newLuna
        });
        
        // UI 업데이트
        window.selectedUser.luna = newLuna;
        document.getElementById('selected-user-luna').textContent = newLuna;
        
        // 검색 결과도 업데이트
        const selectedElement = document.querySelector('.user-result-item.selected .user-luna');
        if (selectedElement) {
            selectedElement.textContent = `${newLuna} 루나`;
        }
        
        const displayId = window.selectedUser.originalUserId || window.selectedUser.userId;
        alert(`${displayId}에게서 ${amount} 루나를 차감했습니다.`);
        document.getElementById('luna-amount-input').value = '';
        
        // 현재 사용자가 선택된 사용자와 같다면 헤더의 루나 표시도 업데이트
        if (currentUser && currentUser.uid === window.selectedUser.id) {
            const lunaAmountElement = document.getElementById('luna-amount');
            if (lunaAmountElement) {
                lunaAmountElement.textContent = newLuna;
            }
        }
    } catch (error) {
        console.error('루나 차감 오류:', error);
        alert('루나 차감 중 오류가 발생했습니다.');
    }
}

// 선택된 사용자에게 슬롯 추가
async function addSlotToSelectedUser() {
    if (!window.selectedUser) {
        alert('먼저 사용자를 선택해주세요.');
        return;
    }
    
    const amountInput = document.getElementById('slot-amount-input');
    const amount = parseInt(amountInput.value);
    
    if (isNaN(amount) || amount <= 0) {
        alert('올바른 슬롯 수량을 입력해주세요.');
        return;
    }
    
    try {
        const userRef = doc(db, 'users', window.selectedUser.id);
        const currentSlots = window.selectedUser.maxCharacterSlots || 4;
        const newSlots = currentSlots + amount;
        
        await updateDoc(userRef, {
            maxCharacterSlots: newSlots
        });
        
        // UI 업데이트
        window.selectedUser.maxCharacterSlots = newSlots;
        document.getElementById('selected-user-slots').textContent = newSlots;
        
        const displayId = window.selectedUser.originalUserId || window.selectedUser.userId;
        alert(`${displayId}에게 ${amount}개의 슬롯을 추가했습니다.`);
        document.getElementById('slot-amount-input').value = '';
    } catch (error) {
        console.error('슬롯 추가 오류:', error);
        alert('슬롯 추가 중 오류가 발생했습니다.');
    }
}

// 선택된 사용자에게서 슬롯 감소
async function subtractSlotFromSelectedUser() {
    if (!window.selectedUser) {
        alert('먼저 사용자를 선택해주세요.');
        return;
    }
    
    const amountInput = document.getElementById('slot-amount-input');
    const amount = parseInt(amountInput.value);
    
    if (isNaN(amount) || amount <= 0) {
        alert('올바른 슬롯 수량을 입력해주세요.');
        return;
    }
    
    const currentSlots = window.selectedUser.maxCharacterSlots || 4;
    if (currentSlots - amount < 1) {
        alert('최소 1개의 슬롯은 유지되어야 합니다.');
        return;
    }
    
    try {
        const userRef = doc(db, 'users', window.selectedUser.id);
        const newSlots = currentSlots - amount;
        
        await updateDoc(userRef, {
            maxCharacterSlots: newSlots
        });
        
        // UI 업데이트
        window.selectedUser.maxCharacterSlots = newSlots;
        document.getElementById('selected-user-slots').textContent = newSlots;
        
        const displayId = window.selectedUser.originalUserId || window.selectedUser.userId;
        alert(`${displayId}에게서 ${amount}개의 슬롯을 감소했습니다.`);
        document.getElementById('slot-amount-input').value = '';
    } catch (error) {
        console.error('슬롯 감소 오류:', error);
        alert('슬롯 감소 중 오류가 발생했습니다.');
    }
}

// 전역 함수로 등록
window.searchUsers = searchUsers;
window.displaySearchResults = displaySearchResults;
window.selectUser = selectUser;
window.addLunaToSelectedUser = addLunaToSelectedUser;
window.subtractLunaFromSelectedUser = subtractLunaFromSelectedUser;
window.addSlotToSelectedUser = addSlotToSelectedUser;
window.subtractSlotFromSelectedUser = subtractSlotFromSelectedUser;

// 루나 새로고침 함수
async function refreshLunaDisplay() {
    if (!currentUser) return;
    
    try {
        const userRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            const userData = userDoc.data();
            const lunaAmount = userData.luna || 0;
            
            // 헤더의 루나 표시 업데이트
            const lunaAmountElement = document.getElementById('luna-amount');
            if (lunaAmountElement) {
                lunaAmountElement.textContent = lunaAmount;
            }
        }
    } catch (error) {
        console.error('루나 새로고침 오류:', error);
        // 네트워크 오류는 일시적인 문제이므로 사용자에게 알리지 않음
        if (error.code === 'unavailable' || error.message?.includes('QUIC_PROTOCOL_ERROR') || error.message?.includes('NAME_NOT_RESOLVED')) {
            console.warn('네트워크 연결 문제로 인한 일시적 오류입니다.');
        }
    }
}

// 루나 관리 버튼 이벤트 리스너 등록
function initializeLunaManagement() {
    const addLunaBtn = document.getElementById('add-luna-btn');
    const subtractLunaBtn = document.getElementById('subtract-luna-btn');
    const refreshLunaBtn = document.getElementById('refresh-luna-btn');
    const addSlotBtn = document.getElementById('add-slot-btn');
    const subtractSlotBtn = document.getElementById('subtract-slot-btn');
    
    if (addLunaBtn) {
        // 기존 이벤트 리스너 제거 후 새로 등록
        addLunaBtn.removeEventListener('click', addLunaToSelectedUser);
        addLunaBtn.addEventListener('click', addLunaToSelectedUser);
    }
    
    if (subtractLunaBtn) {
        // 기존 이벤트 리스너 제거 후 새로 등록
        subtractLunaBtn.removeEventListener('click', subtractLunaFromSelectedUser);
        subtractLunaBtn.addEventListener('click', subtractLunaFromSelectedUser);
    }
    
    if (refreshLunaBtn) {
        // 기존 이벤트 리스너 제거 후 새로 등록
        refreshLunaBtn.removeEventListener('click', refreshLunaDisplay);
        refreshLunaBtn.addEventListener('click', refreshLunaDisplay);
    }
    
    if (addSlotBtn) {
        // 기존 이벤트 리스너 제거 후 새로 등록
        addSlotBtn.removeEventListener('click', addSlotToSelectedUser);
        addSlotBtn.addEventListener('click', addSlotToSelectedUser);
    }
    
    if (subtractSlotBtn) {
        // 기존 이벤트 리스너 제거 후 새로 등록
        subtractSlotBtn.removeEventListener('click', subtractSlotFromSelectedUser);
        subtractSlotBtn.addEventListener('click', subtractSlotFromSelectedUser);
    }
}

// 페이지 로드 완료 시 초기화
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initializeLunaDisplay();
        initializeLunaManagement();
        initializeDesignatedMatchModal();
        

    });
} else {
    initializeLunaDisplay();
    initializeLunaManagement();
    initializeDesignatedMatchModal();
}

// ===== 지정매칭 기능 =====

// 지정매칭 모달 표시
function showDesignatedMatchModal(characterId) {
    console.log('지정매칭 모달 표시, characterId:', characterId);
    
    // 현재 캐릭터 정보 저장
    window.currentDesignatedMatchCharacterId = characterId;
    
    // 모달 표시
    const modal = document.getElementById('designated-match-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'block';
        loadDesignatedMatchTargets(characterId);
    } else {
        console.error('지정매칭 모달을 찾을 수 없습니다.');
    }
}

// 지정매칭 대상 로드
function loadDesignatedMatchTargets(characterId) {
    console.log('지정매칭 대상 로드 중, characterId:', characterId);
    
    // 현재 캐릭터 찾기
    const currentCharacter = allCharactersPool.find(c => c.id === characterId);
    if (!currentCharacter) {
        console.error('현재 캐릭터를 찾을 수 없습니다:', characterId);
        return;
    }
    
    // 랭킹 데이터 사용 (이미 정렬된 상태)
    const availableTargets = rankingData.filter(character => {
        // 자신 제외
        if (character.id === characterId) return false;
        // 같은 사용자의 캐릭터 제외
        if (character.userId === currentUser.uid) return false;
        return true;
    });
    
    console.log('지정매칭 가능한 대상 수:', availableTargets.length);
    
    const listContainer = document.getElementById('designated-match-list');
    if (!listContainer) {
        console.error('지정매칭 리스트 컨테이너를 찾을 수 없습니다.');
        return;
    }
    
    if (availableTargets.length === 0) {
        listContainer.innerHTML = '<div class="no-targets">지정매칭 가능한 캐릭터가 없습니다.</div>';
        return;
    }
    
    // 대상 리스트 생성 (랭킹 모달과 동일한 형식)
    listContainer.innerHTML = availableTargets.map((character) => {
        // 실제 랭킹 순위 찾기 (rankingData에서의 위치 + 1)
        const actualRank = rankingData.findIndex(c => c.id === character.id) + 1;
        // 랭킹 모달과 동일한 승률 계산 방식 사용
        const winRate = character.winRate || 0;
        
        // 캐릭터 이미지 URL 처리 (랭킹 모달과 동일한 크기)
        const imageUrl = character.imageUrl || character.image_url || 'https://placehold.co/60x60/333/FFF?text=?';
        
        return `
            <div class="ranking-item" onclick="selectDesignatedOpponent('${character.id}')">
                <div class="ranking-rank">#${actualRank}</div>
                <img src="${imageUrl}" alt="${character.name}" class="ranking-character-image" onerror="this.src='https://placehold.co/60x60/333/FFF?text=?'">
                <div class="ranking-info">
                    <div class="ranking-name">${character.name}</div>
                    <div class="ranking-class">${character.character_class || character.class}</div>
                </div>
                <div class="ranking-stats">${winRate}%<br>(<span class="wins">${character.wins || 0}승</span> <span class="losses">${character.losses || 0}패</span>)</div>
            </div>
        `;
    }).join('');
}

// 지정매칭 상대 선택
async function selectDesignatedOpponent(opponentId) {
    console.log('지정매칭 상대 선택:', opponentId);
    
    const currentCharacterId = window.currentDesignatedMatchCharacterId;
    if (!currentCharacterId) {
        console.error('현재 캐릭터 ID가 설정되지 않았습니다.');
        return;
    }
    
    // 현재 캐릭터와 상대방 캐릭터 찾기
    const currentCharacter = allCharactersPool.find(c => c.id === currentCharacterId);
    const opponentCharacter = allCharactersPool.find(c => c.id === opponentId);
    
    if (!currentCharacter || !opponentCharacter) {
        console.error('캐릭터를 찾을 수 없습니다:', { currentCharacterId, opponentId });
        alert('캐릭터 정보를 찾을 수 없습니다.');
        return;
    }
    
    try {
        // 플레이어 캐릭터의 최신 데이터 가져오기
        console.log('플레이어 캐릭터 최신 데이터 가져오는 중:', currentCharacter.name);
        let cachedPlayer = getCachedCharacter(currentCharacter.id);
        
        if (cachedPlayer) {
            console.log('캐시에서 플레이어 데이터 사용:', cachedPlayer.name);
            playerCharacterForBattle = cachedPlayer;
        } else {
            console.log('Firebase에서 플레이어 데이터 가져오는 중');
            const playerRef = await findCharacterRef(currentCharacter.id);
            if (playerRef) {
                const playerDoc = await getDoc(playerRef);
                if (playerDoc.exists()) {
                    const latestPlayerData = { id: playerDoc.id, ...playerDoc.data() };
                    setCachedCharacter(currentCharacter.id, latestPlayerData);
                    playerCharacterForBattle = latestPlayerData;
                    console.log('Firebase에서 플레이어 데이터 로드:', latestPlayerData.name);
                } else {
                    playerCharacterForBattle = currentCharacter;
                }
            } else {
                playerCharacterForBattle = currentCharacter;
            }
        }
        
        // 상대방 캐릭터의 최신 데이터 가져오기
        console.log('상대방 캐릭터 최신 데이터 가져오는 중:', opponentCharacter.name);
        let cachedOpponent = getCachedCharacter(opponentCharacter.id);
        
        if (cachedOpponent) {
            console.log('캐시에서 상대방 데이터 사용:', cachedOpponent.name);
            opponentCharacterForBattle = cachedOpponent;
        } else {
            console.log('Firebase에서 상대방 데이터 가져오는 중');
            const opponentRef = await findCharacterRef(opponentCharacter.id);
            if (opponentRef) {
                const opponentDoc = await getDoc(opponentRef);
                if (opponentDoc.exists()) {
                    const latestOpponentData = { id: opponentDoc.id, ...opponentDoc.data() };
                    setCachedCharacter(opponentCharacter.id, latestOpponentData);
                    opponentCharacterForBattle = latestOpponentData;
                    console.log('Firebase에서 상대방 데이터 로드:', latestOpponentData.name);
                } else {
                    opponentCharacterForBattle = opponentCharacter;
                }
            } else {
                opponentCharacterForBattle = opponentCharacter;
            }
        }
        
        console.log('지정매칭 설정 완료:', {
            player: playerCharacterForBattle.name,
            opponent: opponentCharacterForBattle.name
        });
        
        // 모달 닫기
        const modal = document.getElementById('designated-match-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.add('hidden');
        }
        
        // 매칭 화면으로 이동
        showView('matching');
        showMatchingScreen();
        window.scrollTo(0, 0);
        
    } catch (error) {
        console.error('지정매칭 설정 중 오류:', error);
        alert('지정매칭 설정 중 오류가 발생했습니다.');
    }
}

// 지정매칭 모달 닫기
function closeDesignatedMatchModal() {
    const modal = document.getElementById('designated-match-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.add('hidden');
    }
    window.currentDesignatedMatchCharacterId = null;
}

// 지정매칭 모달 초기화
function initializeDesignatedMatchModal() {
    const modal = document.getElementById('designated-match-modal');
    if (!modal) return;
    
    // 닫기 버튼 이벤트 리스너
    const closeBtn = modal.querySelector('.close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeDesignatedMatchModal);
    }
    
    // 모달 배경 클릭 시 닫기
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeDesignatedMatchModal();
        }
    });
}

// 전역 함수로 등록
window.showDesignatedMatchModal = showDesignatedMatchModal;
window.loadDesignatedMatchTargets = loadDesignatedMatchTargets;
window.selectDesignatedOpponent = selectDesignatedOpponent;
window.closeDesignatedMatchModal = closeDesignatedMatchModal;
window.initializeDesignatedMatchModal = initializeDesignatedMatchModal;

// ===== 소설 시스템 ===== 

// 소설 시스템 전역 변수
let currentStoryPage = 1;
let totalStoryPages = 1;
let isGeneratingPage = false;

// 소설 시스템 초기화
function initializeStorySystem() {
    console.log('소설 시스템 초기화 중...');
    
    // 스토리 버튼 이벤트 리스너
    const showStoryBtn = document.getElementById('show-story-btn');
    if (showStoryBtn) {
        showStoryBtn.addEventListener('click', async () => {
            showView('story');
            // 총 페이지 수 업데이트
            await updateTotalPages();
            // 마지막 읽은 페이지 불러오기
            const lastReadPage = getLastReadPage();
            // 마지막 읽은 페이지가 총 페이지 수를 초과하지 않도록 확인
            const targetPage = Math.min(lastReadPage, totalStoryPages);
            // 마지막 읽은 페이지 로드
            loadStoryPage(targetPage);
        });
    }
    
    // 첫 페이지 강제 재생성 함수 (개발용)
    window.recreateFirstPage = async function() {
        try {
            console.log('첫 페이지 재생성 시작...');
            
            // 기존 첫 페이지 삭제
            const pagesRef = collection(db, 'story_pages');
            const q = query(pagesRef, where('pageNumber', '==', 1));
            const querySnapshot = await getDocs(q);
            
            for (const doc of querySnapshot.docs) {
                await deleteDoc(doc.ref);
                console.log('기존 첫 페이지 삭제됨:', doc.id);
            }
            
            // 캐시 클리어
            storyCache.clear();
            
            // 새 첫 페이지 생성
            await createDefaultFirstPage();
            
            console.log('첫 페이지 재생성 완료!');
            alert('첫 페이지가 새로운 내용으로 업데이트되었습니다!');
            
        } catch (error) {
            console.error('첫 페이지 재생성 실패:', error);
            alert('첫 페이지 재생성 실패: ' + error.message);
        }
    };
    
    // 뒤로가기 버튼
    const backBtn = document.getElementById('back-to-cards-from-story-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            showView('character-cards');
        });
    }
    
    // 네비게이션 버튼들
    const firstPageBtn = document.getElementById('first-page-btn');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const lastPageBtn = document.getElementById('last-page-btn');
    const pageJumpBtn = document.getElementById('page-jump-btn');
    const generatePageBtn = document.getElementById('generate-page-btn');
    
    if (firstPageBtn) firstPageBtn.addEventListener('click', () => loadStoryPage(1));
    if (prevPageBtn) prevPageBtn.addEventListener('click', () => loadStoryPage(currentStoryPage - 1));
    if (nextPageBtn) nextPageBtn.addEventListener('click', () => loadStoryPage(currentStoryPage + 1));
    if (lastPageBtn) lastPageBtn.addEventListener('click', () => loadStoryPage(totalStoryPages));
    if (generatePageBtn) generatePageBtn.addEventListener('click', showPageGenerationModal);
    
    if (pageJumpBtn) {
        pageJumpBtn.addEventListener('click', () => {
            const input = document.getElementById('page-jump-input');
            const pageNum = parseInt(input.value);
            if (pageNum >= 1 && pageNum <= totalStoryPages) {
                loadStoryPage(pageNum);
                input.value = '';
            }
        });
    }
    
    // 페이지 액션 버튼들
    const likeBtn = document.getElementById('like-page-btn');
    const bookmarkBtn = document.getElementById('bookmark-page-btn');
    const deleteBtn = document.getElementById('delete-page-btn');
    
    if (likeBtn) likeBtn.addEventListener('click', togglePageLike);
    if (bookmarkBtn) bookmarkBtn.addEventListener('click', togglePageBookmark);
    if (deleteBtn) deleteBtn.addEventListener('click', deleteLatestPage);
    
    // 페이지 생성 모달 초기화
    initializePageGenerationModal();
    
    console.log('소설 시스템 초기화 완료');
}

// 스토리 페이지 로드
// 마지막 읽은 페이지 저장
function saveLastReadPage(pageNumber) {
    try {
        localStorage.setItem('lastReadPage', pageNumber.toString());
    } catch (error) {
        console.error('마지막 읽은 페이지 저장 오류:', error);
    }
}

// 마지막 읽은 페이지 불러오기
function getLastReadPage() {
    try {
        const lastPage = localStorage.getItem('lastReadPage');
        return lastPage ? parseInt(lastPage) : 1;
    } catch (error) {
        console.error('마지막 읽은 페이지 불러오기 오류:', error);
        return 1;
    }
}

async function loadStoryPage(pageNumber) {
    if (pageNumber < 1) return;
    
    console.log(`스토리 페이지 ${pageNumber} 로드 중...`);
    
    try {
        // 총 페이지 수 업데이트
        await updateTotalPages();
        
        if (pageNumber > totalStoryPages) {
            console.log(`요청된 페이지 ${pageNumber}가 총 페이지 수 ${totalStoryPages}를 초과합니다.`);
            return;
        }
        
        currentStoryPage = pageNumber;
        // 마지막 읽은 페이지를 localStorage에 저장
        saveLastReadPage(pageNumber);
        updateNavigationButtons();
        
        // 캐시에서 페이지 확인
        const cachedPage = storyCache.get(pageNumber);
        if (cachedPage) {
            displayStoryPage(cachedPage);
            return;
        }
        
        // 로딩 표시
        showStoryLoading();
        
        // 첫 페이지는 프로그램에서 직접 생성
        if (pageNumber === 1) {
            createDefaultFirstPage();
        } else {
            try {
                // 2페이지부터는 Firebase에서 페이지 데이터 가져오기
                const pageData = await fetchStoryPageFromFirebase(pageNumber);
                
                if (pageData) {
                    storyCache.set(pageNumber, pageData);
                    displayStoryPage(pageData);
                } else {
                    showStoryError('페이지를 찾을 수 없습니다.');
                }
            } catch (fetchError) {
                if (fetchError.message === 'QUOTA_EXCEEDED') {
                    showStoryError('⚠️ Firebase 일일 사용량 초과<br><br>죄송합니다. 오늘 Firebase 무료 플랜의 일일 읽기 제한을 초과했습니다.<br>내일 다시 시도해주세요.<br><br>💡 <strong>해결 방법:</strong><br>• 브라우저 새로고침 후 다시 시도<br>• 몇 시간 후 재접속<br>• 첫 페이지는 정상 작동합니다');
                } else {
                    showStoryError('페이지 로드 중 오류가 발생했습니다.');
                }
            }
        }
        
    } catch (error) {
        console.error('스토리 페이지 로드 중 오류:', error);
        showStoryError('페이지 로드 중 오류가 발생했습니다.');
    }
}

// Firebase에서 스토리 페이지 가져오기
async function fetchStoryPageFromFirebase(pageNumber) {
    try {
        const pagesRef = collection(db, 'story_pages');
        const q = query(pagesRef, where('pageNumber', '==', pageNumber));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            return { id: doc.id, ...doc.data() };
        }
        
        return null;
    } catch (error) {
        console.error('Firebase에서 페이지 가져오기 오류:', error);
        
        // Firebase quota 초과 오류 처리
        if (error.code === 'resource-exhausted' || error.message.includes('Quota exceeded')) {
            throw new Error('QUOTA_EXCEEDED');
        }
        
        return null;
    }
}

// 총 페이지 수 업데이트
async function updateTotalPages() {
    try {
        const metadataRef = doc(db, 'story_metadata', 'main');
        const metadataDoc = await getDoc(metadataRef);
        
        if (metadataDoc.exists()) {
            totalStoryPages = metadataDoc.data().totalPages || 1;
        } else {
            totalStoryPages = 1;
        }
        
        // UI 업데이트
        const totalPagesElement = document.getElementById('total-pages-num');
        if (totalPagesElement) {
            totalPagesElement.textContent = totalStoryPages;
        }
        
    } catch (error) {
        console.error('총 페이지 수 업데이트 오류:', error);
        
        // Firebase quota 초과 시에도 기본값 설정
        if (error.code === 'resource-exhausted' || error.message.includes('Quota exceeded')) {
            console.warn('Firebase quota 초과로 인해 기본 페이지 수(1)로 설정됩니다.');
        }
        
        totalStoryPages = 1;
        
        // UI에도 기본값 표시
        const totalPagesElement = document.getElementById('total-pages-num');
        if (totalPagesElement) {
            totalPagesElement.textContent = '1';
        }
    }
}

// 기본 첫 페이지 생성 (Firebase 없이 로컬에서만)
function createDefaultFirstPage() {
    const defaultContent = `
        <div style="text-align: center; margin-bottom: 40px; padding: 20px; background: linear-gradient(135deg, #0f0f23, #1a1a2e); border-radius: 20px; border: 3px solid #4a9eff; box-shadow: 0 0 30px rgba(74, 158, 255, 0.5);">
            <h1 style="color: #4a9eff; margin: 0; font-size: 2.2em; text-shadow: 2px 2px 4px rgba(0,0,0,0.7);">🏆 전설의 아레나</h1>
            <h2 style="color: #ffd700; margin: 10px 0 0 0; font-size: 1.3em; font-style: italic;">루나 에너지의 발견</h2>
        </div>
        
        <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 40px; border-radius: 20px; margin: 30px 0; border: 2px solid #4a9eff; box-shadow: 0 0 25px rgba(74, 158, 255, 0.3); line-height: 1.8;">
            <h2 style="color: #ffd700; text-align: center; margin-bottom: 30px; font-size: 1.8em; text-shadow: 1px 1px 3px rgba(0,0,0,0.5);">📜 제1장: 차원의 균열과 레전드 아레나의 탄생</h2>
            
            <h3 style="color: #ff6b6b; margin: 35px 0 20px 0; font-size: 1.4em; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">⚡ 태초의 혼돈</h3>
            <p style="margin: 20px 0; color: #e8f4fd; font-size: 1.1em; text-indent: 20px;">우주가 창조된 지 수십억 년이 흘렀을 때, 무수한 차원들 사이에 균열이 생기기 시작했다. 이 균열들은 단순한 공간의 틈이 아니었다. 각기 다른 법칙과 시간의 흐름을 가진 세계들이 서로 충돌하며 만들어낸, 현실과 환상이 뒤섞인 신비로운 공간이었다.</p>
            
            <p style="margin: 20px 0; color: #e8f4fd; font-size: 1.1em; text-indent: 20px;">고대 마법사들은 이 현상을 <strong style="color: #ffd700;">'차원 융합'</strong>이라 불렀고, 과학자들은 <strong style="color: #ffd700;">'시공간 특이점'</strong>이라 명명했다. 하지만 그 누구도 이 현상의 진정한 의미를 깨닫지 못했다. 이것은 우주 자체가 선택한 시험장이었던 것이다.</p>
            
            <h3 style="color: #ff6b6b; margin: 35px 0 20px 0; font-size: 1.4em; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">🌌 아레나의 형성</h3>
            <p style="margin: 20px 0; color: #e8f4fd; font-size: 1.1em; text-indent: 20px;">차원 균열들이 하나로 수렴하면서, 거대한 원형의 공간이 형성되었다. 이 공간은 물리 법칙을 초월한 곳으로, 중력은 의지에 따라 변하고, 시간은 감정에 따라 빨라지거나 느려졌다. 하늘에는 수십 개의 태양과 달이 동시에 떠 있었고, 땅은 수정처럼 투명한 바닥 아래로 무한한 별들이 흐르는 모습을 보여주었다.</p>
            
            <p style="margin: 20px 0; color: #e8f4fd; font-size: 1.1em; text-indent: 20px;">이 공간의 중앙에는 거대한 원형 무대가 솟아올랐다. 무대의 표면은 살아있는 것처럼 맥박치며, 그 위에 서는 자의 마음을 읽어 최적의 전투 환경을 만들어냈다. 사막을 원하면 뜨거운 모래가 펼쳐지고, 숲을 원하면 고대의 나무들이 자라났다. 바다를 원하면 깊고 푸른 물결이 일렁였다.</p>
            
            <h3 style="color: #ff6b6b; margin: 35px 0 20px 0; font-size: 1.4em; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">🌙 루나 에너지의 발견</h3>
            <p style="margin: 20px 0; color: #e8f4fd; font-size: 1.1em; text-indent: 20px;">아레나가 완성된 후, 그 중심부에서 신비로운 에너지가 발견되었다. 이 에너지는 달빛처럼 은은하게 빛나며, 만지는 자에게 무한한 가능성을 느끼게 했다. 고대의 현자들은 이를 <strong style="color: #87ceeb;">'루나(Luna)'</strong>라 명명했다.</p>
            
            <p style="margin: 20px 0; color: #e8f4fd; font-size: 1.1em; text-indent: 20px;">루나는 단순한 에너지가 아니었다. 그것은 의식을 가진 존재였으며, 순수한 의지와 용기를 가진 자들에게만 자신의 힘을 나누어주었다. 루나를 얻은 자들은 자신의 한계를 뛰어넘을 수 있었고, 새로운 능력을 개발하거나 기존의 힘을 강화할 수 있었다.</p>
            
            <h3 style="color: #ff6b6b; margin: 35px 0 20px 0; font-size: 1.4em; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">⚔️ 첫 번째 전사들의 등장</h3>
            <p style="margin: 20px 0; color: #e8f4fd; font-size: 1.1em; text-indent: 20px;">차원 균열을 통해 다양한 세계에서 전사들이 아레나로 끌려오기 시작했다. 어떤 이는 자신의 의지로, 어떤 이는 운명에 이끌려, 또 어떤 이는 복수나 명예를 위해 이곳에 발을 들였다.</p>
            
            <div style="background: rgba(255, 215, 0, 0.1); padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 3px solid #ffd700;">
                <p style="margin: 0; color: #ffd700; font-weight: bold;">🛡️ 강철의 성기사 아르투리우스</p>
                <p style="margin: 5px 0 0 0; color: #e8f4fd; font-size: 0.9em;">멸망한 왕국의 마지막 기사로, 자신의 세계를 구하기 위한 힘을 찾아 헤매던 중 아레나에 도달했다.</p>
            </div>
            
            <div style="background: rgba(128, 0, 128, 0.1); padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 3px solid #800080;">
                <p style="margin: 0; color: #dda0dd; font-weight: bold;">🗡️ 그림자 암살자 카게</p>
                <p style="margin: 5px 0 0 0; color: #e8f4fd; font-size: 0.9em;">어둠 속에서 태어나 그림자를 조종하는 신비로운 닌자. 잃어버린 기억을 되찾기 위해 아레나에 왔다.</p>
            </div>
            
            <div style="background: rgba(255, 69, 0, 0.1); padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 3px solid #ff4500;">
                <p style="margin: 0; color: #ff6347; font-weight: bold;">🔥 원소 마법사 엘레나</p>
                <p style="margin: 5px 0 0 0; color: #e8f4fd; font-size: 0.9em;">불, 물, 바람, 땅의 모든 원소를 다루는 천재 마법사. 금지된 마법의 비밀을 찾고 있다.</p>
            </div>
            
            <div style="background: rgba(34, 139, 34, 0.1); padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 3px solid #228b22;">
                <p style="margin: 0; color: #90ee90; font-weight: bold;">🐻 야수 전사 그롬</p>
                <p style="margin: 5px 0 0 0; color: #e8f4fd; font-size: 0.9em;">거대한 체구와 야수의 힘을 가진 전사. 자신의 부족을 구하기 위해 강력한 힘을 추구한다.</p>
            </div>
            
            <h3 style="color: #ff6b6b; margin: 35px 0 20px 0; font-size: 1.4em; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">⚡ 전설의 첫 번째 전투</h3>
            <p style="margin: 20px 0; color: #e8f4fd; font-size: 1.1em; text-indent: 20px;">아르투리우스와 카게 사이에 벌어진 첫 번째 전투는 아레나의 역사를 바꾸었다. 두 전사의 대결은 <strong style="color: #ffd700;">3일 3밤</strong>을 지속되었고, 그들의 의지와 기술이 충돌할 때마다 아레나 전체가 진동했다. 마침내 아르투리우스가 승리했을 때, 하늘에서 루나의 빛이 내려와 그를 축복했다.</p>
            
            <p style="margin: 20px 0; color: #e8f4fd; font-size: 1.1em; text-indent: 20px;">이 순간, 아레나는 깨달았다. 이곳은 단순한 전투장이 아니라, <strong style="color: #87ceeb;">영혼의 성장과 진화를 위한 신성한 공간</strong>이라는 것을. 승부의 결과보다 중요한 것은 전사들이 보여주는 용기, 명예, 그리고 성장하려는 의지였다.</p>
        </div>
        
        <div style="background: linear-gradient(135deg, #1e3c72, #2a5298); padding: 25px; border-radius: 15px; margin: 30px 0; border: 2px solid #4a9eff; text-align: center;">
            <h3 style="color: #ffd700; margin-bottom: 15px;">📖 아스트랄 코덱스의 예언</h3>
            <div style="background: rgba(0, 0, 0, 0.3); padding: 20px; border-radius: 10px; border-left: 4px solid #4a9eff;">
                <p style="font-style: italic; color: #e8f4fd; margin: 0; font-size: 1.1em; line-height: 1.6;">
                    <em>"차원이 하나로 모이는 곳에서,<br>
                    영혼의 진정한 힘이 시험받으리라.<br>
                    승리하는 자는 루나의 축복을 받고,<br>
                    패배하는 자는 더 강한 의지로 일어서리라.<br>
                    이곳에서 벌어지는 모든 전투는<br>
                    우주의 균형을 지키는 성스러운 의식이니,<br>
                    전사여, 두려워하지 말고 나아가라."</em>
                </p>
            </div>
        </div>
        
        <div style="background: linear-gradient(135deg, #2d1b69, #11998e); padding: 25px; border-radius: 15px; margin: 30px 0; border: 2px solid #11998e;">
            <h3 style="color: #ffd700; margin-bottom: 15px;">🌟 현재의 아레나</h3>
            <p style="line-height: 1.8; color: #e8f4fd;">수천 년이 흘러 지금에 이르기까지, 레전드 아레나는 계속해서 새로운 전사들을 맞이하고 있다. 각자의 사연과 목표를 가진 영웅들이 이곳에서 만나 자신의 한계에 도전한다.</p>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0;">
                <div style="background: rgba(255, 255, 255, 0.1); padding: 15px; border-radius: 8px; text-align: center;">
                    <p style="margin: 0; color: #ffd700; font-weight: bold;">💫 잃어버린 것을 되찾기 위해</p>
                </div>
                <div style="background: rgba(255, 255, 255, 0.1); padding: 15px; border-radius: 8px; text-align: center;">
                    <p style="margin: 0; color: #87ceeb; font-weight: bold;">⚡ 새로운 힘을 얻기 위해</p>
                </div>
                <div style="background: rgba(255, 255, 255, 0.1); padding: 15px; border-radius: 8px; text-align: center;">
                    <p style="margin: 0; color: #ff6b6b; font-weight: bold;">🏆 단순히 강해지고 싶어서</p>
                </div>
            </div>
            
            <p style="line-height: 1.8; color: #e8f4fd; text-align: center; font-weight: bold;">아레나는 모든 전사를 공평하게 대한다. 출신이나 과거는 중요하지 않다.<br>오직 현재 이 순간의 의지와 용기만이 승부를 가른다.</p>
        </div>
        
        <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 25px; border-radius: 15px; margin: 30px 0; border: 2px solid #667eea;">
            <h3 style="color: #ffd700; margin-bottom: 15px; text-align: center;">🚀 새로운 전설의 시작</h3>
            <p style="line-height: 1.8; color: #e8f4fd; text-align: center;">이제 당신의 영웅들이 이 전설적인 무대에 발을 들이려 한다. 그들 각자가 가진 독특한 능력과 배경 이야기는 아레나의 역사에 새로운 장을 추가할 것이다.</p>
            
            <div style="text-align: center; margin: 20px 0;">
                <p style="font-size: 1.1em; color: #ffd700; margin: 5px 0;">⚔️ 승리와 패배</p>
                <p style="font-size: 1.1em; color: #87ceeb; margin: 5px 0;">🤝 우정과 라이벌 관계</p>
                <p style="font-size: 1.1em; color: #ff6b6b; margin: 5px 0;">📈 성장과 깨달음의 순간들</p>
            </div>
            
            <p style="line-height: 1.8; color: #e8f4fd; text-align: center; font-style: italic;">루나의 빛이 다시 한 번 아레나를 비추며, 새로운 이야기의 시작을 알린다.<br>차원의 균열 너머에서 들려오는 것은 전사들의 함성인가, 아니면 운명의 부름인가?</p>
        </div>
        
        <div style="text-align: center; margin: 40px 0; padding: 25px; background: linear-gradient(135deg, #ff9a9e, #fecfef); border-radius: 15px; border: 2px solid #ff9a9e;">
            <p style="font-size: 1.3em; font-weight: bold; color: #8b0000; margin: 0; text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">
                ✨ "모든 전설은 첫 걸음에서 시작된다." ✨<br>
                <span style="font-size: 0.8em; font-style: italic; color: #4b0082;">- 아스트랄 코덱스 제1장 -</span>
            </p>
        </div>
        
        <div style="margin: 30px 0; padding: 20px; background: linear-gradient(135deg, #ffeaa7, #fab1a0); border-radius: 12px; border-left: 5px solid #fdcb6e;">
            <p style="margin: 0; font-size: 1em; color: #2d3436; font-weight: bold; text-align: center;">
                📚 <strong>아레나 기록관의 주석:</strong><br>
                <span style="font-weight: normal; font-style: italic;">이 기록은 아레나에 도착한 모든 새로운 전사들에게 전해지는 공식 역사서의 첫 번째 장입니다.<br>
                당신의 모험이 이 위대한 이야기에 어떤 새로운 전설을 추가할지 기대됩니다.</span>
            </p>
        </div>
        
        <div style="text-align: center; margin: 50px 0; padding: 30px; background: linear-gradient(135deg, #0f3460, #0c2d48); border-radius: 20px; border: 3px solid #4a9eff; box-shadow: 0 0 30px rgba(74, 158, 255, 0.4);">
            <h2 style="color: #ffd700; margin-bottom: 20px; font-size: 1.5em; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">📖 제1장 완료</h2>
            <p style="color: #e8f4fd; margin: 15px 0; font-size: 1.1em; line-height: 1.6;">아레나의 기원과 루나 에너지의 발견에 대한 이야기가 끝났습니다.</p>
            <p style="color: #87ceeb; margin: 15px 0; font-size: 1em; font-style: italic;">다음 페이지부터는 새로운 전사들의 모험이 시작됩니다...</p>
        </div>
    `;
    
    const pageData = {
        pageNumber: 1,
        title: '제1장: 시작',
        content: defaultContent,
        characters: [],
        likes: 0,
        bookmarks: 0,
        createdAt: new Date().toISOString(),
        generator: 'system',
        cost: 0,
        options: ['default']
    };
    
    // 캐시에 저장
    storyCache.set(1, pageData);
    
    // 화면에 표시
    displayStoryPage(pageData);
    
    console.log('기본 첫 페이지 생성 완료 (로컬)');
}

// 스토리 페이지 화면에 표시
function displayStoryPage(pageData) {
    // 페이지 제목
    const titleElement = document.getElementById('page-title');
    if (titleElement) {
        titleElement.textContent = pageData.title || `제${pageData.pageNumber}장`;
    }
    
    // 페이지 번호
    const pageNumElements = [
        document.getElementById('page-display-num'),
        document.getElementById('current-page-num')
    ];
    pageNumElements.forEach(element => {
        if (element) element.textContent = pageData.pageNumber;
    });
    
    // 페이지 날짜
    const dateElement = document.getElementById('page-date');
    if (dateElement && pageData.createdAt) {
        const date = new Date(pageData.createdAt);
        dateElement.textContent = date.toLocaleDateString('ko-KR');
    }
    
    // 페이지 내용
    const contentElement = document.getElementById('page-content');
    if (contentElement) {
        contentElement.innerHTML = pageData.content || '내용이 없습니다.';
    }
    
    // 등장 캐릭터들
    const charactersElement = document.getElementById('page-characters');
    if (charactersElement) {
        if (pageData.characters && pageData.characters.length > 0) {
            charactersElement.innerHTML = pageData.characters.map(char => 
                `<span class="character-tag">${char.name || char}</span>`
            ).join('');
        } else {
            charactersElement.innerHTML = '';
        }
    }
    
    // 좋아요 수
    const likesElement = document.getElementById('page-likes');
    if (likesElement) {
        likesElement.textContent = pageData.likes || 0;
    }
    
    // 관리자 삭제 버튼 표시/숨김
    const deleteBtn = document.getElementById('delete-page-btn');
    if (deleteBtn) {
        if (currentUser && currentUser.email === 'admin@legendsarena.com' && pageData.pageNumber === totalStoryPages) {
            deleteBtn.classList.remove('hidden');
        } else {
            deleteBtn.classList.add('hidden');
        }
    }
    
    // 로딩 숨김
    hideStoryLoading();
}

// 네비게이션 버튼 상태 업데이트
function updateNavigationButtons() {
    const firstBtn = document.getElementById('first-page-btn');
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    const lastBtn = document.getElementById('last-page-btn');
    const generateBtn = document.getElementById('generate-page-btn');
    const deleteBtn = document.getElementById('delete-page-btn');
    
    if (firstBtn) firstBtn.disabled = currentStoryPage <= 1;
    if (prevBtn) prevBtn.disabled = currentStoryPage <= 1;
    if (nextBtn) nextBtn.disabled = currentStoryPage >= totalStoryPages;
    if (lastBtn) lastBtn.disabled = currentStoryPage >= totalStoryPages;
    
    // 새 페이지 생성 버튼과 삭제 버튼은 마지막 페이지에서만 표시
    const isLastPage = currentStoryPage >= totalStoryPages;
    
    if (generateBtn) {
        if (isLastPage) {
            generateBtn.style.setProperty('display', 'inline-block', 'important');
            generateBtn.style.setProperty('visibility', 'visible', 'important');
        } else {
            generateBtn.style.setProperty('display', 'none', 'important');
        }
    }
    
    if (deleteBtn) {
        if (isLastPage) {
            deleteBtn.style.setProperty('display', 'inline-block', 'important');
            deleteBtn.style.setProperty('visibility', 'visible', 'important');
        } else {
            deleteBtn.style.setProperty('display', 'none', 'important');
        }
    }
    
    // 페이지 점프 입력 최대값 설정
    const pageJumpInput = document.getElementById('page-jump-input');
    if (pageJumpInput) {
        pageJumpInput.max = totalStoryPages;
    }
}

// 로딩 표시
function showStoryLoading() {
    const loadingElement = document.getElementById('story-loading');
    const contentElement = document.getElementById('page-content');
    
    if (loadingElement) loadingElement.style.display = 'block';
    if (contentElement) contentElement.style.display = 'none';
}

// 로딩 숨김
function hideStoryLoading() {
    const loadingElement = document.getElementById('story-loading');
    const contentElement = document.getElementById('page-content');
    
    if (loadingElement) loadingElement.style.display = 'none';
    if (contentElement) contentElement.style.display = 'block';
}

// 에러 표시
function showStoryError(message) {
    const contentElement = document.getElementById('page-content');
    if (contentElement) {
        contentElement.innerHTML = `<div class="error-message" style="text-align: center; color: #ff4757; padding: 50px 0;">${message}</div>`;
    }
    hideStoryLoading();
}

// 페이지 생성 모달 표시
function showPageGenerationModal() {
    const modal = document.getElementById('page-generation-modal');
    if (modal) {
        // 사용자 루나 표시
        updateUserLunaDisplay();
        
        // 캐릭터 선택 옵션 업데이트
        updateCharacterSelectOptions();
        
        // 기본 페이지 옵션이 항상 선택되도록 보장
        const basicOption = document.getElementById('basic-option');
        if (basicOption) {
            basicOption.checked = true;
        }
        
        // 비용 업데이트
        updateGenerationCost();
        
        // 모달 표시
        modal.classList.remove('hidden');
        modal.style.display = 'block';
    }
}

// 페이지 생성 모달 초기화
function initializePageGenerationModal() {
    const modal = document.getElementById('page-generation-modal');
    if (!modal) return;
    
    // 닫기 버튼
    const closeBtn = modal.querySelector('.close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closePageGenerationModal);
    }
    
    // 취소 버튼
    const cancelBtn = document.getElementById('cancel-generation-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closePageGenerationModal);
    }
    
    // 생성 확인 버튼
    const confirmBtn = document.getElementById('confirm-generation-btn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', generateNewPage);
    }
    
    // 기본 페이지 옵션은 항상 선택되어 있고 비활성화되어 있으므로 이벤트 리스너 제외
    // 추가 옵션 체크박스들에만 이벤트 리스너 추가
    const additionalOptions = modal.querySelectorAll('.generation-option:not(#basic-option)');
    additionalOptions.forEach(checkbox => {
        checkbox.addEventListener('change', updateGenerationCost);
    });
    
    // 캐릭터 중심 옵션 체크박스
    const characterFocusOption = document.getElementById('character-focus-option');
    const characterSelect = document.getElementById('character-select');
    
    if (characterFocusOption && characterSelect) {
        characterFocusOption.addEventListener('change', () => {
            if (characterFocusOption.checked) {
                characterSelect.classList.remove('hidden');
            } else {
                characterSelect.classList.add('hidden');
            }
            updateGenerationCost();
        });
    }
    
    // 특별 이벤트 옵션 체크박스
    const specialEventOption = document.getElementById('special-event-option');
    const specialEventInput = document.getElementById('special-event-input');
    
    if (specialEventOption && specialEventInput) {
        specialEventOption.addEventListener('change', () => {
            if (specialEventOption.checked) {
                specialEventInput.classList.remove('hidden');
            } else {
                specialEventInput.classList.add('hidden');
                specialEventInput.value = '';
            }
            updateGenerationCost();
        });
    }
    
    // 모달 배경 클릭 시 닫기
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closePageGenerationModal();
        }
    });
}

// 사용자 루나 표시 업데이트
function updateUserLunaDisplay() {
    const userLunaElement = document.getElementById('user-luna-display');
    const headerLunaElement = document.getElementById('luna-amount');
    
    if (userLunaElement && headerLunaElement) {
        userLunaElement.textContent = headerLunaElement.textContent;
    }
}

// 캐릭터 선택 옵션 업데이트
function updateCharacterSelectOptions() {
    const characterSelect = document.getElementById('character-select');
    if (!characterSelect) return;
    
    // 기본 옵션 유지
    characterSelect.innerHTML = '<option value="">캐릭터 선택...</option>';
    
    // 사용자의 캐릭터들 추가
    if (currentUser && allCharactersPool) {
        const userCharacters = allCharactersPool.filter(char => char.userId === currentUser.uid);
        userCharacters.forEach(char => {
            const option = document.createElement('option');
            option.value = char.id;
            option.textContent = char.name;
            characterSelect.appendChild(option);
        });
    }
}

// 생성 비용 업데이트
function updateGenerationCost() {
    const optionCheckboxes = document.querySelectorAll('.generation-option:checked');
    let totalCost = 0;
    
    optionCheckboxes.forEach(checkbox => {
        totalCost += parseInt(checkbox.dataset.cost) || 0;
    });
    
    // 비용 표시 업데이트
    const totalCostElement = document.getElementById('total-cost');
    if (totalCostElement) {
        totalCostElement.textContent = totalCost;
    }
    
    // 생성 버튼 활성화/비활성화
    const confirmBtn = document.getElementById('confirm-generation-btn');
    const userLuna = parseInt(document.getElementById('luna-amount').textContent) || 0;
    
    if (confirmBtn) {
        // 옵션이 선택되지 않았거나 루나가 부족하면 비활성화
        confirmBtn.disabled = totalCost === 0 || userLuna < totalCost || isGeneratingPage;
    }
}

// 페이지 생성 모달 닫기
function closePageGenerationModal() {
    const modal = document.getElementById('page-generation-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.add('hidden');
        
        // 추가 옵션들만 리셋 (기본 페이지는 항상 선택된 상태 유지)
        const additionalCheckboxes = modal.querySelectorAll('.generation-option:not(#basic-option)');
        additionalCheckboxes.forEach(checkbox => checkbox.checked = false);
        
        const characterSelect = document.getElementById('character-select');
        if (characterSelect) {
            characterSelect.classList.add('hidden');
            characterSelect.value = '';
        }
        
        const specialEventInput = document.getElementById('special-event-input');
        if (specialEventInput) {
            specialEventInput.classList.add('hidden');
            specialEventInput.value = '';
        }
        
        updateGenerationCost();
    }
}

// 새 페이지 생성
async function generateNewPage() {
    if (isGeneratingPage) return;
    
    try {
        isGeneratingPage = true;
        
        // 선택된 옵션들 수집
        const selectedOptions = [];
        const optionCheckboxes = document.querySelectorAll('.generation-option:checked');
        
        optionCheckboxes.forEach(checkbox => {
            selectedOptions.push({
                type: checkbox.id.replace('-option', ''),
                cost: parseInt(checkbox.dataset.cost)
            });
        });
        
        // 최소 옵션 확인
        if (selectedOptions.length === 0) {
            selectedOptions.push({ type: 'basic', cost: 50 });
        }
        
        // 총 비용 계산
        const totalCost = selectedOptions.reduce((sum, option) => sum + option.cost, 0);
        
        // 루나 확인
        const userLuna = parseInt(document.getElementById('luna-amount').textContent) || 0;
        if (userLuna < totalCost) {
            alert('루나가 부족합니다.');
            return;
        }
        
        // 특정 캐릭터 선택 확인
        let selectedCharacter = null;
        if (selectedOptions.some(opt => opt.type === 'character-focus')) {
            const characterSelect = document.getElementById('character-select');
            const characterId = characterSelect.value;
            if (characterId) {
                selectedCharacter = allCharactersPool.find(char => char.id === characterId);
            }
        }
        
        // 특별 이벤트 입력 내용 확인
        let specialEventDescription = null;
        if (selectedOptions.some(opt => opt.type === 'special-event')) {
            const specialEventInput = document.getElementById('special-event-input');
            if (specialEventInput && specialEventInput.value.trim()) {
                specialEventDescription = specialEventInput.value.trim();
            }
        }
        
        // 진행 상태 표시
        showGenerationProgress();
        
        // AI로 페이지 생성
        const newPageData = await generatePageWithAI(selectedOptions, selectedCharacter, specialEventDescription);
        
        if (newPageData) {
            // 루나 차감
            await deductLuna(totalCost);
            
            // Firebase에 저장
            await saveNewPageToFirebase(newPageData, selectedOptions, totalCost);
            
            // 캐시 업데이트
            storyCache.set(newPageData.pageNumber, newPageData);
            
            // 새 페이지로 이동
            await updateTotalPages();
            await loadStoryPage(newPageData.pageNumber);
            
            // 모달 닫기
            closePageGenerationModal();
            
            console.log('새 페이지 생성 완료:', newPageData.pageNumber);
        }
        
    } catch (error) {
        console.error('페이지 생성 중 오류:', error);
        alert('페이지 생성 중 오류가 발생했습니다.');
    } finally {
        isGeneratingPage = false;
        hideGenerationProgress();
    }
}

// 생성 진행 상태 표시
function showGenerationProgress() {
    const progressElement = document.getElementById('generation-progress');
    const actionsElement = document.querySelector('.generation-actions');
    
    if (progressElement) progressElement.classList.remove('hidden');
    if (actionsElement) actionsElement.style.display = 'none';
}

// 생성 진행 상태 숨김
function hideGenerationProgress() {
    const progressElement = document.getElementById('generation-progress');
    const actionsElement = document.querySelector('.generation-actions');
    
    if (progressElement) progressElement.classList.add('hidden');
    if (actionsElement) actionsElement.style.display = 'flex';
}

// AI로 페이지 생성
async function generatePageWithAI(selectedOptions, selectedCharacter, specialEventDescription) {
    try {
        // 스토리 ID 생성 (현재 사용자 기반)
        const storyId = currentUser.uid;
        
        // 캐시에서 스토리 디테일 가져오기
        const storyDetails = await storyCache.getDetails(storyId);
        console.log('스토리 디테일 로드 완료');
        
        // 컨텍스트 수집
        const context = await gatherStoryContext();
        
        // 등장 캐릭터 자동 선택
        const appearingCharacters = selectAppearingCharacters(selectedOptions, selectedCharacter);
        
        // AI 프롬프트 생성 (디테일 정보 포함)
        const prompt = createStoryPromptWithDetails(context, selectedOptions, selectedCharacter, specialEventDescription, storyDetails, appearingCharacters);
        
        // AI 생성 요청
        const result = await generateWithFallback(prompt);
        const response = await result.response;
        const generatedContent = response.text();
        
        if (!generatedContent) {
            throw new Error('AI 생성 실패');
        }
        
        // 생성된 내용에서 새로운 디테일 추출
        const newDetails = detailExtractor.extractFromContent(generatedContent, appearingCharacters);
        console.log('새로운 디테일 추출 완료:', newDetails);
        
        // 로컬 캐시에 디테일 업데이트
        storyCache.updateDetailsLocal(storyId, newDetails);
        
        // 생성된 내용에서 장 제목 추출
        const extractedTitle = extractChapterTitle(generatedContent);
        
        // 페이지 데이터 구성
        const newPageNumber = totalStoryPages + 1;
        const pageData = {
            pageNumber: newPageNumber,
            title: extractedTitle || `제${newPageNumber}장`,
            content: generatedContent,
            characters: appearingCharacters,
            likes: 0,
            bookmarks: 0,
            createdAt: new Date().toISOString(),
            generator: currentUser.uid,
            generatorName: currentUser.email,
            cost: selectedOptions.reduce((sum, opt) => sum + opt.cost, 0),
            options: selectedOptions.map(opt => opt.type),
            extractedDetails: newDetails // 추출된 디테일 포함
        };
        
        // 캐시에 페이지 데이터 저장
        storyCache.set(newPageNumber, pageData);
        
        // Firebase에 디테일 저장 (비동기)
        setTimeout(async () => {
            try {
                await storyCache.saveDetailsToFirebase(storyId);
            } catch (error) {
                console.error('디테일 저장 실패:', error);
            }
        }, 1000);
        
        return pageData;
        
    } catch (error) {
        console.error('AI 페이지 생성 오류:', error);
        throw error;
    }
}

// 페이지 요약 생성
async function generatePageSummary(pageData) {
    try {
        const cleanContent = pageData.content.replace(/<[^>]*>/g, '').trim();
        const prompt = `다음 소설 페이지의 핵심 내용을 3-4줄로 요약해주세요. 중요한 사건, 캐릭터 행동, 스토리 진행상황을 포함하세요:

${cleanContent}`;
        
        const result = await generateWithFallback(prompt);
        const response = await result.response;
        const summary = response.text();
        
        return {
            pageNumber: pageData.pageNumber,
            title: pageData.title,
            summary: summary,
            characters: pageData.characters,
            keyEvents: extractKeyEvents(cleanContent)
        };
    } catch (error) {
        console.error('페이지 요약 생성 오류:', error);
        return {
            pageNumber: pageData.pageNumber,
            title: pageData.title,
            summary: pageData.content.replace(/<[^>]*>/g, '').slice(0, 200) + '...',
            characters: pageData.characters,
            keyEvents: []
        };
    }
}

// 핵심 사건 추출
function extractKeyEvents(content) {
    const events = [];
    const sentences = content.split(/[.!?]/);
    
    // 전투, 대화, 발견 등 키워드가 포함된 문장들을 핵심 사건으로 추출
    const keywords = ['전투', '싸움', '공격', '마법', '스킬', '발견', '만남', '대화', '결정', '변화'];
    
    sentences.forEach(sentence => {
        if (keywords.some(keyword => sentence.includes(keyword)) && sentence.length > 10) {
            events.push(sentence.trim());
        }
    });
    
    return events.slice(0, 3); // 최대 3개의 핵심 사건
}

// 생성된 내용에서 장 제목 추출
function extractChapterTitle(content) {
    // HTML 태그 제거
    const cleanContent = content.replace(/<[^>]*>/g, '');
    
    // 제X장: 형태의 제목 찾기
    const chapterMatch = cleanContent.match(/제(\d+)장[:\s]*([^\n\r]*)/i);
    if (chapterMatch) {
        const chapterNum = chapterMatch[1];
        const chapterTitle = chapterMatch[2].trim();
        return chapterTitle ? `제${chapterNum}장: ${chapterTitle}` : `제${chapterNum}장`;
    }
    
    // h4 태그 내의 제목 찾기
    const h4Match = content.match(/<h4[^>]*>([^<]*제\d+장[^<]*)<\/h4>/i);
    if (h4Match) {
        return h4Match[1].trim();
    }
    
    // h2, h3 태그 내의 제목 찾기
    const headerMatch = content.match(/<h[23][^>]*>([^<]*제\d+장[^<]*)<\/h[23]>/i);
    if (headerMatch) {
        return headerMatch[1].trim();
    }
    
    return null; // 제목을 찾지 못한 경우
}

// 챕터 요약 생성 (5페이지마다)
async function generateChapterSummary(startPage, endPage) {
    try {
        const pages = [];
        for (let i = startPage; i <= endPage; i++) {
            const pageData = storyCache.get(i) || await fetchStoryPageFromFirebase(i);
            if (pageData) {
                pages.push(await generatePageSummary(pageData));
            }
        }
        
        const combinedSummary = pages.map(p => `${p.pageNumber}장: ${p.summary}`).join('\n');
        const prompt = `다음 5개 페이지의 요약을 하나의 챕터 요약으로 통합해주세요. 주요 스토리 흐름과 캐릭터 발전을 중심으로 작성하세요:\n\n${combinedSummary}`;
        
        const result = await generateWithFallback(prompt);
        const response = await result.response;
        const chapterSummary = response.text();
        
        // Firebase에 챕터 요약 저장
        const summaryRef = doc(db, 'story_summaries', `chapter_${startPage}_${endPage}`);
        await setDoc(summaryRef, {
            type: 'chapter',
            startPage,
            endPage,
            summary: chapterSummary,
            pages: pages,
            createdAt: new Date().toISOString()
        });
        
        return chapterSummary;
    } catch (error) {
        console.error('챕터 요약 생성 오류:', error);
        return null;
    }
}

// 스토리 컨텍스트 수집 (개선된 버전)
async function gatherStoryContext() {
    const context = {
        worldview: '',
        recentPages: [],
        chapterSummaries: [],
        characterStates: {},
        totalPages: totalStoryPages
    };
    
    try {
        // 세계관 정보 가져오기
        const metadataRef = doc(db, 'story_metadata', 'main');
        const metadataDoc = await getDoc(metadataRef);
        if (metadataDoc.exists()) {
            context.worldview = metadataDoc.data().worldview || '';
        }
        
        // 최근 3페이지 가져오기 (상세 내용)
        const startPage = Math.max(1, totalStoryPages - 2);
        for (let i = startPage; i <= totalStoryPages; i++) {
            const pageData = storyCache.get(i) || await fetchStoryPageFromFirebase(i);
            if (pageData) {
                context.recentPages.push({
                    pageNumber: pageData.pageNumber,
                    title: pageData.title,
                    content: pageData.content,
                    characters: pageData.characters
                });
            }
        }
        
        // 챕터 요약들 가져오기 (5페이지 단위)
        const summariesRef = collection(db, 'story_summaries');
        const summariesQuery = query(summariesRef, where('type', '==', 'chapter'));
        const summariesSnapshot = await getDocs(summariesQuery);
        
        summariesSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.endPage < totalStoryPages - 2) { // 최근 3페이지는 제외
                context.chapterSummaries.push({
                    startPage: data.startPage,
                    endPage: data.endPage,
                    summary: data.summary
                });
            }
        });
        
        // 챕터 요약이 없는 구간이 있다면 생성
        await ensureChapterSummaries(totalStoryPages);
        
        // 캐릭터 상태 정보 수집
        if (allCharactersPool && allCharactersPool.length > 0) {
            allCharactersPool.forEach(char => {
                context.characterStates[char.id] = {
                    name: char.name,
                    class: char.character_class || char.class,
                    skills: char.skills || [],
                    wins: char.wins || 0,
                    losses: char.losses || 0,
                    lastAppearance: 0
                };
            });
        }
        
        return context;
        
    } catch (error) {
        console.error('컨텍스트 수집 오류:', error);
        return context;
    }
}

// 챕터 요약 보장 함수
async function ensureChapterSummaries(totalPages) {
    try {
        // 5페이지 단위로 챕터 요약이 있는지 확인하고 없으면 생성
        for (let start = 1; start <= totalPages - 5; start += 5) {
            const end = Math.min(start + 4, totalPages - 3); // 최근 3페이지는 제외
            
            const summaryRef = doc(db, 'story_summaries', `chapter_${start}_${end}`);
            const summaryDoc = await getDoc(summaryRef);
            
            if (!summaryDoc.exists() && end >= start) {
                console.log(`챕터 요약 생성 중: ${start}-${end}페이지`);
                await generateChapterSummary(start, end);
            }
        }
    } catch (error) {
        console.error('챕터 요약 보장 오류:', error);
    }
}

// AI 프롬프트 생성
function createStoryPrompt(context, selectedOptions, selectedCharacter, specialEventDescription) {
    let prompt = `당신은 '레전드 아레나 연대기'라는 판타지 소설의 작가입니다. 다음 조건에 맞는 새로운 페이지를 작성해주세요.

`;
    
    // 세계관 정보
    if (context.worldview) {
        prompt += `**세계관:**\n${context.worldview}\n\n`;
    }
    
    // 전체 스토리 맥락 (챕터 요약들)
    if (context.chapterSummaries.length > 0) {
        prompt += `**전체 스토리 맥락:**\n`;
        context.chapterSummaries.forEach(chapter => {
            prompt += `- ${chapter.startPage}-${chapter.endPage}장: ${chapter.summary}\n`;
        });
        prompt += `\n`;
    }
    
    // 최근 스토리 흐름 (상세)
    if (context.recentPages.length > 0) {
        prompt += `**최근 스토리 흐름 (상세):**\n`;
        context.recentPages.forEach((page, index) => {
            prompt += `- 페이지 ${page.pageNumber}: ${page.title}\n`;
            prompt += `  등장인물: ${page.characters.map(c => c.name || c).join(', ')}\n`;
            
            // 마지막 페이지의 경우 내용의 마지막 부분을 포함
            if (index === context.recentPages.length - 1 && page.content) {
                // HTML 태그 제거하고 마지막 300자 정도만 추출
                const cleanContent = page.content.replace(/<[^>]*>/g, '').trim();
                const lastPart = cleanContent.length > 300 ? 
                    '...' + cleanContent.slice(-300) : cleanContent;
                prompt += `  마지막 상황: ${lastPart}\n`;
            }
        });
        prompt += `\n`;
    }
    
    // 선택된 옵션에 따른 요구사항
    prompt += `**작성 요구사항:**\n`;
    
    selectedOptions.forEach(option => {
        switch (option.type) {
            case 'basic':
                prompt += `- 자연스러운 스토리 진행으로 작성\n`;
                break;
            case 'character-focus':
                if (selectedCharacter) {
                    prompt += `- 기존 스토리의 자연스러운 흐름 속에서 ${selectedCharacter.name} 캐릭터가 조연으로 등장하여 의미 있는 역할을 하도록 작성\n`;
                    prompt += `- ${selectedCharacter.name}의 클래스: ${selectedCharacter.character_class || selectedCharacter.class}\n`;
                    if (selectedCharacter.skills && selectedCharacter.skills.length > 0) {
                        prompt += `- ${selectedCharacter.name}의 주요 스킬: ${selectedCharacter.skills.map(s => s.name || s.skill_name).join(', ')}\n`;
                    }
                    prompt += `- ⚠️ 주의: ${selectedCharacter.name}는 주인공이 아닌 조연으로 등장시키고, 기존 스토리와의 연결성을 절대 끊지 말며, 이전 상황에서 자연스럽게 이어지는 범위 내에서만 활용할 것\n`;
                    prompt += `- ⚠️ 시점 주의: 소설의 주인공 시점을 바꾸지 말고, ${selectedCharacter.name}는 조연으로서 스토리에 기여하도록 할 것\n`;
                }
                break;
            case 'long-page':
                prompt += `- 평소보다 더 자세하고 긴 내용으로 작성 (최소 800자 이상)\n`;
                break;
            case 'special-event':
                if (specialEventDescription) {
                    prompt += `- 다음 특별 이벤트를 기존 스토리 흐름에 자연스럽게 녹여서 작성: ${specialEventDescription}\n`;
                } else {
                    prompt += `- 기존 스토리 흐름에 자연스럽게 어울리는 특별한 이벤트 포함 (전투, 모험, 발견, 만남 등)\n`;
                }
                break;
        }
    });
    
    // 등장 캐릭터 정보 추가
    const appearingCharacters = selectAppearingCharacters(selectedOptions, selectedCharacter);
    if (appearingCharacters.length > 0) {
        prompt += `\n**🚨 필수 등장 캐릭터 (절대 누락 금지) 🚨:**\n`;
        appearingCharacters.forEach(char => {
            const charData = allCharactersPool.find(c => c.id === char.id);
            if (charData) {
                prompt += `- ${char.name} (${char.role === 'main' ? '주인공' : '조연'}): ${charData.character_class || charData.class}\n`;
                if (charData.skills && charData.skills.length > 0) {
                    prompt += `  스킬: ${charData.skills.map(s => s.name || s.skill_name).join(', ')}\n`;
                }
            }
        });
        prompt += `\n⚠️ 위 캐릭터들은 모두 스토리에 등장해야 하며, 각자의 역할과 대사가 있어야 합니다.\n`;
        prompt += `⚠️ 캐릭터 이름을 정확히 사용하고, 각 캐릭터의 개성과 스킬을 반영해주세요.\n\n`;
    }
    
    prompt += `\n**🎯 핵심 작성 규칙:**\n`;
    prompt += `1. 한국어로 작성\n`;
    prompt += `2. HTML 태그 사용 가능 (p, h4, strong, em, div 등)\n`;
    prompt += `3. 🔗 **스토리 연결성 최우선**: 위에 제시된 전체 스토리 맥락과 최근 상황을 철저히 분석하여 모순 없는 자연스러운 이어짐 보장\n`;
    prompt += `4. 📚 **설정 일관성**: 기존 캐릭터들의 성격, 능력, 관계, 과거 사건들과 완벽히 일치하도록 작성\n`;
    prompt += `5. 🎭 **캐릭터 연속성**: 캐릭터들의 이전 행동, 감정 상태, 목표가 자연스럽게 이어지도록 작성\n`;
    prompt += `6. 🌍 **세계관 준수**: 설정된 세계관의 규칙, 마법 시스템, 사회 구조를 엄격히 따를 것\n`;
    prompt += `7. 🔥 **필수 캐릭터 포함**: 위에 명시된 필수 등장 캐릭터들을 반드시 스토리에 포함시키고, 각자 최소 1번 이상 대사나 행동을 하게 할 것\n`;
    prompt += `8. 💬 **능동적 참여**: 캐릭터들이 단순히 언급만 되는 것이 아니라 실제로 행동하고 대화하는 장면을 포함할 것\n`;
    prompt += `9. 🎪 **흥미진진한 전개**: 몰입감 있고 재미있는 스토리로 작성\n`;
    prompt += `10. 📖 **클리프행어**: 페이지 끝에 다음 이야기가 궁금해지는 요소 포함\n`;
    prompt += `🚨 **절대 금지사항**: 새로운 캐릭터가 등장한다고 해서 장소만 바뀌고 완전히 새로운 이야기를 시작하지 말 것. 반드시 이전 페이지의 상황과 자연스럽게 연결되어야 함\n`;
    if (context.recentPages.length > 0) {
        prompt += `11. 🚨 **직접 연결 필수**: 이전 페이지의 마지막 상황에서 시간적, 공간적, 상황적으로 자연스럽게 이어지도록 작성 (위에 제시된 '마지막 상황'을 반드시 참고하여 그 직후 상황부터 시작할 것)\n`;
    }
    if (context.chapterSummaries.length > 0) {
        prompt += `12. 📋 **전체 맥락 반영**: 위에 제시된 전체 스토리 맥락의 주요 사건들과 캐릭터 발전 과정을 고려하여 모순되지 않도록 작성\n`;
    }
    prompt += `13. 🔄 **연속성 우선**: 어떤 옵션이 선택되더라도 스토리의 연속성이 최우선이며, 옵션은 기존 스토리 흐름에 자연스럽게 녹여낼 것\n`;
    prompt += `\n`;
    
    prompt += `새로운 페이지의 내용만 작성해주세요:`;
    
    return prompt;
}

// 디테일 정보를 포함한 스토리 프롬프트 생성
function createStoryPromptWithDetails(context, selectedOptions, selectedCharacter, specialEventDescription, storyDetails, appearingCharacters) {
    let prompt = `당신은 '레전드 아레나 연대기'라는 판타지 소설의 작가입니다. 다음 조건에 맞는 새로운 페이지를 작성해주세요.

`;
    
    // 세계관 정보
    if (context.worldview) {
        prompt += `**세계관:**\n${context.worldview}\n\n`;
    }
    
    // 전체 스토리 맥락 (챕터 요약들)
    if (context.chapterSummaries.length > 0) {
        prompt += `**전체 스토리 맥락:**\n`;
        context.chapterSummaries.forEach(chapter => {
            prompt += `- ${chapter.startPage}-${chapter.endPage}장: ${chapter.summary}\n`;
        });
        prompt += `\n`;
    }
    
    // 스토리 디테일 정보 추가
    if (storyDetails && Object.keys(storyDetails.characters).length > 0) {
        prompt += `**🔍 중요한 스토리 디테일 (절대 무시하지 말 것):**\n`;
        
        // 캐릭터 상태 정보
        prompt += `**캐릭터 현재 상태:**\n`;
        Object.keys(storyDetails.characters).forEach(charId => {
            const charDetail = storyDetails.characters[charId];
            const charData = allCharactersPool.find(c => c.id === charId);
            if (charData && charDetail.currentState) {
                prompt += `- ${charData.name}: ${charDetail.currentState}\n`;
            }
            if (charData && charDetail.emotions && charDetail.emotions.length > 0) {
                prompt += `  감정 상태: ${charDetail.emotions.join(', ')}\n`;
            }
        });
        
        // 현재 상황 정보
        if (storyDetails.situations.current) {
            prompt += `**현재 상황:** ${storyDetails.situations.current}\n`;
        }
        
        // 위치 정보
        if (storyDetails.situations.location) {
            prompt += `**현재 위치:** ${storyDetails.situations.location}\n`;
        }
        
        // 활성 이벤트
        if (storyDetails.situations.activeEvents.length > 0) {
            prompt += `**진행 중인 이벤트:** ${storyDetails.situations.activeEvents.join(', ')}\n`;
        }
        
        // 미완료 약속들
        const pendingPromises = storyDetails.promises.filter(p => p.status === 'pending');
        if (pendingPromises.length > 0) {
            prompt += `**미완료 약속/계획:**\n`;
            pendingPromises.forEach(promise => {
                prompt += `- ${promise.content}\n`;
            });
        }
        
        // 캐릭터 관계 정보
        if (Object.keys(storyDetails.relationships).length > 0) {
            prompt += `**캐릭터 관계:**\n`;
            Object.keys(storyDetails.relationships).forEach(key => {
                prompt += `- ${key}: ${storyDetails.relationships[key]}\n`;
            });
        }
        
        // 중요 아이템
        if (Object.keys(storyDetails.items).length > 0) {
            prompt += `**중요 아이템:**\n`;
            Object.keys(storyDetails.items).forEach(itemName => {
                const item = storyDetails.items[itemName];
                prompt += `- ${itemName}: ${item.action} (${item.context})\n`;
            });
        }
        
        prompt += `\n⚠️ **디테일 준수 필수**: 위의 모든 디테일 정보는 이전 스토리에서 확립된 사실들입니다. 이를 무시하거나 모순되게 작성하지 마세요.\n\n`;
    }
    
    // 최근 스토리 흐름 (상세)
    if (context.recentPages.length > 0) {
        prompt += `**최근 스토리 흐름 (상세):**\n`;
        context.recentPages.forEach((page, index) => {
            prompt += `- 페이지 ${page.pageNumber}: ${page.title}\n`;
            prompt += `  등장인물: ${page.characters.map(c => c.name || c).join(', ')}\n`;
            
            // 마지막 페이지의 경우 내용의 마지막 부분을 포함
            if (index === context.recentPages.length - 1 && page.content) {
                // HTML 태그 제거하고 마지막 300자 정도만 추출
                const cleanContent = page.content.replace(/<[^>]*>/g, '').trim();
                const lastPart = cleanContent.length > 300 ? 
                    '...' + cleanContent.slice(-300) : cleanContent;
                prompt += `  마지막 상황: ${lastPart}\n`;
            }
        });
        prompt += `\n`;
    }
    
    // 선택된 옵션에 따른 요구사항
    prompt += `**작성 요구사항:**\n`;
    
    selectedOptions.forEach(option => {
        switch (option.type) {
            case 'basic':
                prompt += `- 자연스러운 스토리 진행으로 작성\n`;
                break;
            case 'character-focus':
                if (selectedCharacter) {
                    prompt += `- 기존 스토리의 자연스러운 흐름 속에서 ${selectedCharacter.name} 캐릭터가 조연으로 등장하여 의미 있는 역할을 하도록 작성\n`;
                    prompt += `- ${selectedCharacter.name}의 클래스: ${selectedCharacter.character_class || selectedCharacter.class}\n`;
                    if (selectedCharacter.skills && selectedCharacter.skills.length > 0) {
                        prompt += `- ${selectedCharacter.name}의 주요 스킬: ${selectedCharacter.skills.map(s => s.name || s.skill_name).join(', ')}\n`;
                    }
                    prompt += `- ⚠️ 주의: ${selectedCharacter.name}는 주인공이 아닌 조연으로 등장시키고, 기존 스토리와의 연결성을 절대 끊지 말며, 이전 상황에서 자연스럽게 이어지는 범위 내에서만 활용할 것\n`;
                    prompt += `- ⚠️ 시점 주의: 소설의 주인공 시점을 바꾸지 말고, ${selectedCharacter.name}는 조연으로서 스토리에 기여하도록 할 것\n`;
                }
                break;
            case 'long-page':
                prompt += `- 평소보다 더 자세하고 긴 내용으로 작성 (최소 800자 이상)\n`;
                break;
            case 'special-event':
                if (specialEventDescription) {
                    prompt += `- 다음 특별 이벤트를 기존 스토리 흐름에 자연스럽게 녹여서 작성: ${specialEventDescription}\n`;
                } else {
                    prompt += `- 기존 스토리 흐름에 자연스럽게 어울리는 특별한 이벤트 포함 (전투, 모험, 발견, 만남 등)\n`;
                }
                break;
        }
    });
    
    // 등장 캐릭터 정보 추가
    if (appearingCharacters.length > 0) {
        prompt += `\n**🚨 필수 등장 캐릭터 (절대 누락 금지) 🚨:**\n`;
        appearingCharacters.forEach(char => {
            const charData = allCharactersPool.find(c => c.id === char.id);
            if (charData) {
                prompt += `- ${char.name} (${char.role === 'main' ? '주인공' : '조연'}): ${charData.character_class || charData.class}\n`;
                if (charData.skills && charData.skills.length > 0) {
                    prompt += `  스킬: ${charData.skills.map(s => s.name || s.skill_name).join(', ')}\n`;
                }
                
                // 캐릭터별 디테일 정보 추가
                if (storyDetails.characters[char.id]) {
                    const charDetail = storyDetails.characters[char.id];
                    if (charDetail.currentState) {
                        prompt += `  현재 상태: ${charDetail.currentState}\n`;
                    }
                    if (charDetail.emotions && charDetail.emotions.length > 0) {
                        prompt += `  감정: ${charDetail.emotions.join(', ')}\n`;
                    }
                }
            }
        });
        prompt += `\n⚠️ 위 캐릭터들은 모두 스토리에 등장해야 하며, 각자의 역할과 대사가 있어야 합니다.\n`;
        prompt += `⚠️ 캐릭터 이름을 정확히 사용하고, 각 캐릭터의 개성과 스킬, 현재 상태를 반영해주세요.\n\n`;
    }
    
    prompt += `\n**🎯 핵심 작성 규칙:**\n`;
    prompt += `1. 한국어로 작성\n`;
    prompt += `2. HTML 태그 사용 가능 (p, h4, strong, em, div 등)\n`;
    prompt += `3. 🔗 **스토리 연결성 최우선**: 위에 제시된 전체 스토리 맥락과 최근 상황을 철저히 분석하여 모순 없는 자연스러운 이어짐 보장\n`;
    prompt += `4. 📚 **설정 일관성**: 기존 캐릭터들의 성격, 능력, 관계, 과거 사건들과 완벽히 일치하도록 작성\n`;
    prompt += `5. 🎭 **캐릭터 연속성**: 캐릭터들의 이전 행동, 감정 상태, 목표가 자연스럽게 이어지도록 작성\n`;
    prompt += `6. 🌍 **세계관 준수**: 설정된 세계관의 규칙, 마법 시스템, 사회 구조를 엄격히 따를 것\n`;
    prompt += `7. 🔥 **필수 캐릭터 포함**: 위에 명시된 필수 등장 캐릭터들을 반드시 스토리에 포함시키고, 각자 최소 1번 이상 대사나 행동을 하게 할 것\n`;
    prompt += `8. 💬 **능동적 참여**: 캐릭터들이 단순히 언급만 되는 것이 아니라 실제로 행동하고 대화하는 장면을 포함할 것\n`;
    prompt += `9. 🎪 **흥미진진한 전개**: 몰입감 있고 재미있는 스토리로 작성\n`;
    prompt += `10. 📖 **클리프행어**: 페이지 끝에 다음 이야기가 궁금해지는 요소 포함\n`;
    prompt += `11. 🔍 **디테일 일관성**: 위에 제시된 모든 디테일 정보를 엄격히 준수하고, 새로운 디테일이 추가될 때는 기존 정보와 모순되지 않도록 할 것\n`;
    prompt += `🚨 **절대 금지사항**: 새로운 캐릭터가 등장한다고 해서 장소만 바뀌고 완전히 새로운 이야기를 시작하지 말 것. 반드시 이전 페이지의 상황과 자연스럽게 연결되어야 함\n`;
    
    if (context.recentPages.length > 0) {
        prompt += `12. 🚨 **직접 연결 필수**: 이전 페이지의 마지막 상황에서 시간적, 공간적, 상황적으로 자연스럽게 이어지도록 작성 (위에 제시된 '마지막 상황'을 반드시 참고하여 그 직후 상황부터 시작할 것)\n`;
    }
    if (context.chapterSummaries.length > 0) {
        prompt += `13. 📋 **전체 맥락 반영**: 위에 제시된 전체 스토리 맥락의 주요 사건들과 캐릭터 발전 과정을 고려하여 모순되지 않도록 작성\n`;
    }
    prompt += `14. 🔄 **연속성 우선**: 어떤 옵션이 선택되더라도 스토리의 연속성이 최우선이며, 옵션은 기존 스토리 흐름에 자연스럽게 녹여낼 것\n`;
    prompt += `\n`;
    
    prompt += `새로운 페이지의 내용만 작성해주세요:`;
    
    return prompt;
}

// 등장 캐릭터 자동 선택
function selectAppearingCharacters(selectedOptions, selectedCharacter) {
    const appearingCharacters = [];
    
    // 특정 캐릭터가 선택된 경우 (캐릭터 중심 옵션)
    if (selectedCharacter) {
        appearingCharacters.push({
            id: selectedCharacter.id,
            name: selectedCharacter.name,
            role: 'supporting'  // 조연으로 변경
        });
    }
    
    // 특별 이벤트 옵션이 선택된 경우에만 추가 캐릭터 자동 선택 - 기능 비활성화
    // const hasSpecialEvent = selectedOptions.some(opt => opt.type === 'special-event');
    
    // if (hasSpecialEvent) {
    //     // 추가 캐릭터 자동 선택 (인기도, 균형, 최근 등장 빈도 고려)
    //     const availableCharacters = allCharactersPool.filter(char => 
    //         !selectedCharacter || char.id !== selectedCharacter.id
    //     );
    //     
    //     // 특별 이벤트면 1명 추가
    //     const additionalCount = Math.min(1, availableCharacters.length);
    //     
    //     const shuffled = availableCharacters.sort(() => 0.5 - Math.random());
    //     
    //     for (let i = 0; i < additionalCount; i++) {
    //         appearingCharacters.push({
    //             id: shuffled[i].id,
    //             name: shuffled[i].name,
    //             role: 'supporting'
    //         });
    //     }
    // }
    
    // 일반 스토리(basic)나 캐릭터 중심(character-focus) 옵션만 선택된 경우에는 추가 캐릭터 자동 선택 안함
    // 캐릭터 중심 옵션은 선택된 캐릭터만 등장하고, 기존 스토리의 연속성이 더 잘 유지됨
    
    return appearingCharacters;
}

// 루나 차감
async function deductLuna(amount) {
    try {
        const userRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
            const currentLuna = userDoc.data().luna || 0;
            const newLuna = Math.max(0, currentLuna - amount);
            
            await updateDoc(userRef, { luna: newLuna });
            
            // UI 업데이트
            const lunaElement = document.getElementById('luna-amount');
            if (lunaElement) {
                lunaElement.textContent = newLuna;
            }
        }
    } catch (error) {
        console.error('루나 차감 오류:', error);
        throw error;
    }
}

// Firebase에 새 페이지 저장
async function saveNewPageToFirebase(pageData, selectedOptions, totalCost) {
    try {
        // 페이지 저장
        const pagesRef = collection(db, 'story_pages');
        await addDoc(pagesRef, pageData);
        
        // 메타데이터 업데이트
        const metadataRef = doc(db, 'story_metadata', 'main');
        await updateDoc(metadataRef, {
            totalPages: pageData.pageNumber,
            lastUpdated: new Date().toISOString()
        });
        
        // 새로운 챕터 완성 시 요약 생성 (5페이지 단위)
        if (pageData.pageNumber % 5 === 0 && pageData.pageNumber >= 5) {
            const startPage = pageData.pageNumber - 4;
            const endPage = pageData.pageNumber;
            
            console.log(`새 챕터 완성: ${startPage}-${endPage}페이지 요약 생성 중...`);
            try {
                await generateChapterSummary(startPage, endPage);
                console.log(`챕터 요약 생성 완료: ${startPage}-${endPage}페이지`);
            } catch (summaryError) {
                console.error('챕터 요약 생성 오류:', summaryError);
                // 요약 생성 실패해도 페이지 저장은 성공으로 처리
            }
        }
        
        console.log('새 페이지 Firebase 저장 완료');
        
    } catch (error) {
        console.error('Firebase 저장 오류:', error);
        throw error;
    }
}

// 페이지 좋아요 토글
async function togglePageLike() {
    // 구현 예정
    console.log('페이지 좋아요 기능 - 구현 예정');
}

// 페이지 북마크 토글
async function togglePageBookmark() {
    // 구현 예정
    console.log('페이지 북마크 기능 - 구현 예정');
}

// 현재 페이지 삭제 (비밀번호 확인)
async function deleteCurrentPage() {
    // 비밀번호 확인
    const password = prompt('페이지 삭제를 위해 비밀번호를 입력하세요:');
    if (password !== '4321') {
        alert('비밀번호가 틀렸습니다.');
        return;
    }
    
    const currentPageNum = parseInt(document.getElementById('current-page-num').textContent);
    
    let confirmMessage = `정말로 ${currentPageNum}페이지를 삭제하시겠습니까?`;
    if (totalStoryPages <= 1) {
        confirmMessage = '첫 페이지를 삭제하고 새로운 기본 페이지를 생성하시겠습니까?';
    }
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    try {
        // Firebase에서 현재 페이지 찾기 및 삭제
        const pagesRef = collection(db, 'story_pages');
        const q = query(pagesRef, where('pageNumber', '==', currentPageNum));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            const docToDelete = querySnapshot.docs[0];
            await deleteDoc(docToDelete.ref);
            
            // 캐시에서 제거
            storyCache.delete(currentPageNum);
            
            // 삭제된 페이지보다 큰 페이지 번호들을 1씩 감소
            const allPagesQuery = query(pagesRef, where('pageNumber', '>', currentPageNum));
            const allPagesSnapshot = await getDocs(allPagesQuery);
            
            const batch = writeBatch(db);
            allPagesSnapshot.docs.forEach(doc => {
                const newPageNumber = doc.data().pageNumber - 1;
                batch.update(doc.ref, { pageNumber: newPageNumber });
                
                // 캐시 업데이트
                const pageData = doc.data();
                pageData.pageNumber = newPageNumber;
                storyCache.set(newPageNumber, pageData);
                storyCache.delete(doc.data().pageNumber);
            });
            
            await batch.commit();
            
            // 첫 페이지를 삭제한 경우 새로운 기본 페이지 생성
            if (totalStoryPages <= 1) {
                // 메타데이터 초기화
                const metadataRef = doc(db, 'story_metadata', 'main');
                await updateDoc(metadataRef, {
                    totalPages: 0,
                    lastUpdated: new Date().toISOString()
                });
                
                // 새로운 기본 페이지 생성
                await createDefaultFirstPage();
                console.log('첫 페이지 삭제 후 새로운 기본 페이지 생성 완료');
            } else {
                // 메타데이터 업데이트
                const metadataRef = doc(db, 'story_metadata', 'main');
                await updateDoc(metadataRef, {
                    totalPages: totalStoryPages - 1,
                    lastUpdated: new Date().toISOString()
                });
                
                // 적절한 페이지로 이동
                await updateTotalPages();
                const targetPage = Math.min(currentPageNum, totalStoryPages - 1);
                await loadStoryPage(targetPage || 1);
                console.log(`${currentPageNum}페이지 삭제 완료`);
            }
        }
        
    } catch (error) {
        console.error('페이지 삭제 오류:', error);
        alert('페이지 삭제 중 오류가 발생했습니다.');
    }
}

// 최신 페이지 삭제 (관리자 전용)
async function deleteLatestPage() {
    if (!currentUser || currentUser.email !== 'admin@legendsarena.com') {
        alert('관리자만 삭제할 수 있습니다.');
        return;
    }
    
    let confirmMessage = '정말로 최신 페이지를 삭제하시겠습니까?';
    if (totalStoryPages <= 1) {
        confirmMessage = '첫 페이지를 삭제하고 새로운 기본 페이지를 생성하시겠습니까?';
    }
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    try {
        // Firebase에서 최신 페이지 찾기 및 삭제
        const pagesRef = collection(db, 'story_pages');
        const q = query(pagesRef, where('pageNumber', '==', totalStoryPages));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            const docToDelete = querySnapshot.docs[0];
            await deleteDoc(docToDelete.ref);
            
            // 캐시에서 제거
            storyCache.delete(totalStoryPages);
            
            // 첫 페이지를 삭제한 경우 새로운 기본 페이지 생성
            if (totalStoryPages <= 1) {
                // 메타데이터 초기화
                const metadataRef = doc(db, 'story_metadata', 'main');
                await updateDoc(metadataRef, {
                    totalPages: 0,
                    lastUpdated: new Date().toISOString()
                });
                
                // 새로운 기본 페이지 생성
                await createDefaultFirstPage();
                console.log('첫 페이지 삭제 후 새로운 기본 페이지 생성 완료');
            } else {
                // 메타데이터 업데이트
                const metadataRef = doc(db, 'story_metadata', 'main');
                await updateDoc(metadataRef, {
                    totalPages: totalStoryPages - 1,
                    lastUpdated: new Date().toISOString()
                });
                
                // 이전 페이지로 이동
                await updateTotalPages();
                await loadStoryPage(totalStoryPages);
                console.log('최신 페이지 삭제 완료');
            }
        }
        
    } catch (error) {
        console.error('페이지 삭제 오류:', error);
        alert('페이지 삭제 중 오류가 발생했습니다.');
    }
}

// 소설 시스템 전역 함수 등록
window.initializeStorySystem = initializeStorySystem;
window.loadStoryPage = loadStoryPage;
window.showPageGenerationModal = showPageGenerationModal;
window.closePageGenerationModal = closePageGenerationModal;
window.generateNewPage = generateNewPage;
window.togglePageLike = togglePageLike;
window.togglePageBookmark = togglePageBookmark;
window.deleteLatestPage = deleteLatestPage;
window.deleteCurrentPage = deleteCurrentPage;

console.log('소설 시스템 모듈 로드 완료');