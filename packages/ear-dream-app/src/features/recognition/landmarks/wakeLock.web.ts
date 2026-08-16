/**
 * 화면 꺼짐 방지(Screen Wake Lock) — 웹 전용.
 *
 * 캡처 중 폰 화면이 잠들면 카메라 트랙이 멈추고, 그 순간 세그먼트는 프레임이 끊긴 채 마감된다.
 * 데스크톱에서는 거의 드러나지 않지만 실기기에서는 기본 자동 잠금이 30초~1분이라 실사용 경로다.
 *
 * **있으면 쓰고 없으면 조용히 넘어간다.** Wake Lock API 는 지원이 갈리고(특히 iOS 는 16.4 부터,
 * 그 이전 버전과 일부 WebView 는 없다), 화면이 안 꺼지는 것은 편의 기능이지 인식의 전제조건이
 * 아니다. 실패를 사용자에게 노출하면 "고장" 으로 읽히므로 조용히 포기한다.
 *
 * ⚠️ 브라우저는 문서가 hidden 이 되면 sentinel 을 **자동으로 해제**한다. 다시 보이게 됐을 때
 * 재취득하지 않으면 탭 전환 한 번으로 기능이 영구히 꺼진다 — visibilitychange 를 직접 다루는
 * 이유다. 이 파일은 "화면을 벗어나면 해제, 돌아오면 재취득" 을 컨트롤러 안에 가둬 둔다.
 */

/** lib.dom 의 WakeLock 타입 유무가 TS 버전에 따라 갈리므로 필요한 만큼만 로컬로 정의한다. */
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export interface WakeLockController {
  /** 해제하고 재취득도 멈춘다. 여러 번 불러도 안전하다. */
  release(): void;
}

function getWakeLock(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;
  const candidate = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return typeof candidate?.request === 'function' ? candidate : null;
}

/**
 * 화면이 꺼지지 않게 유지한다. 지원하지 않는 환경에서는 아무 일도 하지 않는 컨트롤러를 준다.
 * 반환된 컨트롤러의 release() 를 반드시 정리 경로에서 호출할 것.
 */
export function keepScreenAwake(): WakeLockController {
  const wakeLock = getWakeLock();
  if (!wakeLock || typeof document === 'undefined') {
    return { release: () => {} };
  }

  let disposed = false;
  let sentinel: WakeLockSentinelLike | null = null;

  const acquire = (): void => {
    if (disposed || sentinel || document.visibilityState !== 'visible') return;
    void wakeLock
      .request('screen')
      .then((next) => {
        // 취득이 끝나기 전에 정리됐다면 즉시 되돌린다.
        if (disposed) {
          void next.release().catch(() => {});
          return;
        }
        sentinel = next;
      })
      .catch(() => {
        // 지원하지만 거부된 경우(배터리 절약 모드, 정책 등). 조용히 포기한다.
        sentinel = null;
      });
  };

  const releaseSentinel = (): void => {
    const current = sentinel;
    sentinel = null;
    if (current && !current.released) void current.release().catch(() => {});
  };

  const handleVisibility = (): void => {
    if (document.visibilityState === 'visible') acquire();
    // hidden 이면 브라우저가 알아서 해제하지만, 우리 쪽 참조도 함께 버려야 다음 재취득이 열린다.
    else releaseSentinel();
  };

  document.addEventListener('visibilitychange', handleVisibility);
  acquire();

  return {
    release: () => {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      releaseSentinel();
    },
  };
}
