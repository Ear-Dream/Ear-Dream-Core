/**
 * 빌트인 수어 시퀀스 자산 로딩·디코딩.
 *
 * 좌표는 서버가 보내지 않는다 — 앱에 함께 실려 있다(`public/sign-sequences/`).
 * 서버 응답은 재생 순서와 조회 키(`sequence_key`)만 준다. 대역폭(ngrok 무료 한도)
 * 때문에 내린 결정이라, 여기서 좌표를 다시 네트워크로 받으면 그 이유가 무너진다.
 *
 * 자산은 **레포에 커밋되어 있다** — 클론만으로 앱이 바로 돌아야 하기 때문이다.
 * 원본 영상에서 다시 뽑으려면 `extract_sign_videos.py` → `build_sign_sequences.py` 다.
 * 그래도 로딩 실패는 정상 경로로 다룬다 — 빌드에서 빠지거나 판본이 어긋날 수 있고,
 * 그때 화면이 죽으면 안 된다.
 */

/** 자산 매니페스트의 `format` 블록 — 디코딩 계약 전부가 여기 있다. */
interface SequenceFormat {
  encoding: string;
  quant_scale: number;
  nan_sentinel: number;
  keypoint_count: number;
  channel_count: number;
  source_fps: number;
}

interface SequenceEntry {
  word_id: string;
  label: string;
  sequence_key: string;
  frame_count: number;
}

export interface SequenceManifest {
  bundleVersion: string;
  vocabVersion: string;
  format: SequenceFormat;
  entries: Map<string, SequenceEntry>;
}

/**
 * 디코딩된 한 단어의 좌표.
 *
 * `xy` 는 프레임 순서대로 이어 붙인 `[x, y, x, y, …]` 다. 프레임 t 의 키포인트 k 는
 * `xy[(t * keypointCount + k) * 2]` 에 있다. **미검출은 NaN 이다** — 0 으로 바꾸지
 * 않는다(화면 좌상단에 점이 튄다). 그리는 쪽이 NaN 을 걸러야 한다.
 */
export interface SignSequence {
  key: string;
  frameCount: number;
  keypointCount: number;
  xy: Float32Array;
}

const ASSET_BASE = '/sign-sequences';

/**
 * 클립마다 다른 촬영 위치를 지우고 맞출 기준점 (자산 좌표계).
 *
 * 단어마다 따로 찍은 영상이라 사람이 서 있던 자리가 조금씩 다르다 — 300클립 실측으로
 * 어깨 중점이 **어깨 너비의 54%** 만큼 좌우로 흩어져 있다(세로는 10%). 그대로 이어
 * 재생하면 단어가 바뀔 때마다 사람이 옆으로 미끄러진다.
 *
 * 값 자체는 실측 중앙값이고 의미는 없다 — 어차피 화면은 시퀀스 전체를 감싸 잘라내
 * 가운데 놓으므로, **클립들이 서로 맞기만 하면** 된다.
 */
const SHOULDER_ANCHOR = { x: 0.525, y: 0.353 } as const;

/** kp130 레이아웃의 어깨 (`bodyLayout.POSE`). 여기서는 디코딩 직후라 상수만 쓴다. */
const LEFT_SHOULDER = 44;
const RIGHT_SHOULDER = 45;

let manifestPromise: Promise<SequenceManifest | null> | null = null;
const sequenceCache = new Map<string, Promise<SignSequence | null>>();

/** 매니페스트는 앱 수명 동안 한 번만 읽는다. 실패는 null — 호출부가 안내를 띄운다. */
export function loadManifest(): Promise<SequenceManifest | null> {
  if (!manifestPromise) {
    manifestPromise = fetchManifest().catch((cause) => {
      console.warn('[avatar] 시퀀스 매니페스트를 읽지 못했습니다.', cause);
      return null;
    });
  }
  return manifestPromise;
}

