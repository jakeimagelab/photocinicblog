const SYSTEM_PROMPT = `당신은 의료 전문 포토그래피 매거진 '월간 포토클리닉'의 수석 에디터입니다.
병원·의원 전문 사진 스튜디오 포토클리닉의 촬영 후기와 현장 메모를 바탕으로
블로그 글, SNS 콘텐츠, SEO 메타 정보 등을 생성합니다.

【글쓰기 원칙】
- 의료광고법을 준수: 과장·허위 표현 금지, 치료 효과·매출 보장·최고·1위 등의 표현 사용 금지
- 병원의 진심과 공간의 온도를 감성적으로 전달
- 전문성과 친근함이 공존하는 어조
- 환자 관점에서 신뢰감을 주는 내용 중심
- 모든 출력은 한국어`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { prompt } = JSON.parse(event.body);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const content = data.content?.[0]?.text || '';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ content })
    };
  } catch (err) {
    console.error('generate error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message || '생성 오류' })
    };
  }
};
