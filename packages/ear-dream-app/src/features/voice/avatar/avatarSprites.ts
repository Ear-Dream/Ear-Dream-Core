/**
 * 아바타 부품 스프라이트 — 디자인 시트에서 잘라낸 PNG 를 좌표 위에 꽂는다.
 *
 * 벡터로 그리던 몸을 그림으로 바꾼다. 좌표가 정하는 것은 그대로다(어깨·팔꿈치·손목·
 * 눈초리) — 그 두 점 사이에 그림을 회전·확대해 얹을 뿐이다.
 *
 * **못 받으면 벡터로 돌아간다.** 스프라이트는 부가 자산이고, 없다고 아바타가 사라지면
 * 안 된다. 그래서 로딩 실패는 정상 경로로 다룬다(`null` 반환).
 *
 * **폴백은 부위 묶음 단위다.** 팔 넷은 한 묶음이고(한쪽만 그림이면 더 어색하다), 몸통과
 * 머리는 각자다. 부위마다 벡터 폴백이 따로 있어서, 한 장이 빠졌다고 나머지까지 벡터로
 * 내릴 이유가 없다.
 *
 * ## 자산은 손으로 잘라 넣은 산출물이다
 *
 * `public/avatar-parts/` 의 PNG 와 `parts.json` 이 정본이고, **그것을 만든 슬라이서는
 * 레포에 없다.** 시안 시트(레포 밖)에서 부품을 잘라 앵커를 재는 일회성 작업이라
 * 산출물만 남겼다 — 시트가 바뀌면 그 측정을 다시 해야 한다.
 *
 * `from`·`to` 는 그 부품을 화면에 꽂을 두 점이고 **부품마다 뜻이 다르다**:
 *
 *     위팔      어깨 → 팔꿈치            아래팔    팔꿈치 → 손목
 *     몸통      인물 오른쪽 → 왼쪽 어깨   머리      인물 오른쪽 → 왼쪽 눈 중심
 *     눈·눈썹·코·입   좌 → 우 끝점 (눈초리 · 콧구멍 바깥 · 입꼬리)
 *
 * 방향이 가로든 세로든 상관없다 — 앱은 이 두 점을 화면의 같은 두 점에 겹치게 놓을 뿐이다.
 */
import { useEffect, useState } from 'react';
import { Image } from 'react-native';

const ASSET_BASE = '/avatar-parts';

/** 스프라이트 한 장 — 그림 크기와 그 안에서 뼈가 지나는 두 점. */
export interface Sprite {
  uri: string;
  width: number;
  height: number;
  from: readonly [number, number];
  to: readonly [number, number];
}

export interface ArmSprites {
  upperLeft: Sprite;
  upperRight: Sprite;
  foreLeft: Sprite;
  foreRight: Sprite;
}

/** 눈 조각의 상태 — 뜬 정도 5단. */
export type EyeState = 'wide' | 'open' | 'normal' | 'half' | 'closed';
/** 입 조각의 상태 — 벌어짐 4단. */
export type MouthState = 'closed' | 'parted' | 'open' | 'wide';

export interface FaceSprites {
  /** `[상태][인물 기준 좌우]`. */
  eyes: Record<EyeState, { left: Sprite; right: Sprite }>;
  /** 눈썹은 모양 하나뿐이고 **높이를 연속으로** 옮긴다 — 눈과 분리된 조각이라 가능하다. */
  brows: { left: Sprite; right: Sprite };
  /** 코는 고정이다 — 좌표에 코 모양을 정할 근거가 없다. */
  nose: Sprite;
  mouths: Record<MouthState, Sprite>;
}

export interface AvatarSprites {
  /** 넷이 다 있을 때만 채워진다. */
  arms: ArmSprites | null;
  torso: Sprite | null;
  head: Sprite | null;
  /**
   * 눈·입 — **머리 스프라이트가 있을 때만 의미가 있다.** 머리 그림 위에 덧그려
   * 원본 이목구비를 덮는 방식이라, 머리가 벡터면 얹을 자리가 없다.
   */
  face: FaceSprites | null;
}

const EYE_STATES: readonly EyeState[] = ['wide', 'open', 'normal', 'half', 'closed'];
const MOUTH_STATES: readonly MouthState[] = ['closed', 'parted', 'open', 'wide'];

