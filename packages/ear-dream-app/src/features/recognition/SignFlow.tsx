import { useCallback, useMemo, useState } from 'react';

import { ResultScreen } from '../transcript/ResultScreen';
import { createRequestId } from './api/createRequestId';
import { chosenCandidate, useRecognitionQueue } from './api/useRecognitionQueue';
import { useSentenceComposer } from './api/useSentenceComposer';
import type { ServerCatalog } from './api/useVocabulary';
import type { SessionWord } from './session';
import { SignInputScreen } from './SignInputScreen';

export interface SignFlowProps {
  /** 부팅 시 로드한 서버 카탈로그 (AppNavigator 소유 — 트랙 진입마다 다시 부르지 않는다). */
  catalog: ServerCatalog;
  /** 세션 종료 — 첫 화면으로. 언마운트되며 큐·세션이 비워진다(다음 진입은 새 세션). */
  onExit: () => void;
}

type Stage = 'input' | 'result';

/**
 * 농인 트랙 컨테이너 — pill 큐(태그 입력) UX (2026-08-10 사용자 확정).
 *
 * 단어마다 후보 화면으로 전환하던 흐름을 제거했다: 버튼 릴리즈마다 큐 끝에 대기 pill 이
 * 붙고, 응답이 오면 top-1 로 자동 확정된다. 오확정 정정은 입력 화면의 pill 탭 → 하단
 * 시트(top-k 교체/삭제)가 담당한다. 그래서 화면은 input ↔ result 둘뿐이다.
 *
 * 인식 큐와 session_id 같은 문장 세션 상태는 화면이 아니라 여기(최상위)서 소유한다.
 * 화면 전환(input ↔ result)이 있어도 큐가 유지되어야 하기 때문이다.
 * 상태 관리 라이브러리는 쓰지 않는다 — useState 기반 훅으로 충분한 규모다(스킬 문서 방침).
 */
export function SignFlow({ catalog, onExit }: SignFlowProps) {
  // 문장 세션 단위로 유지되는 식별자. onExit 로 언마운트될 때까지 같은 값을 쓴다.
  const [sessionId] = useState(createRequestId);
  const [stage, setStage] = useState<Stage>('input');

  const queue = useRecognitionQueue(sessionId);
  const composer = useSentenceComposer(sessionId);

  const allDone =
    queue.entries.length > 0 && queue.entries.every((entry) => entry.state === 'done');

  // 확정 pill 열 → 문장 재료. done 엔트리의 **현재 선택된 후보**(top-1 또는 시트에서
  // 교체한 것) 기준이다. ResultScreen 병기 표시와 compose-sentence 입력이 같은 열을 쓴다.
  const confirmedWords = useMemo<SessionWord[]>(
    () =>
      queue.entries.flatMap((entry) => {
        if (entry.state !== 'done') return [];
        const candidate = chosenCandidate(entry);
        return [
          {
            localId: entry.localId,
            wordId: candidate.id,
            label: candidate.label,
            sourceRequestId: entry.requestId,
          },
        ];
      }),
    [queue.entries],
  );

  const handleCompose = useCallback(() => {
    // 대기/실패 pill 이 남아 있으면 만들지 않는다 — 버튼도 비활성이지만 여기서도 지킨다
    // (대기 pill 이 문장에서 조용히 빠지면 사용자 의도와 다른 문장이 된다).
    if (!allDone || confirmedWords.length === 0) return;
    // 인라인 배너 상태를 정리한다 — 결과 화면에서 돌아왔을 때 지난 배너가 다시 나타나지 않게.
    queue.dismissNotice();
    composer.compose({
      wordIds: confirmedWords.map((word) => word.wordId),
      sourceRequestIds: confirmedWords.map((word) => word.sourceRequestId),
    });
    setStage('result');
  }, [allDone, confirmedWords, composer, queue]);

  const handleBackFromResult = useCallback(() => {
    // 큐는 유지한 채 입력으로 복귀 — 단어를 더하거나 지우고 다시 만들 수 있다.
    composer.cancel();
    setStage('input');
  }, [composer]);

  if (stage === 'result') {
    return (
      <ResultScreen
        words={confirmedWords}
        phase={composer.phase}
        onRetry={composer.retry}
        onGoHome={onExit}
        onBack={handleBackFromResult}
      />
    );
  }

  return (
    <SignInputScreen
      queue={{
        entries: queue.entries,
        submitSegment: queue.submit,
        retryEntry: queue.retry,
        removeEntry: queue.remove,
        chooseCandidate: queue.chooseCandidate,
        notice: queue.notice,
        dismissNotice: queue.dismissNotice,
      }}
      onCompose={handleCompose}
      modelReady={catalog.model ? catalog.model.model_loaded : null}
      onBack={onExit}
    />
  );
}
