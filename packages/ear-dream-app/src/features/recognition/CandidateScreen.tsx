import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { CandidateRow } from '../../components/CandidateRow';
import { ScreenFrame } from '../../components/ScreenFrame';
import { MOCK_CANDIDATE_SENTENCES } from '../../constants/mock';
import { strings } from '../../constants/strings';
import { colors, fonts, spacing } from '../../constants/theme';

export interface CandidateScreenProps {
  /** 후보 선택 확정 — 음성 전달 화면으로. */
  onConfirm: (sentence: string) => void;
  /** AppBar 뒤로가기 — 수어 입력 화면으로 복귀(다시 촬영). */
  onBack: () => void;
}

/**
 * 인식 결과(후보 확인) 화면 (V2 시안 "인식 결과"). 후보 행에서 하나를 고르고
 * 하단 "문장 선택 완료"로 확정한다. 후보는 목업이며 개수 N 도 미확정이다(mock.ts).
 */
export function CandidateScreen({ onConfirm, onBack }: CandidateScreenProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const selectedSentence = selectedIndex === null ? null : MOCK_CANDIDATE_SENTENCES[selectedIndex];

  return (
    <ScreenFrame
      title={strings.candidates.appBarTitle}
      onBack={onBack}
      footer={
        <Button
          label={strings.candidates.confirm}
          disabled={selectedSentence == null}
          onPress={() => {
            if (selectedSentence != null) onConfirm(selectedSentence);
          }}
          testID="candidates-confirm"
        />
      }
    >
      <Text style={styles.prompt}>{strings.candidates.prompt}</Text>
      <View style={styles.list}>
        {MOCK_CANDIDATE_SENTENCES.map((sentence, index) => (
          <CandidateRow
            key={sentence}
            sentence={sentence}
            selected={index === selectedIndex}
            onPress={() => setSelectedIndex(index)}
            testID={`candidates-card-${index}`}
          />
        ))}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  prompt: {
    marginTop: spacing.sm,
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.text.primary,
  },
  list: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
});