interface RawPart {
  width: number;
  height: number;
  from: [number, number];
  to: [number, number];
}

const EMPTY: AvatarSprites = { arms: null, torso: null, head: null, face: null };

let manifestPromise: Promise<AvatarSprites> | null = null;

function loadManifest(): Promise<AvatarSprites> {
  if (!manifestPromise) {
    manifestPromise = fetchManifest().catch((cause) => {
      console.warn('[avatar] 부품 스프라이트를 읽지 못했습니다 — 벡터로 그립니다.', cause);
      return EMPTY;
    });
  }
  return manifestPromise;
}

async function fetchManifest(): Promise<AvatarSprites> {
  const response = await fetch(`${ASSET_BASE}/parts.json`);
  if (!response.ok) return EMPTY;
  const raw = (await response.json()) as { parts: Record<string, RawPart> };

  const pick = (name: string): Sprite | null => {
    const part = raw.parts[name];
    if (!part) return null;
    return { uri: `${ASSET_BASE}/${name}.png`, ...part };
  };

  const upperLeft = pick('upper-left');
  const upperRight = pick('upper-right');
  const foreLeft = pick('fore-left');
  const foreRight = pick('fore-right');
  const browLeft = pick('brow-left');
  const browRight = pick('brow-right');
  const nose = pick('nose');

  const eyes = {} as FaceSprites['eyes'];
  const mouths = {} as FaceSprites['mouths'];
  let faceComplete = true;
  for (const state of EYE_STATES) {
    const left = pick(`eye-${state}-left`);
    const right = pick(`eye-${state}-right`);
    if (left && right) eyes[state] = { left, right };
    else faceComplete = false;
  }
  for (const state of MOUTH_STATES) {
    const mouth = pick(`mouth-${state}`);
    if (mouth) mouths[state] = mouth;
    else faceComplete = false;
  }
  if (!browLeft || !browRight || !nose) faceComplete = false;

  const sprites: AvatarSprites = {
    arms:
      upperLeft && upperRight && foreLeft && foreRight
        ? { upperLeft, upperRight, foreLeft, foreRight }
        : null,
    torso: pick('torso'),
    head: pick('head'),
    // 한 상태라도 빠지면 통째로 포기한다 — 표정이 어떤 프레임에서만 사라지면
    // 「그림이 없다」 가 아니라 「얼굴이 고장났다」 로 보인다.
    face:
      faceComplete && browLeft && browRight && nose
        ? { eyes, brows: { left: browLeft, right: browRight }, nose, mouths }
        : null,
  };

  // 그림이 아직 안 받아졌으면 `<image>` 는 **빈 채로** 그려진다 — 첫 재생에서 몸이
  // 통째로 사라진 것처럼 보인다. 매니페스트만 받고 끝내지 않고 그림까지 받아 둔 뒤에
  // 내보내면, 화면은 「전부 벡터」 아니면 「전부 그림」 둘 중 하나만 본다.
  // 한 장이 실패해도 계속 간다 — 부위별 벡터 폴백이 이미 있다.
  await Promise.all(
    [
      sprites.head,
      sprites.torso,
      ...(sprites.arms ? Object.values(sprites.arms) : []),
      ...(sprites.face
        ? [
            ...Object.values(sprites.face.eyes).flatMap((pair) => [pair.left, pair.right]),
            sprites.face.brows.left,
            sprites.face.brows.right,
            sprites.face.nose,
            ...Object.values(sprites.face.mouths),
          ]
        : []),
    ]
      .filter((sprite): sprite is Sprite => sprite !== null)
      .map((sprite) => Image.prefetch(sprite.uri).catch(() => false)),
  );

  return sprites;
}

/** 스프라이트를 한 번만 받아 돌려준다. 아직·못 받은 부위는 null. */
export function useAvatarSprites(): AvatarSprites {
  const [sprites, setSprites] = useState<AvatarSprites>(EMPTY);
  useEffect(() => {
    let alive = true;
    void loadManifest().then((loaded) => {
      if (alive) setSprites(loaded);
    });
    return () => {
      alive = false;
    };
  }, []);
  return sprites;
}
