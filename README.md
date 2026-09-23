# 한국반려동물이동장례협회 홈페이지

정적 HTML 5페이지 구성. 서버·데이터베이스 없이 어떤 호스팅에도 그대로 올릴 수 있습니다.

## 파일 구성
| 파일 | 내용 |
|---|---|
| index.html | 메인 |
| about.html | 협회 소개 |
| program.html | 사업 안내 |
| petition.html | 청원 현황 |
| news.html | 소식 (게시판 목록) |
| news/*.html | 기사 페이지 — 관리자 화면(/admin/)에서 자동 생성 |
| news/_template.html | 기사 서식 (겉모양) |
| admin/ | 소식 관리자 화면 |
| css/style.css | 공통 스타일 |
| images/ | 이미지 (현재 임시 SVG) |
| sitemap.xml, robots.txt | 검색엔진 등록용 |

## 올리기 전에 반드시 바꿀 것

**1. 도메인**
모든 HTML과 sitemap.xml, robots.txt에서 `https://kmpfa.or.kr` 을 실제 도메인으로 일괄 치환.

**2. 검색엔진 인증 코드**
각 HTML `<head>` 안:
- `NAVER_VERIFICATION_CODE_HERE` → 네이버 서치어드바이저에서 받은 코드
- `GOOGLE_VERIFICATION_CODE_HERE` → 구글 서치콘솔에서 받은 코드

**3. 이미지 교체**
images/ 폴더의 SVG를 같은 이름의 JPG로 바꾸고, HTML에서 `.svg` → `.jpg` 치환. (CSS에는 이미지 경로가 없습니다)

드림위버에서는 디자인 보기에서 이미지를 클릭한 뒤 속성 패널의 Src 옆 폴더 아이콘으로 파일을 고르면 됩니다. 메인 슬라이드는 index.html 상단 `<div class="slides">` 안의 `<img>` 세 줄입니다.
| 파일명 | 규격 | 용도 |
|---|---|---|
| slide1.jpg, slide2.jpg, slide3.jpg | 1920×800 | 메인 배너 슬라이드 (index.html 안 <img> 태그) |
| problem.jpg | 800×600 | 왜 필요한가 |
| vehicle.jpg | 800×600 | 화장차 내부 |
| signature.jpg | 800×600 | 청원 골자 옆 |
| og.jpg | 1200×630 | 카카오톡·SNS 공유 미리보기 |
| logo.png | 512×512 | 구조화 데이터용 로고 |

**4. 기사 링크**
언론 게재 후 원문 URL 연결 — 관리자 화면에서 해당 글 수정.

## 검색 등록 순서
1. 도메인 연결 후 사이트 접속 확인
2. 네이버 서치어드바이저 (searchadvisor.naver.com) → 사이트 등록 → 소유 확인 → sitemap.xml 제출
3. 구글 서치콘솔 (search.google.com/search-console) → 속성 추가 → 소유 확인 → sitemap.xml 제출
4. 2~3주 후 검색 노출 확인

## 소식(게시판) 운영 방법

소식은 **관리자 화면 https://kmpfa.or.kr/admin/** 에서 씁니다. 파일을 직접 고치지 마세요.

- **글쓰기**: 관리자 화면 → 새 글 쓰기 → 제목·본문·사진 → 게시하기. 1~3분 뒤 사이트에 나타납니다.
- **언론 게재 URL 연결**: 해당 글 → 수정 → "언론 매체명·기사 주소" 입력 → 저장.
- **고치기·삭제**: 글 목록에서 수정/삭제.
- 게시할 때 기사 페이지, `news.html` 목록, 홈 "최근 소식" 3건, `sitemap.xml`, 이전글·다음글 링크가 한꺼번에 갱신됩니다.

**관리 열쇠(토큰)**
관리자 화면에 들어가려면 GitHub 토큰이 필요합니다. 만드는 법은 관리자 화면의 "관리 열쇠 만드는 법"에 있습니다.
(fine-grained 토큰 · fixemhot/kmpfa 저장소만 · Contents: Read and write · 1년 만료)
잃어버리거나 유출이 의심되면 GitHub › Settings › Developer settings › Personal access tokens 에서 삭제하고 새로 만드세요.

**자동으로 만들어지는 파일 (직접 고치면 다음 게시 때 덮어써집니다)**
| 파일 | 설명 |
|---|---|
| news/posts.json | 모든 소식 글의 원본 데이터 |
| news/*.html | 기사 페이지 (`_template.html` 제외) |
| news.html 의 `<!--@COUNT-->` `<!--@ROWS-->` `<!--@LD-->` 사이 | 전체 건수·목록 표·구조화 데이터 |
| index.html 의 `<!--@RECENT-->` 사이 | 홈 최근 소식 3건 |
| sitemap.xml 의 `<!--@NEWS-->` 사이 | 기사 주소 목록 |

표식(`<!--@...-->`) 바깥은 자유롭게 고쳐도 됩니다. 표식 자체는 지우지 마세요.

**기사 모양(머리글·메뉴·꼬리말·스타일) 바꾸기**
`news/_template.html`의 표식 바깥 부분을 고친 뒤, 관리자 화면 → 관리 도구 → "모든 기사 페이지 다시 만들기".

**보안 주의**
관리 열쇠가 이 사이트 주소(kmpfa.or.kr)의 브라우저 저장소에 보관되므로, 사이트의 어느 페이지에도 출처를 모르는 외부 스크립트(광고·방문자 분석 도구 등)를 넣지 마세요. 꼭 필요하면 넣기 전에 검토하세요.

## 청원 현황 갱신
petition.html의 `<table class="regions">` 행을 수정. 완료되면 `tag wip` → `tag ok`.
