import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { maxScreenWidth } from '../constants/theme';

/** 확정 디자인 프레임 — 모든 시안 실측값이 이 크기를 전제한다. */
export const DESIGN_FRAME_WIDTH = 430;
export const DESIGN_FRAME_HEIGHT = 932;

export interface DesignScale {
  /** 시안 430 에 대응하는 실제 폭. 절대좌표를 옮길 때의 기준면이다. */
  frameWidth: number;
  /** 가로 배율. */
  scale: number;
  /** 세로 배율. `scale` 을 넘지 않는다(아래 주석). */
  vScale: number;
  /** 가로 치수 환산 — 폭·좌우 여백·가로 위치. */
  s: (value: number) => number;
  /** 세로 치수 환산 — 높이·상하 여백·세로 위치. */
  v: (value: number) => number;
}

/**
 * 시안 절대좌표(430x932)를 실제 화면으로 옮기는 배율.
 *
 * ## 왜 가로/세로를 따로 두나
 *
 * 예전에는 배율이 **폭 하나에서만** 나왔다(`min(width, 480) / 430`). 그래서 세로 여백과
 * 버튼 크기가 화면 높이와 무관하게 시안 픽셀 그대로 남았고, 짧은 화면에서 고정 지분이
 * 세로 예산을 잠식해 뷰파인더가 납작해졌다 — 시안에서 세로였던 카드가 가로로 뒤집혔다.
 *
 * 실측(2026-08-25)으로 비율이 깨지기 시작하는 높이가 **약 820px** 이었다. DevTools
 * 기기 프리셋은 iPhone SE(667)만 그 아래라 SE 에서만 깨져 보였지만, 실기기는 주소창이
 * 100~180px 을 가져가므로 iPhone 12 Pro(844 → 약 660)도 Galaxy(915 → 약 800)도 전부
 * 그 아래로 떨어진다. 즉 SE 만의 문제가 아니라 **모든 실기기의 문제**였다.
 *
 * 그래서 세로 치수는 세로 배율로 옮긴다. 각 축이 자기 축에서의 시안 비율을 지키므로
 * 「손잡이 바는 화면 높이의 13.2%」 같은 관계가 어떤 화면에서도 유지된다.
 *
 * ## vScale 이 scale 을 넘지 않는 이유
 *
 * 시안보다 세로로 긴 화면(데스크톱 브라우저 창)에서 `height / 932` 를 그대로 쓰면
 * 손잡이 바와 녹화 버튼만 계속 커진다. 폭은 `maxScreenWidth` 로 이미 잠겨 있으니
 * 세로도 거기서 멈추게 하고, 남는 높이는 뷰파인더가 흡수한다(flex).
 *
 * 시안과 같은 비율(932/430 = 2.167)의 화면에서는 두 배율이 정확히 같아진다.
 *
 * ⚠️ **글자 크기는 여기서 환산하지 않는다.** 시안 텍스트 치수는 430pt 폭 기준이라 이미
 * 한 단계씩 줄여 넣었고(CLAUDE.md), 거기에 세로 배율까지 곱하면 짧은 화면에서 본문이
 * 읽을 수 없게 작아진다. 이 훅은 **기하(치수·여백)** 만 다룬다.
 */
export function useDesignScale(): DesignScale {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const frameWidth = Math.min(width, maxScreenWidth);
    const scale = frameWidth / DESIGN_FRAME_WIDTH;
    const vScale = Math.min(scale, height / DESIGN_FRAME_HEIGHT);

    return {
      frameWidth,
      scale,
      vScale,
      s: (value: number) => value * scale,
      v: (value: number) => value * vScale,
    };
  }, [width, height]);
}
