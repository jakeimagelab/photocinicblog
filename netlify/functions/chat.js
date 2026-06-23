const SYSTEM_PROMPT = `당신은 포토클리닉의 AI 상담 어시스턴트입니다.
포토클리닉은 병원·의원 전문 사진 스튜디오로, 의료진의 진심과 전문성을 사진으로 담아냅니다.

【주요 서비스】
- 원장님·의료진 프로필 사진 (개인/단체)
- 병원 인테리어·외관 촬영
- 홈페이지·SNS·마케팅용 브랜딩 사진
- 촬영 후 보정·납품 포함

【촬영 특징】
- 병원마다 다른 분위기와 철학을 반영한 맞춤 촬영
- 환자가 처음 홈페이지를 열었을 때 느끼는 첫인상 중심
- 자연스러우면서도 전문적인 이미지 연출

【상담 안내】
- 촬영 일정·비용은 병원 규모와 촬영 범위에 따라 달라지므로 개별 상담 후 안내
- 구체적 문의는 블로그 내 연락처를 통해 상담 가능

【답변 규칙】
- 친절하고 따뜻한 어조, 2~4문장으로 간결하게
- 한국어로만 답변
- 가격·비용은 반드시 "개별 상담 후 안내드립니다"로 답변
- 포토클리닉 서비스와 무관한 질문은 정중히 서비스 범위 안내
- 끝에 추가 질문을 유도하는 한 문장 포함`;

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
    const { message, history = [] } = JSON.parse(event.body);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [...history, { role: 'user', content: message }]
      })
    });

    const data = await response.json();
    const reply = data.content?.[0]?.text || '죄송합니다, 잠시 후 다시 시도해주세요.';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ reply: '오류가 발생했습니다. 잠시 후 다시 시도해주세요.' })
    };
  }
};
