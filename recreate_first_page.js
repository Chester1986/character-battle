// 첫 페이지 재생성 스크립트
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, deleteDoc, addDoc, setDoc, doc } = require('firebase/firestore');
require('dotenv').config();

// Firebase 설정
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function recreateFirstPage() {
    try {
        console.log('첫 페이지 재생성 시작...');
        
        // 기존 첫 페이지 삭제
        const pagesRef = collection(db, 'story_pages');
        const q = query(pagesRef, where('pageNumber', '==', 1));
        const querySnapshot = await getDocs(q);
        
        for (const docSnapshot of querySnapshot.docs) {
            await deleteDoc(docSnapshot.ref);
            console.log('기존 첫 페이지 삭제됨:', docSnapshot.id);
        }
        
        // 새로운 긴 소설 형태의 첫 페이지 내용
        const defaultContent = `
        <h4>제1장: 차원의 균열과 레전드 아레나의 탄생</h4>
        
        <p><strong>태초의 혼돈</strong></p>
        <p>우주가 창조된 지 수십억 년이 흘렀을 때, 무수한 차원들 사이에 균열이 생기기 시작했다. 이 균열들은 단순한 공간의 틈이 아니었다. 각기 다른 법칙과 시간의 흐름을 가진 세계들이 서로 충돌하며 만들어낸, 현실과 환상이 뒤섞인 신비로운 공간이었다.</p>
        
        <p>고대 마법사들은 이 현상을 '차원 융합'이라 불렀고, 과학자들은 '시공간 특이점'이라 명명했다. 하지만 그 누구도 이 현상의 진정한 의미를 깨닫지 못했다. 이것은 우주 자체가 선택한 시험장이었던 것이다.</p>
        
        <p><strong>아레나의 형성</strong></p>
        <p>차원 균열들이 하나로 수렴하면서, 거대한 원형의 공간이 형성되었다. 이 공간은 물리 법칙을 초월한 곳으로, 중력은 의지에 따라 변하고, 시간은 감정에 따라 빨라지거나 느려졌다. 하늘에는 수십 개의 태양과 달이 동시에 떠 있었고, 땅은 수정처럼 투명한 바닥 아래로 무한한 별들이 흐르는 모습을 보여주었다.</p>
        
        <p>이 공간의 중앙에는 거대한 원형 무대가 솟아올랐다. 무대의 표면은 살아있는 것처럼 맥박치며, 그 위에 서는 자의 마음을 읽어 최적의 전투 환경을 만들어냈다. 사막을 원하면 뜨거운 모래가 펼쳐지고, 숲을 원하면 고대의 나무들이 자라났다. 바다를 원하면 깊고 푸른 물결이 일렁였다.</p>
        
        <p><strong>루나의 발견</strong></p>
        <p>아레나가 완성된 후, 그 중심부에서 신비로운 에너지가 발견되었다. 이 에너지는 달빛처럼 은은하게 빛나며, 만지는 자에게 무한한 가능성을 느끼게 했다. 고대의 현자들은 이를 '루나(Luna)'라 명명했다.</p>
        
        <p>루나는 단순한 에너지가 아니었다. 그것은 의식을 가진 존재였으며, 순수한 의지와 용기를 가진 자들에게만 자신의 힘을 나누어주었다. 루나를 얻은 자들은 자신의 한계를 뛰어넘을 수 있었고, 새로운 능력을 개발하거나 기존의 힘을 강화할 수 있었다.</p>
        
        <p><strong>첫 번째 전사들</strong></p>
        <p>차원 균열을 통해 다양한 세계에서 전사들이 아레나로 끌려오기 시작했다. 어떤 이는 자신의 의지로, 어떤 이는 운명에 이끌려, 또 어떤 이는 복수나 명예를 위해 이곳에 발을 들였다.</p>
        
        <p>첫 번째로 도착한 전사는 '강철의 성기사' 아르투리우스였다. 그는 멸망한 왕국의 마지막 기사로, 자신의 세계를 구하기 위한 힘을 찾아 헤매던 중 아레나에 도달했다. 그의 뒤를 이어 '그림자 암살자' 카게, '원소 마법사' 엘레나, '야수 전사' 그롬 등이 차례로 나타났다.</p>
        
        <p><strong>첫 번째 전투</strong></p>
        <p>아르투리우스와 카게 사이에 벌어진 첫 번째 전투는 아레나의 역사를 바꾸었다. 두 전사의 대결은 3일 3밤을 지속되었고, 그들의 의지와 기술이 충돌할 때마다 아레나 전체가 진동했다. 마침내 아르투리우스가 승리했을 때, 하늘에서 루나의 빛이 내려와 그를 축복했다.</p>
        
        <p>이 순간, 아레나는 깨달았다. 이곳은 단순한 전투장이 아니라, 영혼의 성장과 진화를 위한 신성한 공간이라는 것을. 승부의 결과보다 중요한 것은 전사들이 보여주는 용기, 명예, 그리고 성장하려는 의지였다.</p>
        
        <p><strong>예언의 기록</strong></p>
        <p>고대의 예언서 '아스트랄 코덱스'에는 이런 구절이 적혀있다:</p>
        
        <div style="background: linear-gradient(135deg, #1e3c72, #2a5298); padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #4a9eff;">
            <p style="font-style: italic; color: #e8f4fd; margin: 0; text-align: center; font-size: 1.1em;">
                "차원이 하나로 모이는 곳에서,<br>
                영혼의 진정한 힘이 시험받으리라.<br>
                승리하는 자는 루나의 축복을 받고,<br>
                패배하는 자는 더 강한 의지로 일어서리라.<br>
                이곳에서 벌어지는 모든 전투는<br>
                우주의 균형을 지키는 성스러운 의식이니,<br>
                전사여, 두려워하지 말고 나아가라."
            </p>
        </div>
        
        <p><strong>현재의 아레나</strong></p>
        <p>수천 년이 흘러 지금에 이르기까지, 레전드 아레나는 계속해서 새로운 전사들을 맞이하고 있다. 각자의 사연과 목표를 가진 영웅들이 이곳에서 만나 자신의 한계에 도전한다. 어떤 이는 잃어버린 것을 되찾기 위해, 어떤 이는 새로운 힘을 얻기 위해, 또 어떤 이는 단순히 강해지고 싶어서 이곳에 온다.</p>
        
        <p>아레나는 모든 전사를 공평하게 대한다. 출신이나 과거는 중요하지 않다. 오직 현재 이 순간의 의지와 용기만이 승부를 가른다. 그리고 모든 전투가 끝난 후, 승자와 패자 모두 한 단계 성장한 모습으로 아레나를 떠난다.</p>
        
        <p><strong>새로운 전설의 시작</strong></p>
        <p>이제 당신의 영웅들이 이 전설적인 무대에 발을 들이려 한다. 그들 각자가 가진 독특한 능력과 배경 이야기는 아레나의 역사에 새로운 장을 추가할 것이다. 승리와 패배, 우정과 라이벌 관계, 성장과 깨달음의 순간들이 펼쳐질 것이다.</p>
        
        <p>루나의 빛이 다시 한 번 아레나를 비추며, 새로운 이야기의 시작을 알린다. 차원의 균열 너머에서 들려오는 것은 전사들의 함성인가, 아니면 운명의 부름인가?</p>
        
        <div style="text-align: center; margin-top: 40px; padding: 20px; background: rgba(74, 158, 255, 0.1); border-radius: 10px;">
            <p style="font-size: 1.2em; font-weight: bold; color: #4a9eff; margin: 0;">
                "모든 전설은 첫 걸음에서 시작된다."<br>
                <span style="font-size: 0.9em; font-style: italic; color: #7fb3ff;">- 아스트랄 코덱스 제1장 -</span>
            </p>
        </div>
        
        <div style="margin-top: 30px; padding: 15px; background: rgba(255, 215, 0, 0.1); border-radius: 8px; border-left: 3px solid #ffd700;">
            <p style="margin: 0; font-size: 0.95em; color: #b8860b; font-style: italic;">
                <strong>아레나 기록관의 주석:</strong> 이 기록은 아레나에 도착한 모든 새로운 전사들에게 전해지는 공식 역사서의 첫 번째 장입니다. 당신의 모험이 이 위대한 이야기에 어떤 새로운 전설을 추가할지 기대됩니다.
            </p>
        </div>
    `;
        
        // 새 페이지 데이터 생성
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
        
        // Firebase에 새 페이지 저장
        await addDoc(pagesRef, pageData);
        console.log('새 첫 페이지 생성 완료');
        
        // 메타데이터 업데이트
        const metadataRef = doc(db, 'story_metadata', 'main');
        await setDoc(metadataRef, {
            totalPages: 1,
            lastUpdated: new Date().toISOString(),
            worldview: defaultContent
        }, { merge: true });
        
        console.log('첫 페이지 재생성 완료!');
        console.log('브라우저에서 Story 버튼을 클릭하여 새로운 내용을 확인하세요.');
        
    } catch (error) {
        console.error('첫 페이지 재생성 실패:', error);
    }
}

recreateFirstPage();