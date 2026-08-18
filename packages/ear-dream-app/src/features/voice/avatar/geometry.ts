/**
 * 2D 기하 · SVG 경로 문자열 헬퍼 — 아바타 도메인과 무관한 순수 함수만 둔다.
 *
 * 여기 있는 것은 "무엇을 그리는가" 를 모른다. 점을 받아 점이나 경로 문자열을 돌려줄
 * 뿐이라, 아바타 형상이 바뀌어도 이 파일은 바뀌지 않는다. 형상 계산은 `figure.ts`,
 * 눈으로 맞춘 치수는 `avatarTuning.ts` 에 있다.
 */

/** 화면 픽셀 좌표. */
export type Point = readonly [number, number];

/**
 * 키포인트 번호 → 그 프레임의 화면 좌표.
 *
 * 재생기(`usePlayback`)가 만들어 형상 계산(`figure.ts`)에 넘긴다. 보간·크롭·종횡비
 * 환산이 이 함수 뒤에 숨으므로, 형상 계산은 좌표가 어디서 왔는지 몰라도 된다.
 */
export type At = (keypoint: number) => Point;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * 볼록 껍질 (모노톤 체인). 점이 대여섯 개라 비용은 무시할 수준이다.
 *
 * 순서가 뒤엉킨 점들을 **꼬이지 않는 다각형**으로 만든다. 손이 돌아가면 엄지 뿌리가
 * 반대쪽으로 넘어가 손바닥 다각형이 스스로 꼬이는데, 꼬인 면은 외곽선을 두르는 순간
 * 삐죽한 조각으로 드러난다.
 */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;

  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const build = (source: readonly Point[]) => {
    const chain: Point[] = [];
    for (const point of source) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0
      ) {
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };

  const hull = [...build(sorted), ...build([...sorted].reverse())];
  return hull.length >= 3 ? hull : sorted;
}

export function ok(point: Point): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

export function pt(point: Point): string {
  return `${point[0].toFixed(1)} ${point[1].toFixed(1)}`;
}

export function span(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * 점들을 닫힌 **곡선**으로. 각 변의 중점을 지나고 원래 점을 제어점으로 쓴다.
 *
 * 직선으로 이으면 눈·입이 다각형으로 보인다 — 78점은 윤곽을 성기게 표현한 서브셋이라
 * 그 각짐이 그대로 드러난다. 곡선은 점을 옮기지 않고 사이만 메우므로 정보를 더하지 않는다.
 */
export function smoothRing(points: readonly Point[]): string {
  if (points.length < 3) return '';
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(points[points.length - 1], points[0]);
  let d = `M${pt(start)}`;
  for (let i = 0; i < points.length; i += 1) {
    const control = points[i];
    const end = mid(points[i], points[(i + 1) % points.length]);
    d += `Q${pt(control)} ${pt(end)}`;
  }
  return `${d}Z`;
}

/** 두 점 사이를 굵기가 변하는 사다리꼴로 — 팔다리에 살을 붙인다. */
export function taper(a: Point, b: Point, halfA: number, halfB: number): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const corners: Point[] = [
    [a[0] + nx * halfA, a[1] + ny * halfA],
    [b[0] + nx * halfB, b[1] + ny * halfB],
    [b[0] - nx * halfB, b[1] - ny * halfB],
    [a[0] - nx * halfA, a[1] - ny * halfA],
  ];
  return `M${corners.map(pt).join('L')}Z`;
}
