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
| news/*.html | 기사 페이지 (news/_template.html = 새 기사 서식) |
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
언론 게재 후 원문 URL 연결 — 아래 "소식(게시판) 운영 방법" 참고.

## 검색 등록 순서
1. 도메인 연결 후 사이트 접속 확인
2. 네이버 서치어드바이저 (searchadvisor.naver.com) → 사이트 등록 → 소유 확인 → sitemap.xml 제출
3. 구글 서치콘솔 (search.google.com/search-console) → 속성 추가 → 소유 확인 → sitemap.xml 제출
4. 2~3주 후 검색 노출 확인

## 소식(게시판) 운영 방법

소식은 `news.html`(목록 표) + `news/` 폴더의 기사 페이지로 구성된 정적 게시판입니다.
흐름: **① 협회가 기사 페이지를 먼저 게시 → ② 언론사에 전달 → ③ 언론 게재 URL을 받으면 기사 하단 "언론 보도 원문" 블록과 목록 표의 "언론 보도" 칸에 연결.**

**새 기사 추가**
1. `news/_template.html`을 복사해 `news/새이름.html`로 저장 (영문 소문자, 예: `daegu.html`)
2. 파일 안에서 바꿀 곳: `<title>`, description(2곳), canonical/og:url의 파일명, JSON-LD의 headline·description·mainEntityOfPage, 배지(보도/기획/공지), `<h1>` 제목, 번호·작성일, 본문, 이전글 링크
3. `<meta name="robots" content="noindex,nofollow">` → `index,follow,max-image-preview:large` 로 변경
4. `news.html`의 `<tbody>` 맨 위에 행 추가 (번호는 기존 최대값+1):
```html
<tr>
  <td class="no">6</td>
  <td class="cat"><span class="badge">보도</span></td>   <!-- 공지는 class="badge notice" -->
  <td class="tit"><a href="news/새이름.html">제목</a></td>
  <td class="date"><time datetime="2026-10">2026.10</time></td>
  <td class="press"><span class="press-wait">게재 준비 중</span></td>
</tr>
```
5. `전체 N건` 숫자 수정, 직전 기사 페이지의 "다음글" 링크를 새 기사로 연결
6. `index.html` 최근 소식 3건 갱신, `sitemap.xml`에 `<url>` 추가

**언론 게재 URL 연결**
- 사진: `images/news/` 폴더에 1600px 폭 JPG로 저장하고 본문에 `<figure class="feat">` 블록으로 삽입 (_template.html 참고)
- 기사 페이지: 하단 `<div class="origin">` 안 "게재 준비 중" 문단을 `<a href="기사URL" target="_blank" rel="noopener">매체명 — 기사 보기 ↗</a>` 로 교체 (주석에 예시 있음). 상단 메타의 `게재 준비 중` → 매체명. JSON-LD에 `"sameAs":"기사URL"` 추가(선택)
- 목록 표: `<span class="press-wait">게재 준비 중</span>` → `<a class="press-link" href="기사URL" target="_blank" rel="noopener">매체명 ↗</a>`

## 청원 현황 갱신
petition.html의 `<table class="regions">` 행을 수정. 완료되면 `tag wip` → `tag ok`.
