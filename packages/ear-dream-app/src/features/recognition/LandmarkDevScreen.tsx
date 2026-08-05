/**
 * 손 · 얼굴 랜드마크 추출 확인용 개발 화면 (T-03).
 *
 * ⚠️ 임시 화면이다. 디자인이 확정되기 전까지 "좌표가 제대로 뽑히는지" 를 눈으로 확인하는 것만이 목적이고,
 * 레이아웃과 배색은 검증이 끝나면 버린다. 실제 화면을 만들 때는 이 파일을 참고하지 말고
 * useLandmarker 훅만 가져다 새로 구성하면 된다.
 *
 * 한손 조작 규칙(하단 배치, 44pt 터치 타겟 등)은 여기 적용하지 않았다.
 * 조작 요소가 없는 확인용 화면이라 적용할 대상이 없고, 실제 화면에서 지켜야 할 규칙이다.
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { CameraLandmarkView } from './landmarks';

export function LandmarkDevScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>손 · 얼굴 랜드마크 추출 확인</Text>
        <Text style={styles.subtitle}>
          T-03 개발용 화면. 손을 카메라에 올리면 21개 점과 연결선이, 얼굴에는 메쉬가 따라 그려집니다.
          얼굴 검출을 껐다 켜며 FPS 변화를 기록해 두세요 — 설계 문서의 TARGET_FPS 를 정하는 근거가 됩니다.
        </Text>
      </View>

      <CameraLandmarkView />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16,
    alignItems: 'center',
  },
  header: {
    gap: 4,
    width: '100%',
    maxWidth: 720,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#444',
  },
});
