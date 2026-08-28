/**
 * 눈 깜빡임 시계 — **재생 프레임이 아니라 시간**으로 돈다.
 *
 * 프레임에 묶으면 재생이 끝나는 순간 깜빡임도 멈춰서, 정작 인물이 가만히 서 있는
 * 구간(가장 인형처럼 보이는 구간)에 생동감이 없다. 그래서 재생 여부와 무관하게 돌린다.
 *
 * 값과 그 근거는 `avatarTuning.BLINK` 에 있다. 이 신호가 **좌표에서 온 것이 아니라
 * 지어낸 것**이라는 점도 거기 적혀 있다.
 */
import { useEffect, useState } from 'react';

import { BLINK } from './avatarTuning';

/**
 * 지금 눈을 감고 있는지.
 *
 * 상태가 바뀌는 순간에만 리렌더가 일어난다(몇 초에 두 번) — 매 프레임 도는 재생
 * 루프와 달리 서 있는 동안의 비용이 거의 없다.
 */
export function useBlink(enabled = true): boolean {
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setClosed(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const gap = () => BLINK.minGapMs + Math.random() * (BLINK.maxGapMs - BLINK.minGapMs);

    /** `pair` 면 이번 깜빡임 뒤에 곧바로 한 번 더 감는다(연속 깜빡임). */
    const schedule = (delayMs: number, pair: boolean) => {
      timer = setTimeout(() => {
        setClosed(true);
        timer = setTimeout(() => {
          setClosed(false);
          if (pair) schedule(BLINK.doubleGapMs, false);
          else schedule(gap(), Math.random() < BLINK.doubleChance);
        }, BLINK.closedMs);
      }, delayMs);
    };

    // 화면에 나타나자마자 감지 않도록 첫 깜빡임도 정상 간격 뒤에 온다.
    schedule(gap(), Math.random() < BLINK.doubleChance);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return closed;
}
