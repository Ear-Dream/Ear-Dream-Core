import { useCallback, useEffect, useRef } from 'react';

import { useReducedMotion } from '../../hooks/useReducedMotion';

import { HOME_SCRIM_COLOR } from './backgroundTint';

const VIDEO_SRC = '/home-background.mp4';
/** 영상 첫 프레임. 자동재생이 끝내 막히는 기기에서도 시안 그림이 남는다. */
const POSTER_SRC = '/home-background-poster.jpg';

const VIDEO_CLASS = 'home-background-video';

/**
 * 첫 화면 배경 (웹) — 확정 디자인의 반복 재생 영상.
 *
 * 파일은 번들이 아니라 `public/` 에 둔다. Metro 애셋으로 싣고 `Asset.fromModule` 로 URI 를
 * 얻는 경로도 있지만, 이 영상은 **웹에서만** 쓰이고 정적 서빙이면 충분해서 번들러를 거칠
 * 이유가 없다. `pnpm build:web-mobile` 의 `expo export` 가 public/ 를 dist 로 그대로
 * 복사하므로 실기기 경로도 같다.
 *
 * ## 자동재생 — 실기기에서 막히던 세 가지 (2026-08-19 수정)
 *
 * 1. **`muted` 를 JSX prop 으로 주면 iOS 에서 안 통한다.** React 는 muted 를 DOM
 *    *프로퍼티*로만 세우고 HTML *속성*은 만들지 않는데, Safari 는 로드 시점에 속성을 본다.
 *    그래서 "음소거 아님"으로 판정돼 자동재생이 거부된다. 아래 ref 콜백에서 **muted 를 먼저
 *    세우고 그 다음 src 를 붙여** 로드가 시작되기 전에 음소거를 확정한다 — 그래서 `src`·
 *    `muted`·`playsInline` 이 JSX 에 없다. 되돌리지 말 것.
 * 2. **거부되면 iOS 가 네이티브 재생 버튼을 띄운다.** 게다가 이 요소는 `pointer-events:
 *    none` 이라 눌리지도 않는다 — 눌러도 아무 일 없는 버튼이 배경 한가운데 남는다.
 *    아래 CSS 로 미디어 컨트롤을 통째로 숨긴다.
 * 3. **저전력 모드에서는 무슨 수를 써도 자동재생이 안 된다.** iOS 저전력 모드·Safari 의
 *    자동재생 차단 설정·데이터 절약 모드는 정책이라 우회 대상이 아니다. 그래서 `poster` 로
 *    첫 프레임을 깔아 **재생이 안 돼도 화면이 시안대로 보이게** 한다. 화면이 나르는 정보는
 *    워드마크와 두 버튼이 전부라 정지 화면으로도 잃는 게 없다.
 *
 * 재생 시도는 **영상이 준비됐다고 알려올 때**(`loadeddata`/`canplay`) 건다. src 를 붙인
 * 직후에 부르면 그 호출이 로드와 경합해 중단되고, 중단된 play() 는 `autoplay` 재시도
 * 자격까지 지워 버려 **끝까지 정지 상태로 남는다**(실측). 여기에 재시도 둘을 더 얹는다 —
 * 사용자의 첫 탭(제스처가 자동재생 잠금을 푼다)과 탭 복귀(백그라운드에서 돌아오면
 * 정지해 있는 경우가 있다).
 *
 * 「동작 줄이기」가 켜져 있으면 첫 프레임에서 멈춘다 — 배경 영상은 장식이고, 지속 루프는
 * 전정기관 장애·광과민성 사용자에게 실제 문제가 된다(useReducedMotion 주석).
 *
 * 영상 위에는 보라 스크림을 한 장 덮는다 — 시안의 톤이자 흰 워드마크의 대비를 만드는
 * 장치다(backgroundTint.ts 주석).
 *
 * 접근성: 장식이므로 `aria-hidden` 으로 스크린 리더에서 뺀다.
 */
export function HomeBackground() {
  const reducedMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // 「동작 줄이기」면 재생을 시도하지 않는다. 콜백 신원이 바뀌어도 리스너를 다시 달지
  // 않도록 ref 로 최신 값을 읽는다.
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  const tryPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || reducedMotionRef.current) return;
    // 재생 거부는 정상 경로다(정책). 포스터가 남으므로 조용히 넘어간다.
    void video.play().catch(() => {});
  }, []);

  const attachVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      if (!node) return;

      // ⚠️ 순서가 중요하다 — 음소거를 확정한 뒤에 src 를 붙여야 로드 시점 판정을 통과한다.
      node.muted = true;
      node.defaultMuted = true;
      node.setAttribute('muted', '');
      node.setAttribute('playsinline', '');
      // 구형 iOS 는 표준 playsinline 대신 이 접두사 속성을 본다.
      node.setAttribute('webkit-playsinline', 'true');

      // 여기서 play() 를 부르지 않는다 — 아래 useEffect 가 준비 이벤트에 걸어 둔다.
      if (node.getAttribute('src') !== VIDEO_SRC) {
        node.setAttribute('src', VIDEO_SRC);
      }
    },
    [],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (reducedMotion) {
      video.pause();
      return;
    }

    // 이미 준비된 경우(리렌더·복귀)와 아직 로드 중인 경우를 모두 덮는다.
    tryPlay();
    video.addEventListener('loadeddata', tryPlay);
    video.addEventListener('canplay', tryPlay);
    return () => {
      video.removeEventListener('loadeddata', tryPlay);
      video.removeEventListener('canplay', tryPlay);
    };
  }, [reducedMotion, tryPlay]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // 첫 사용자 제스처는 자동재생 잠금을 풀어준다. 한 번만 듣고 뗀다.
    const onGesture = () => tryPlay();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tryPlay();
    };

    document.addEventListener('pointerdown', onGesture, { once: true, passive: true });
    document.addEventListener('touchstart', onGesture, { once: true, passive: true });
    document.addEventListener('keydown', onGesture, { once: true });
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('pointerdown', onGesture);
      document.removeEventListener('touchstart', onGesture);
      document.removeEventListener('keydown', onGesture);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tryPlay]);

  return (
    <>
      <style>{CONTROLS_RESET_CSS}</style>
      <video
        ref={attachVideo}
        className={VIDEO_CLASS}
        poster={POSTER_SRC}
        autoPlay
        loop
        preload="auto"
        controls={false}
        disablePictureInPicture
        aria-hidden
        style={backgroundStyle}
      />
      <div aria-hidden style={scrimStyle} />
    </>
  );
}

/**
 * 자동재생이 거부됐을 때 iOS·일부 안드로이드 브라우저가 씌우는 네이티브 재생 버튼을 숨긴다.
 * 이 요소는 `pointer-events: none` 이라 그 버튼은 눌리지도 않는다 — 보이면 고장으로만 읽힌다.
 */
const CONTROLS_RESET_CSS = `
.${VIDEO_CLASS}::-webkit-media-controls,
.${VIDEO_CLASS}::-webkit-media-controls-panel,
.${VIDEO_CLASS}::-webkit-media-controls-overlay-play-button,
.${VIDEO_CLASS}::-webkit-media-controls-start-playback-button {
  display: none !important;
  -webkit-appearance: none;
  appearance: none;
}
`;

const backgroundStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: '100%',
  height: '100%',
  // 폰 비율과 영상 비율(334:720)이 정확히 같지는 않으므로 잘라서 채운다.
  // poster 도 같은 규칙으로 그려져 재생 여부와 무관하게 구도가 같다.
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
