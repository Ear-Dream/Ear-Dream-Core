import { useEffect, useRef } from 'react';

import { useReducedMotion } from '../../hooks/useReducedMotion';

import { HOME_SCRIM_COLOR } from './backgroundTint';

/**
 * 첫 화면 배경 (웹) — 확정 디자인의 반복 재생 영상.
 *
 * 파일은 번들이 아니라 `public/home-background.mp4` 에 둔다. Metro 애셋으로 싣고
 * `Asset.fromModule` 로 URI 를 얻는 경로도 있지만, 이 영상은 **웹에서만** 쓰이고 정적
 * 서빙이면 충분해서 번들러를 거칠 이유가 없다. `pnpm build:web-mobile` 의 `expo export`
 * 가 public/ 를 dist 로 그대로 복사하므로 실기기 경로도 같다.
 *
 * `muted` + `playsInline` 은 필수다 — 없으면 iOS·Android 모바일 브라우저가 자동재생을
 * 거부해 첫 화면이 검은 사각형으로 남는다. 배경 영상이라 소리는 애셋 자체에서 없앴다.
 *
 * 「동작 줄이기」가 켜져 있으면 첫 프레임에서 멈춘다 — 배경 영상은 장식이고, 지속 루프는
 * 전정기관 장애·광과민성 사용자에게 실제 문제가 된다(useReducedMotion 주석). 정지해도
 * 화면이 비지 않으므로 잃는 정보가 없다.
 *
 * 영상 위에는 보라 스크림을 한 장 덮는다 — 시안의 톤이자 흰 워드마크의 대비를 만드는
 * 장치다(backgroundTint.ts 주석).
 *
 * 접근성: 장식이므로 `aria-hidden` 으로 스크린 리더에서 뺀다. 화면의 의미는 워드마크와
 * 두 버튼이 전부 갖는다.
 */
export function HomeBackground() {
  const reducedMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (reducedMotion) {
      video.pause();
      return;
    }
    // 자동재생이 막히는 환경(권한·정책)에서도 예외로 화면을 깨뜨리지 않는다 —
    // 실패하면 첫 프레임이 그대로 남고, 그건 폴백으로 충분하다.
    void video.play().catch(() => {});
  }, [reducedMotion]);

  return (
    <>
      <video
        ref={videoRef}
        src="/home-background.mp4"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden
        style={backgroundStyle}
      />
      <div aria-hidden style={scrimStyle} />
    </>
  );
}

const backgroundStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: '100%',
  height: '100%',
  // 폰 비율과 영상 비율(334:720)이 정확히 같지는 않으므로 잘라서 채운다.
  objectFit: 'cover',
  pointerEvents: 'none',
};

const scrimStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  backgroundColor: HOME_SCRIM_COLOR,
  pointerEvents: 'none',
};