async function fetchManifest(): Promise<SequenceManifest | null> {
  const response = await fetch(`${ASSET_BASE}/index.json`);
  if (!response.ok) return null;
  const raw = (await response.json()) as {
    bundle_version: string;
    vocab_version: string;
    format: SequenceFormat;
    sequences: SequenceEntry[];
  };
  return {
    bundleVersion: raw.bundle_version,
    vocabVersion: raw.vocab_version,
    format: raw.format,
    entries: new Map(raw.sequences.map((entry) => [entry.sequence_key, entry])),
  };
}

/**
 * 단어 하나의 좌표를 읽어 디코딩한다. 같은 단어는 한 번만 받는다(문장에 반복될 수 있다).
 *
 * int16 리틀엔디언 → `값 / quant_scale`. 센티널은 NaN 으로 되돌린다.
 */
export function loadSequence(key: string, format: SequenceFormat): Promise<SignSequence | null> {
  const cached = sequenceCache.get(key);
  if (cached) return cached;

  const pending = fetchSequence(key, format).catch((cause) => {
    console.warn(`[avatar] 시퀀스를 읽지 못했습니다: ${key}`, cause);
    return null;
  });
  sequenceCache.set(key, pending);
  return pending;
}

async function fetchSequence(
  key: string,
  format: SequenceFormat,
): Promise<SignSequence | null> {
  const response = await fetch(`${ASSET_BASE}/${key}.bin`);
  if (!response.ok) return null;

  const raw = new Int16Array(await response.arrayBuffer());
  const stride = format.keypoint_count * format.channel_count;
  if (raw.length % stride !== 0) {
    console.warn(`[avatar] ${key}: 길이가 프레임 크기의 배수가 아닙니다 (${raw.length}).`);
    return null;
  }

  const xy = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    // 미검출은 NaN 으로 남긴다 — 0 은 화면 좌상단의 유효한 좌표라 점이 튄다.
    xy[i] = raw[i] === format.nan_sentinel ? Number.NaN : raw[i] / format.quant_scale;
  }

  const frameCount = raw.length / stride;
  recenter(xy, frameCount, format.keypoint_count);

  return {
    key,
    frameCount,
    keypointCount: format.keypoint_count,
    xy,
  };
}

/**
 * 클립 전체를 평행이동해 어깨 중점을 공통 기준점에 맞춘다.
 *
 * **클립당 한 번만 옮긴다.** 프레임마다 가운데로 맞추면 단어 안에서 몸을 기울이거나
 * 무게중심을 옮기는 움직임이 통째로 지워지는데, 그건 촬영 오차가 아니라 동작의
 * 일부다. 클립당 한 번이면 단어 사이의 프레이밍 차이만 사라진다.
 *
 * 크기(어깨 너비)는 건드리지 않는다 — 실측 편차가 11% 로 위치(54%)보다 훨씬 작고,
 * 배율을 바꾸면 단어 안 동작의 크기까지 함께 바뀌어 원본과 벌어지는 폭이 커진다.
 *
 * 어깨가 한 프레임도 잡히지 않았으면 그대로 둔다 — 기준이 없으면 옮길 수 없다.
 */
function recenter(xy: Float32Array, frameCount: number, keypointCount: number): void {
  const xs: number[] = [];
  const ys: number[] = [];

  for (let frame = 0; frame < frameCount; frame += 1) {
    const base = frame * keypointCount * 2;
    const lx = xy[base + LEFT_SHOULDER * 2];
    const ly = xy[base + LEFT_SHOULDER * 2 + 1];
    const rx = xy[base + RIGHT_SHOULDER * 2];
    const ry = xy[base + RIGHT_SHOULDER * 2 + 1];
    if (!Number.isFinite(lx) || !Number.isFinite(ly)) continue;
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) continue;
    xs.push((lx + rx) / 2);
    ys.push((ly + ry) / 2);
  }
  if (xs.length === 0) return;

  // 평균이 아니라 중앙값이다 — 한두 프레임 검출이 튀어도 기준이 끌려가지 않는다.
  const shiftX = SHOULDER_ANCHOR.x - median(xs);
  const shiftY = SHOULDER_ANCHOR.y - median(ys);

  for (let i = 0; i < xy.length; i += 2) {
    xy[i] += shiftX; // NaN 은 더해도 NaN 이라 미검출 표시가 유지된다
    xy[i + 1] += shiftY;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
