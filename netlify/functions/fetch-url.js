const SYSTEM_PROMPT = `당신은 의료 전문 포토그래피 매거진 '월간 포토클리닉'의 수석 에디터입니다.
외부 URL에서 가져온 콘텐츠를 포토클리닉 블로그 스타일로 재작성합니다.
포토클리닉은 병원·의원 전문 사진 스튜디오입니다.

【글쓰기 원칙】
- 의료광고법 준수: 과장·허위 표현 금지
- 병원의 진심과 공간의 온도를 감성적으로 전달
- 전문성과 친근함이 공존하는 어조
- 모든 출력은 한국어`;

/** HTML에서 읽을 수 있는 텍스트를 추출하는 개선된 함수 */
function extractText(html) {
  // 1. script / style / noscript / nav / footer / header 제거
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');

  // 2. 블록 요소를 개행으로 치환
  cleaned = cleaned
    .replace(/<\/?(p|div|h[1-6]|li|br|tr|blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  // 3. HTML 엔티티 디코딩
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

  // 4. 공백 정리
  cleaned = cleaned
    .split('\n')
    .map(l => l.replace(/\s{2,}/g, ' ').trim())
    .filter(l => l.length > 10)   // 너무 짧은 줄 제거
    .join('\n')
    .slice(0, 6000);

  return cleaned;
}

/** og: / meta 태그에서 핵심 정보 추출 */
function extractMeta(html) {
  const get = (pattern) => {
    const m = html.match(pattern);
    return m ? m[1].trim() : '';
  };

  const ogTitle       = get(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
                     || get(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const ogDesc        = get(/property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
                     || get(/content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
  const ogImage       = get(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
                     || get(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  const metaDesc      = get(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i)
                     || get(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["']/i);
  const titleTag      = get(/<title[^>]*>([^<]+)<\/title>/i);

  return {
    ogTitle:   ogTitle || titleTag.replace(/\s*[|–\-:]\s*.*$/, '').trim(),
    ogDesc:    ogDesc || metaDesc,
    ogImage,
  };
}

/** img 태그에서 이미지 URL 수집 */
function extractImages(html, ogImage) {
  const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)];
  const rawUrls = imgMatches.map(m => m[1]).filter(Boolean);
  return [
    ...(ogImage ? [ogImage] : []),
    ...rawUrls
      .filter(u => !u.startsWith('data:') && (u.startsWith('http') || u.startsWith('//')))
      .map(u => u.startsWith('//') ? 'https:' + u : u)
      .filter(u => !/\.(gif|svg|ico)(\?|$)/i.test(u)),
  ]
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .slice(0, 10);
}

exports.handler = async (event) => {
  // CORS preflight
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  // API 키 사전 확인
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Netlify 환경변수 ANTHROPIC_API_KEY가 설정되지 않았습니다.' }),
    };
  }

  try {
    let { url } = JSON.parse(event.body || '{}');
    if (!url) throw new Error('URL이 필요합니다');
    if (!/^https?:\/\//i.test(url)) throw new Error('http:// 또는 https:// 로 시작하는 URL을 입력해주세요');

    // 네이버 블로그 → 모바일 URL로 자동 변환
    let fetchUrl = url;
    const naverMatch = url.match(/blog\.naver\.com\/([A-Za-z0-9_]+)\/(\d+)/);
    if (naverMatch) {
      fetchUrl = `https://m.blog.naver.com/${naverMatch[1]}/${naverMatch[2]}`;
    }

    // 페이지 HTML 가져오기
    let pageRes;
    try {
      pageRes = await fetch(fetchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Cache-Control': 'no-cache',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
    } catch (fetchErr) {
      throw new Error(`페이지를 가져오지 못했습니다: ${fetchErr.message}. 해당 사이트가 접근을 차단했을 수 있습니다.`);
    }

    if (!pageRes.ok) {
      throw new Error(`페이지 응답 오류: HTTP ${pageRes.status}. URL을 직접 열어서 접근 가능한지 확인해주세요.`);
    }

    const html = await pageRes.text();

    // 메타 정보 추출
    const { ogTitle, ogDesc, ogImage } = extractMeta(html);

    // 텍스트 추출
    const cleanText = extractText(html);

    // 텍스트가 너무 적으면 og:description 보완
    const contentForAI = cleanText.length > 100
      ? cleanText
      : [ogTitle, ogDesc, cleanText].filter(Boolean).join('\n\n');

    if (contentForAI.length < 50) {
      throw new Error('페이지에서 텍스트를 추출하지 못했습니다. 이 사이트는 JavaScript로만 콘텐츠를 렌더링하거나 로그인이 필요할 수 있습니다.');
    }

    // 이미지 URL 수집
    const images = extractImages(html, ogImage);

    // Claude API 호출
    const prompt = `아래는 외부 URL(${url})에서 가져온 콘텐츠입니다.
이 내용을 포토클리닉 블로그 스타일로 재작성해주세요.

【원문 제목】${ogTitle}
【원문 설명】${ogDesc || '없음'}
【원문 내용】
${contentForAI}

다음 섹션을 순서대로 출력해주세요. 각 섹션은 반드시 ===섹션명=== 줄로 시작합니다.

===TITLES===
제목 후보 5개 (각 줄에 하나씩, 번호·기호 없이)

===FINAL_TITLE===
위 5개 중 가장 추천하는 제목 1개

===SUBTITLE===
부제목 1개 (20자 내외)

===SUMMARY===
블로그 요약 2~3문장 (카드 미리보기용)

===BODY===
본문 HTML (h2, p, blockquote 태그 사용, 500~800자)

===SEO_TITLE===
SEO 제목 (50자 이내)

===SEO_DESC===
메타 설명 (120자 이내)

===TAGS===
태그 5개 (쉼표 구분)

===INSTAGRAM===
인스타그램 캡션 (200자 + 해시태그)

===REELS===
릴스 스크립트 (30초 분량, 구어체)

===NAVER===
네이버 블로그용 본문 (마크다운 없이 순수 텍스트, 600~900자)

===NEWSLETTER===
뉴스레터 본문 (인사말 포함, 400~600자)

===CTA===
행동 유도 문구 2개 (각 줄에 하나씩)`;

    const claudeBody = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    const claudeHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };

    let claudeRes, claudeData;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: claudeHeaders,
          body: claudeBody,
          signal: AbortSignal.timeout(20000),
        });
      } catch (claudeErr) {
        throw new Error(`AI 서버 연결 실패: ${claudeErr.message}`);
      }

      claudeData = await claudeRes.json();

      if (claudeRes.status === 529 || claudeData.error?.type === 'overloaded_error') {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw new Error('AI 서버가 잠시 바빠요. 몇 초 후 다시 시도해주세요.');
      }
      break;
    }

    if (!claudeRes.ok || claudeData.error) {
      const errMsg = claudeData.error?.message || `AI 오류 (HTTP ${claudeRes.status})`;
      throw new Error(errMsg);
    }

    const content = claudeData.content?.[0]?.text || '';
    if (!content) throw new Error('AI에서 응답을 받지 못했습니다.');

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, images, sourceTitle: ogTitle, sourceUrl: url }),
    };

  } catch (err) {
    console.error('[fetch-url] error:', err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || '알 수 없는 오류가 발생했습니다.' }),
    };
  }
};
