/**
 * 카메라 constraint 실험 — 개발 화면 전용.
 *
 * 왜 필요한가: `getUserMedia` 가 무엇을 돌려줄지는 **브라우저·기기마다 다르고 명세로
 * 강제할 수단이 없다.** Chrome 은 종횡비를 맞출 때 스케일이 아니라 크롭을 고르고,
 * "크롭하지 말라"고 요청할 방법이 없다. Android 는 기기 방향에 따라 width/height 가
 * 뒤바뀌어 오기도 한다. 실측(2026-08-26, Galaxy / Chrome)에서는 720x1280 을 요청했는데
 * **1280x720** 이 왔고, 정작 `getCapabilities()` 는 W 1~4000 · H 1~3000 을 지원한다고
 * 밝혔다 — 즉 세로가 불가능해서가 아니라 **선택 알고리즘이 가로를 골랐다.**
 *
 * 그래서 어떤 요청이 통하는지는 추측이 아니라 실기기에서 재야 한다. 이 모듈은 후보
 * constraint 를 순서대로 열어 보고 **실제로 받은 설정**을 돌려준다. 카메라를 열고 즉시
 * 닫으므로 부작용이 없고, 개발 화면에서만 호출한다.
 *
 * ⚠️ 여기서 **정답을 고르지 않는다.** 결과를 보고 값을 정하는 것은 사람 몫이다 —
 * 종횡비는 학습 계약(`AR_TRAIN`)에 직결되므로 코드가 자동으로 바꿀 자리가 아니다.
 *
 * ⚠️ **이 값은 "예약값"이지 출력이 아니다.** 트랙을 `<video>` 에 물리지 않고 재기 때문에,
 * `getSettings()` 가 요청한 값을 그대로 되읊고 프레임이 흐르면 다른 값으로 정착하는 경우가
 * 있다 (2026-08-26 실측: 여기서는 720x1280 인데 실제 재생은 1280x720 이었다). 최종 판정은
 * 반드시 **재생 중인 `<video>` 의 intrinsic 크기**로 한다 — 화면 배지가 그 값을 찍는다.
 */

export interface CameraProbeResult {
  /** 어떤 요청이었는지 — 화면에 그대로 보여 준다. */
  label: string;
  /** 그 요청으로 실제 받은 것(또는 실패 사유). */
  outcome: string;
}

/**
 * 후보 목록. 위에서부터 "우리가 쓰고 싶은 것" → "차선" 순이다.
 *
 * 지금 쓰는 조합(ideal 3종)이 맨 위에 있어야 **기준선**이 남는다 — 다른 후보가 좋아 보여도
 * 기준선과 같은 세션·같은 자세에서 잰 값이 아니면 비교가 성립하지 않는다.
 */
const CANDIDATES: ReadonlyArray<{ label: string; video: MediaTrackConstraints }> = [
  {
    label: '현재 설정 (ideal 720x1280 + AR 9/16)',
    video: {
      width: { ideal: 720 },
      height: { ideal: 1280 },
      aspectRatio: { ideal: 9 / 16 },
      facingMode: 'user',
    },
  },
  {
    label: 'exact 720x1280',
    video: { width: { exact: 720 }, height: { exact: 1280 }, facingMode: 'user' },
  },
  {
    label: 'AR 만 exact 9/16 (크기 요청 없음)',
    video: { aspectRatio: { exact: 9 / 16 }, facingMode: 'user' },
  },
  {
    label: 'min/max 로 720x1280 고정',
    video: {
      width: { min: 720, ideal: 720, max: 720 },
      height: { min: 1280, ideal: 1280, max: 1280 },
      facingMode: 'user',
    },
  },
  {
    label: 'ideal 1080x1920 (더 큰 세로)',
    video: { width: { ideal: 1080 }, height: { ideal: 1920 }, facingMode: 'user' },
  },
  {
    label: '크기 요청 없음 (기기 기본값)',
    video: { facingMode: 'user' },
  },
];

function describeSettings(track: MediaStreamTrack): string {
  const { width, height } = track.getSettings();
  if (!width || !height) return '해상도 미보고';
  return `${width}x${height} (AR ${(width / height).toFixed(2)})`;
}

function describeError(error: unknown): string {
  if (error instanceof DOMException) return `실패: ${error.name}`;
  return `실패: ${String(error)}`;
}

/**
 * 후보를 하나씩 열어 보고 실제 설정을 모은다. 마지막에 `applyConstraints()` 경로도 잰다 —
 * 시작 시점 constraint 로는 안 되지만 트랙이 열린 뒤에는 바꿔 주는 구현이 있어서다.
 *
 * ⚠️ 다른 곳(랜드마커)이 카메라를 잡고 있으면 기기에 따라 전부 실패할 수 있다.
 * 호출부가 먼저 카메라를 끄고 부른다.
 */
export async function probePortraitConstraints(): Promise<CameraProbeResult[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return [{ label: '환경', outcome: 'getUserMedia 를 쓸 수 없다' }];
  }

  const results: CameraProbeResult[] = [];

  for (const candidate of CANDIDATES) {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: candidate.video, audio: false });
      const track = stream.getVideoTracks()[0];
      results.push({
        label: candidate.label,
        outcome: track ? describeSettings(track) : '비디오 트랙 없음',
      });
    } catch (error) {
      results.push({ label: candidate.label, outcome: describeError(error) });
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  // 열린 뒤에 바꾸기 — 시작 constraint 와 다른 코드 경로다.
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('비디오 트랙 없음');
    await track.applyConstraints({ width: { exact: 720 }, height: { exact: 1280 } });
    results.push({ label: '연 뒤 applyConstraints(720x1280)', outcome: describeSettings(track) });
  } catch (error) {
    results.push({ label: '연 뒤 applyConstraints(720x1280)', outcome: describeError(error) });
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }

  return results;
}
