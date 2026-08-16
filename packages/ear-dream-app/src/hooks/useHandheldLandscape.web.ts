import { useEffect, useState } from 'react';

/**
 * **손에 쥔** 기기가 가로로 돌아갔는지 — 웹 구현.
 *
 * 세로가 이 서비스의 계약이다. 왼손으로 폰을 세로로 쥐는 자세가 전제이고, 카메라 요청 해상도
 * (9:16), 프레이밍 가이드 박스, 어깨 기준 정규화가 전부 그 구도 위에 서 있다. 가로 구도는
 * 학습에도 없고 실측한 적도 없다 — 그래서 "돌아가긴 하는데 정확도는 모르는" 상태로 두는 대신
 * 세로로 되돌려 달라고 안내한다(판단 근거는 SignInputScreen 의 landscape 처리 주석).
 *
 * ## `(pointer: coarse) and (hover: none)` 가 왜 붙는가
 *
 * 가로 여부만 보면 **데스크톱 브라우저 창이 전부 걸린다** — 데스크톱은 원래 가로다.
 * 이 조건은 마우스가 없는 터치 기기(폰·태블릿)로 한정해서, 지금 잘 돌고 있는 데스크톱 웹
 * 경로가 이 판정에 영향받지 않게 한다. 터치스크린 노트북은 주 포인터가 마우스라 걸리지 않는다.
 */
const HANDHELD_LANDSCAPE_QUERY =
  '(orientation: landscape) and (pointer: coarse) and (hover: none)';

function matchesNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(HANDHELD_LANDSCAPE_QUERY).matches;
}

export function useHandheldLandscape(): boolean {
  const [landscape, setLandscape] = useState(matchesNow);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(HANDHELD_LANDSCAPE_QUERY);
    const update = (): void => setLandscape(query.matches);
    update();

    query.addEventListener('change', update);
    // 일부 모바일 브라우저는 회전 직후 media query 갱신이 한 박자 늦거나 orientationchange 만
    // 준다. 어느 쪽이든 뷰포트는 바뀌므로 resize 로 한 번 더 읽는다(중복 호출은 무해하다).
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      query.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return landscape;
}
